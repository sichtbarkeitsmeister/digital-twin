import Anthropic from "@anthropic-ai/sdk";

import {
  extractAnthropicText,
  isAnthropicModelNotFoundError,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import {
  loadSurveyAgentGlobalPrompt,
  resolveSurveyToAgentSystemPrompt,
  SURVEY_AGENT_DEFAULT_MODEL,
  SURVEY_AGENT_GENERATION_MAX_TOKENS,
  SURVEY_REFINE_AGENT_PROMPT_SLUG,
  SURVEY_TO_AGENT_PROMPT_SLUG,
} from "@/lib/dt/survey-agent-global-prompts";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import {
  surveyAgentPreviewSchema,
  type SurveyAgentPreview,
} from "@/lib/dt/survey-to-agent-prompt";
import {
  surveyAgentRefineSchema,
  type SurveyAgentRefinePreview,
} from "@/lib/dt/survey-refine-agent-prompt";

export type SurveyAgentBatchKind = "create" | "refine";

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY fehlt.");
  return new Anthropic({ apiKey });
}

function modelCandidates(): string[] {
  const primary = process.env.ANTHROPIC_DT_SURVEY_MODEL?.trim() || SURVEY_AGENT_DEFAULT_MODEL;
  return [primary, resolveDtAnthropicModel("default"), "claude-haiku-4-5-20251001"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );
}

/** Stable custom_id so we can verify poll results belong to this response. */
export function surveyAgentBatchCustomId(
  kind: SurveyAgentBatchKind,
  responseId: string,
  phase: "main" | "repair" = "main",
): string {
  const prefix = phase === "repair" ? `sa-${kind[0]}r-` : `sa-${kind}-`;
  return `${prefix}${responseId}`.slice(0, 64);
}

async function createBatchWithModelFallback(input: {
  anthropic: Anthropic;
  customId: string;
  system: string | Anthropic.Messages.MessageCreateParams["system"];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}): Promise<{ batchId: string; model: string }> {
  let lastError: unknown = null;
  const maxTokens = input.maxTokens ?? SURVEY_AGENT_GENERATION_MAX_TOKENS;

  for (const model of modelCandidates()) {
    try {
      const batch = await input.anthropic.messages.batches.create({
        requests: [
          {
            custom_id: input.customId,
            params: {
              model,
              max_tokens: maxTokens,
              system: input.system,
              messages: input.messages,
            },
          },
        ],
      });
      return { batchId: batch.id, model };
    } catch (error) {
      lastError = error;
      if (isAnthropicModelNotFoundError(error)) continue;
      throw error;
    }
  }

  console.error("[dt] survey-agent batch create failed", { lastError });
  throw new Error("KI-Batch konnte nicht gestartet werden. Bitte erneut versuchen.");
}

const JSON_ONLY_HINT =
  "Antworte NUR mit einem einzigen gültigen JSON-Objekt (kein Markdown, keine Code-Fences, kein Text davor/danach). Strings müssen gültig escaped sein (Zeilenumbrüche als \\n).";

export async function startSurveyAgentCreateBatch(input: {
  responseId: string;
  surveyContext: string;
  organisationName: string;
  extraRules?: string;
  referenceExamples: PersonaReferenceExample[];
}): Promise<{ batchId: string; model: string }> {
  const anthropic = getAnthropic();
  const customId = surveyAgentBatchCustomId("create", input.responseId);

  const userContent = [
    `Organisation: ${input.organisationName}`,
    "",
    input.extraRules?.trim()
      ? `Zusatzregeln vom Admin:\n${input.extraRules.trim()}\n`
      : "",
    "Umfrage-Antworten:",
    input.surveyContext,
    "",
    "Ausgabe-Hinweis: prompt_template muss VOLLSTÄNDIG sein — alle beantworteten Fragen und Bemerkungen abdecken. Keine Abkürzungen zulasten der Vollständigkeit. Keine erfundenen Rankings.",
    JSON_ONLY_HINT,
  ]
    .filter(Boolean)
    .join("\n");

  const system = resolveSurveyToAgentSystemPrompt(
    await loadSurveyAgentGlobalPrompt(SURVEY_TO_AGENT_PROMPT_SLUG),
    input.referenceExamples,
  );

  return createBatchWithModelFallback({
    anthropic,
    customId,
    system,
    messages: [{ role: "user", content: userContent }],
  });
}

export async function startSurveyAgentRefineBatch(input: {
  responseId: string;
  surveyContext: string;
  organisationName: string;
  agentName: string;
  agentRole: string | null;
  agentKind: string;
  currentPromptTemplate: string;
  usesGlobalPrompt: boolean;
  extraRules?: string;
}): Promise<{ batchId: string; model: string }> {
  const anthropic = getAnthropic();
  const customId = surveyAgentBatchCustomId("refine", input.responseId);

  const userContent = [
    `Organisation: ${input.organisationName}`,
    `Agent: ${input.agentName}`,
    `Rolle: ${input.agentRole ?? "—"}`,
    `Art: ${input.agentKind}`,
    input.usesGlobalPrompt
      ? "Hinweis: Der Agent nutzt aktuell einen globalen Basis-Prompt — der folgende Text ist der organisations-spezifische prompt_template-Teil."
      : "",
    "",
    input.extraRules?.trim()
      ? `Zusatzregeln vom Admin:\n${input.extraRules.trim()}\n`
      : "",
    "Aktueller prompt_template:",
    "```",
    input.currentPromptTemplate,
    "```",
    "",
    "Umfrage-Antworten (neue Erkenntnisse einarbeiten):",
    input.surveyContext,
    "",
    JSON_ONLY_HINT,
  ]
    .filter(Boolean)
    .join("\n");

  const system = await loadSurveyAgentGlobalPrompt(SURVEY_REFINE_AGENT_PROMPT_SLUG);

  return createBatchWithModelFallback({
    anthropic,
    customId,
    system,
    messages: [{ role: "user", content: userContent }],
  });
}

async function startJsonRepairBatch(input: {
  anthropic: Anthropic;
  kind: SurveyAgentBatchKind;
  responseId: string;
  raw: string;
  schemaHint: string;
}): Promise<{ batchId: string; model: string }> {
  const customId = surveyAgentBatchCustomId(input.kind, input.responseId, "repair");
  const clipped = input.raw.length > 120_000 ? `${input.raw.slice(0, 120_000)}\n…[abgeschnitten]` : input.raw;

  return createBatchWithModelFallback({
    anthropic: input.anthropic,
    customId,
    maxTokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
    system: [
      "Du reparierst ungültige KI-Ausgaben zu gültigem JSON.",
      JSON_ONLY_HINT,
      input.schemaHint,
      "Behalte den inhaltlichen Persona-/Prompt-Inhalt so vollständig wie möglich. Erfinde keine neuen Rankings.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          "Die folgende Ausgabe war kein gültiges JSON bzw. entsprach nicht dem Schema.",
          "Gib dieselbe inhaltliche Antwort als EIN gültiges JSON-Objekt zurück.",
          "",
          "Kaputte Ausgabe:",
          clipped,
        ].join("\n"),
      },
    ],
  });
}

export type SurveyAgentBatchPollResult =
  | { status: "pending"; processingStatus: string; batchId: string }
  | {
      status: "ready";
      kind: "create";
      preview: SurveyAgentPreview;
      model?: string;
    }
  | {
      status: "ready";
      kind: "refine";
      refinement: SurveyAgentRefinePreview;
      model?: string;
    }
  | { status: "error"; message: string };

export async function pollSurveyAgentBatch(input: {
  batchId: string;
  kind: SurveyAgentBatchKind;
  responseId: string;
}): Promise<SurveyAgentBatchPollResult> {
  const anthropic = getAnthropic();
  const mainCustomId = surveyAgentBatchCustomId(input.kind, input.responseId, "main");
  const repairCustomId = surveyAgentBatchCustomId(input.kind, input.responseId, "repair");

  const batch = await anthropic.messages.batches.retrieve(input.batchId);
  if (batch.processing_status !== "ended") {
    return {
      status: "pending",
      processingStatus: batch.processing_status,
      batchId: input.batchId,
    };
  }

  const rows = await anthropic.messages.batches.results(input.batchId);
  let matched: {
    custom_id: string;
    result:
      | { type: "succeeded"; message: Anthropic.Messages.Message }
      | { type: "errored"; error: { error?: { message?: string } } }
      | { type: "canceled" }
      | { type: "expired" };
  } | null = null;
  for await (const row of rows) {
    if (row.custom_id === mainCustomId || row.custom_id === repairCustomId) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    return {
      status: "error",
      message: "Batch-Ergebnis gehört nicht zu dieser Umfrage-Antwort.",
    };
  }

  const isRepairResult = matched.custom_id === repairCustomId;

  if (matched.result.type === "errored") {
    const msg = matched.result.error?.error?.message ?? "KI-Batch fehlgeschlagen.";
    return { status: "error", message: String(msg) };
  }
  if (matched.result.type === "canceled") {
    return { status: "error", message: "KI-Batch wurde abgebrochen." };
  }
  if (matched.result.type === "expired") {
    return { status: "error", message: "KI-Batch ist abgelaufen. Bitte erneut starten." };
  }

  const message = matched.result.message;
  const raw = extractAnthropicText(message);
  const truncated = message.stop_reason === "max_tokens";

  console.info("[dt] survey-agent batch finished", {
    batchId: input.batchId,
    kind: input.kind,
    model: message.model,
    stopReason: message.stop_reason,
    outputChars: raw.length,
    isRepairResult,
  });

  if (truncated && !tryParseJsonObject(raw)) {
    return {
      status: "error",
      message:
        "Ausgabe wurde am Token-Limit abgeschnitten und ist kein gültiges JSON. Bitte erneut versuchen.",
    };
  }

  const parsed = tryParseJsonObject(raw);

  if (input.kind === "create") {
    const validated = parsed ? surveyAgentPreviewSchema.safeParse(parsed) : null;
    if (validated?.success) {
      return {
        status: "ready",
        kind: "create",
        preview: validated.data,
        model: message.model,
      };
    }

    if (!isRepairResult) {
      console.warn("[dt] survey-agent create output invalid — starting repair batch", {
        batchId: input.batchId,
        parseOk: Boolean(parsed),
        issues: validated?.success === false ? validated.error.issues.slice(0, 5) : undefined,
      });
      const repair = await startJsonRepairBatch({
        anthropic,
        kind: "create",
        responseId: input.responseId,
        raw,
        schemaHint:
          "Schema-Felder: name, role, slug, prompt_template (>=200 Zeichen), avatar_data (Objekt), summary; optional qa_hinweise, quick_actions.",
      });
      return {
        status: "pending",
        processingStatus: "repairing",
        batchId: repair.batchId,
      };
    }

    return {
      status: "error",
      message: parsed
        ? "Agent-Vorschau ungültig (auch nach JSON-Reparatur). Bitte erneut versuchen."
        : "KI-Antwort war kein gültiges JSON (auch nach Reparatur). Bitte erneut versuchen.",
    };
  }

  const validated = parsed ? surveyAgentRefineSchema.safeParse(parsed) : null;
  if (validated?.success) {
    return {
      status: "ready",
      kind: "refine",
      refinement: validated.data,
      model: message.model,
    };
  }

  if (!isRepairResult) {
    console.warn("[dt] survey-agent refine output invalid — starting repair batch", {
      batchId: input.batchId,
      parseOk: Boolean(parsed),
    });
    const repair = await startJsonRepairBatch({
      anthropic,
      kind: "refine",
      responseId: input.responseId,
      raw,
      schemaHint:
        "Schema-Felder: prompt_template (>=200 Zeichen), summary, changed_sections (Array mit mind. 1 Eintrag).",
    });
    return {
      status: "pending",
      processingStatus: "repairing",
      batchId: repair.batchId,
    };
  }

  return {
    status: "error",
    message: parsed
      ? "Verfeinerung ungültig (auch nach JSON-Reparatur). Bitte erneut versuchen."
      : "KI-Antwort war kein gültiges JSON (auch nach Reparatur). Bitte erneut versuchen.",
  };
}
