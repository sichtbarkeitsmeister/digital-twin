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
): string {
  return `sa-${kind}-${responseId}`.slice(0, 64);
}

async function createBatchWithModelFallback(input: {
  anthropic: Anthropic;
  customId: string;
  system: string | Anthropic.Messages.MessageCreateParams["system"];
  messages: Anthropic.MessageParam[];
}): Promise<{ batchId: string; model: string }> {
  let lastError: unknown = null;

  for (const model of modelCandidates()) {
    try {
      const batch = await input.anthropic.messages.batches.create({
        requests: [
          {
            custom_id: input.customId,
            params: {
              model,
              max_tokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
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

export type SurveyAgentBatchPollResult =
  | { status: "pending"; processingStatus: string }
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
  const expectedCustomId = surveyAgentBatchCustomId(input.kind, input.responseId);

  const batch = await anthropic.messages.batches.retrieve(input.batchId);
  if (batch.processing_status !== "ended") {
    return { status: "pending", processingStatus: batch.processing_status };
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
    if (row.custom_id === expectedCustomId) {
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
  if (message.stop_reason === "max_tokens") {
    return {
      status: "error",
      message:
        "Ausgabe wurde am Token-Limit abgeschnitten. Bitte erneut versuchen oder Token-Budget erhöhen.",
    };
  }

  const raw = extractAnthropicText(message);
  const parsed = tryParseJsonObject(raw);
  if (!parsed) {
    return {
      status: "error",
      message: "KI-Antwort war kein gültiges JSON. Bitte erneut versuchen.",
    };
  }

  if (input.kind === "create") {
    const validated = surveyAgentPreviewSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        status: "error",
        message: "Agent-Vorschau ungültig. Bitte erneut versuchen.",
      };
    }
    return {
      status: "ready",
      kind: "create",
      preview: validated.data,
      model: message.model,
    };
  }

  const validated = surveyAgentRefineSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      status: "error",
      message: "Verfeinerung ungültig. Bitte erneut versuchen.",
    };
  }
  return {
    status: "ready",
    kind: "refine",
    refinement: validated.data,
    model: message.model,
  };
}
