import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
  type SurveyChatSystem,
} from "@/lib/ai/anthropic-helpers";
import {
  MULTIPHASE_STEP_CHUNK_SIZE,
  resolveSurveyActionModels,
} from "@/lib/ai/survey-model-config";
import { surveySchema } from "@/lib/surveys/schema";

const blueprintFieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "radio", "checkbox", "rating", "ranking"]),
  title: z.string(),
  description: z.string().optional().default(""),
  required: z.boolean().optional().default(true),
});

const blueprintStepSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().optional().default(""),
  fields: z.array(blueprintFieldSchema).min(1),
});

const outlineSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  notificationEmails: z.array(z.string()).optional().default([]),
  survey: z.object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional().default(""),
    infoTextEnabled: z.boolean().optional().default(false),
    infoText: z.string().optional().default(""),
    answerPlaceholder: z.string().optional().default("Deine Antwort…"),
    steps: z.array(blueprintStepSchema).min(1),
  }),
});

const expandChunkSchema = z.object({
  steps: z.array(z.unknown()).min(1),
});

export type MultiPhaseSurveyCreateResult =
  | {
      ok: true;
      assistantText: string;
      model: string;
      phaseCount: number;
      stepCount: number;
    }
  | { ok: false; message: string };

type FolderSnapshot = { id: string; name: string };

type FolderPlacement =
  | { type: "existing"; folder: FolderSnapshot }
  | { type: "create"; name: string };

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const OUTLINE_INSTRUCTION = `[MULTI-PHASE SURVEY — Phase 1: OUTLINE ONLY]
The user requested a large new survey. Return ONLY one JSON object (no markdown, no prose):
{
  "title": "Survey list title",
  "description": "Optional list description",
  "notificationEmails": [],
  "survey": {
    "version": 1,
    "id": "<uuid-like unique string>",
    "title": "...",
    "description": "...",
    "infoTextEnabled": false,
    "infoText": "",
    "answerPlaceholder": "Deine Antwort…",
    "steps": [
      {
        "id": "<unique step id>",
        "title": "...",
        "description": "",
        "fields": [
          { "id": "<unique field id>", "type": "text|radio|checkbox|rating|ranking", "title": "...", "description": "", "required": true }
        ]
      }
    ]
  }
}
Rules:
- Include EVERY step and field the user asked for as blueprints.
- Field objects must NOT include options, scale, or placeholder yet — only id, type, title, description, required.
- All step.id and field.id must be globally unique within the survey.
- Do NOT include folderId. Folder placement is handled separately by the server.`;

const MULTIPHASE_CALL_TIMEOUT_MS = 180_000;
const OUTLINE_MAX_TOKENS = 16_384;
const EXPAND_MAX_TOKENS = 12_288;

/** Fold German umlauts so "gruenerstraße" matches "Grünerstraße". */
function foldGerman(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Detect "speichern/abspeichern in Ordner X" and resolve against Known folders.
 * Returns null when the user did not ask for folder placement.
 */
export function resolveFolderPlacementFromMessage(
  userMessage: string,
  folders: FolderSnapshot[],
): FolderPlacement | null {
  const text = userMessage.trim();
  if (!text) return null;

  const wantsFolder =
    /\b(?:ordner|folder)\b/i.test(text) ||
    /\b(?:ab)?speicher(?:e|n|t)?\b/i.test(text);
  if (!wantsFolder) return null;

  const foldedText = foldGerman(text);
  let matched: FolderSnapshot | null = null;
  for (const f of folders) {
    const name = f.name.trim();
    if (name.length < 2) continue;
    const foldedName = foldGerman(name);
    if (foldedText.includes(foldedName)) {
      if (!matched || name.length > matched.name.length) matched = f;
    }
  }
  if (matched) return { type: "existing", folder: matched };

  // "in ordner orthopädie gruenerstraße abspeichern" → "orthopädie gruenerstraße"
  const named =
    text.match(
      /\b(?:in\s+)?(?:den\s+|dem\s+)?ordner\s+([^\n,.]+?)(?:\s+ab)?speicher(?:e|n|t)?\b/i,
    ) ||
    text.match(/\b(?:in\s+)?(?:den\s+|dem\s+)?ordner\s+([^\n,.]+)/i) ||
    text.match(/\bfolder\s+([^\n,.]+?)(?:\s+save|\s+store)?\b/i);

  let rawName = (named?.[1] ?? "").trim().replace(/\s+/g, " ");
  rawName = rawName
    .replace(/^[„“"']+|[„“"']+$/g, "")
    .replace(/\s+(bitte|danke|und|ablegen|anlegen|erstellen).*$/i, "")
    .trim();

  if (rawName.length >= 2 && rawName.length <= 80) {
    return { type: "create", name: rawName };
  }

  // Save/abspeichern without a resolvable folder name — skip folder steps.
  if (!/\b(?:ordner|folder)\b/i.test(text)) return null;
  return null;
}

function wrapProposalWithFolder(input: {
  createSurvey: {
    kind: "create_survey";
    summary: string;
    title: string;
    description: string;
    notificationEmails: string[];
    survey: z.infer<typeof surveySchema>;
  };
  placement: FolderPlacement | null;
}): Record<string, unknown> {
  const survey = input.createSurvey;
  if (!input.placement) return survey;

  const surveyRef = "survey_main";
  if (input.placement.type === "existing") {
    return {
      kind: "batch",
      summary: `${survey.summary} Im Ordner „${input.placement.folder.name}“.`,
      steps: [
        {
          kind: "create_survey",
          ref: surveyRef,
          summary: survey.summary,
          title: survey.title,
          description: survey.description,
          notificationEmails: survey.notificationEmails,
          survey: survey.survey,
        },
        {
          kind: "assign_folder",
          summary: `Umfrage dem Ordner „${input.placement.folder.name}“ zuordnen.`,
          surveyRef,
          folderRef: input.placement.folder.id,
        },
      ],
    };
  }

  const folderRef = "folder_target";
  return {
    kind: "batch",
    summary: `${survey.summary} Neuer Ordner „${input.placement.name}“.`,
    steps: [
      {
        kind: "create_folder",
        ref: folderRef,
        summary: `Ordner „${input.placement.name}“ anlegen.`,
        name: input.placement.name,
      },
      {
        kind: "create_survey",
        ref: surveyRef,
        summary: survey.summary,
        title: survey.title,
        description: survey.description,
        notificationEmails: survey.notificationEmails,
        survey: survey.survey,
      },
      {
        kind: "assign_folder",
        summary: `Umfrage dem Ordner „${input.placement.name}“ zuordnen.`,
        surveyRef,
        folderRef,
      },
    ],
  };
}

async function completeTextWithContinuation(input: {
  anthropic: Anthropic;
  models: string[];
  maxTokens: number;
  system: SurveyChatSystem;
  baseMessages: Anthropic.MessageParam[];
  initialResponse: Anthropic.Messages.Message;
  model: string;
  timeoutMs: number;
}): Promise<string> {
  let fullText = extractAnthropicText(input.initialResponse);
  let stopReason = input.initialResponse.stop_reason;
  let rounds = 0;

  while (stopReason === "max_tokens" && rounds < 3) {
    rounds += 1;
    const continued = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: [input.model],
      maxTokens: input.maxTokens,
      system: input.system,
      messages: [
        ...input.baseMessages,
        { role: "assistant", content: fullText },
        {
          role: "user",
          content:
            "Fahre exakt dort fort, wo du aufgehört hast. Wiederhole nichts und beende die JSON-Antwort vollständig.",
        },
      ],
      stream: true,
      timeoutMs: input.timeoutMs,
    });
    if (!continued) break;
    const nextText = extractAnthropicText(continued.response);
    if (nextText) fullText += nextText;
    stopReason = continued.response.stop_reason;
  }

  return fullText;
}

function buildExpandInstruction(input: {
  userMessage: string;
  chunkIndex: number;
  chunkCount: number;
  surveyTitle: string;
  surveyDescription: string;
  blueprintSteps: unknown[];
}): string {
  return `[MULTI-PHASE SURVEY — Phase 2: EXPAND chunk ${input.chunkIndex + 1}/${input.chunkCount}]
Expand the following step blueprints into full schema-conform survey steps.
Preserve every step.id and field.id exactly — do not rename ids.
User's original request:
${input.userMessage}

Survey: ${input.surveyTitle}
Description: ${input.surveyDescription}

Blueprints to expand:
${JSON.stringify(input.blueprintSteps)}

Return ONLY JSON:
{ "steps": [ /* full step objects with complete options/scales/placeholders */ ] }`;
}

export async function runMultiPhaseSurveyCreation(input: {
  anthropic: Anthropic;
  userMessage: string;
  system: SurveyChatSystem;
  historyMessages: Anthropic.MessageParam[];
  folders?: FolderSnapshot[];
  onStatus?: (message: string) => void;
}): Promise<MultiPhaseSurveyCreateResult> {
  const models = resolveSurveyActionModels();
  const emit = input.onStatus ?? (() => {});
  const folderPlacement = resolveFolderPlacementFromMessage(
    input.userMessage,
    input.folders ?? [],
  );

  emit("Große Umfrage — ich skizziere zuerst die Struktur…");

  const outlineMessages: Anthropic.MessageParam[] = [
    ...input.historyMessages,
    {
      role: "user",
      content: `${input.userMessage}\n\n${OUTLINE_INSTRUCTION}`,
    },
  ];

  const outlineCall = await callAnthropicFirstAvailable({
    anthropic: input.anthropic,
    models,
    maxTokens: OUTLINE_MAX_TOKENS,
    system: input.system,
    messages: outlineMessages,
    stream: true,
    timeoutMs: MULTIPHASE_CALL_TIMEOUT_MS,
  });
  if (!outlineCall) {
    return { ok: false, message: "Outline-Modell nicht verfügbar." };
  }

  const outlineText = await completeTextWithContinuation({
    anthropic: input.anthropic,
    models,
    maxTokens: OUTLINE_MAX_TOKENS,
    system: input.system,
    baseMessages: outlineMessages,
    initialResponse: outlineCall.response,
    model: outlineCall.model,
    timeoutMs: MULTIPHASE_CALL_TIMEOUT_MS,
  });

  const outlineParsed = tryParseJsonObject(outlineText);
  const outlineResult = outlineSchema.safeParse(outlineParsed);
  if (!outlineResult.success) {
    return {
      ok: false,
      message:
        outlineResult.error.issues[0]?.message ??
        "Umfrage-Gliederung konnte nicht gelesen werden.",
    };
  }

  const outline = outlineResult.data;
  const blueprintSteps = outline.survey.steps;
  const chunks = chunkArray(blueprintSteps, MULTIPHASE_STEP_CHUNK_SIZE);
  const expandedByStepId = new Map<string, unknown>();

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    emit(
      `Ich ergänze Schritte ${i * MULTIPHASE_STEP_CHUNK_SIZE + 1}–${i * MULTIPHASE_STEP_CHUNK_SIZE + chunk.length} von ${blueprintSteps.length}…`,
    );

    const expandMessages: Anthropic.MessageParam[] = [
      ...input.historyMessages,
      {
        role: "user",
        content: buildExpandInstruction({
          userMessage: input.userMessage,
          chunkIndex: i,
          chunkCount: chunks.length,
          surveyTitle: outline.survey.title,
          surveyDescription: outline.survey.description,
          blueprintSteps: chunk,
        }),
      },
    ];

    let expandedSteps: unknown[] | null = null;
    for (let attempt = 0; attempt < 2 && !expandedSteps; attempt += 1) {
      const expandCall = await callAnthropicFirstAvailable({
        anthropic: input.anthropic,
        models,
        maxTokens: EXPAND_MAX_TOKENS,
        system: input.system,
        messages: expandMessages,
        stream: true,
        timeoutMs: MULTIPHASE_CALL_TIMEOUT_MS,
      });
      if (!expandCall) {
        return { ok: false, message: "Expand-Modell nicht verfügbar." };
      }

      const expandText = await completeTextWithContinuation({
        anthropic: input.anthropic,
        models,
        maxTokens: EXPAND_MAX_TOKENS,
        system: input.system,
        baseMessages: expandMessages,
        initialResponse: expandCall.response,
        model: expandCall.model,
        timeoutMs: MULTIPHASE_CALL_TIMEOUT_MS,
      });

      const expandParsed = tryParseJsonObject(expandText);
      const expandResult = expandChunkSchema.safeParse(expandParsed);
      if (expandResult.success) {
        expandedSteps = expandResult.data.steps;
      }
    }

    if (!expandedSteps) {
      return {
        ok: false,
        message: `Schritte ${i * MULTIPHASE_STEP_CHUNK_SIZE + 1}–${i * MULTIPHASE_STEP_CHUNK_SIZE + chunk.length} konnten nicht expandiert werden.`,
      };
    }

    for (const step of expandedSteps) {
      if (!step || typeof step !== "object") continue;
      const stepId = (step as { id?: unknown }).id;
      if (typeof stepId === "string" && stepId.trim()) {
        expandedByStepId.set(stepId, step);
      }
    }
  }

  const mergedSteps = blueprintSteps.map((blueprint) => {
    const expanded = expandedByStepId.get(blueprint.id);
    return expanded ?? blueprint;
  });

  const mergedSurvey = {
    ...outline.survey,
    steps: mergedSteps,
  };

  const validatedSurvey = surveySchema.safeParse(mergedSurvey);
  if (!validatedSurvey.success) {
    return {
      ok: false,
      message:
        validatedSurvey.error.issues[0]?.message ??
        "Zusammengeführte Umfrage entspricht nicht dem Schema.",
    };
  }

  const createSurvey = {
    kind: "create_survey" as const,
    summary: `Neue Umfrage „${outline.title}" (${validatedSurvey.data.steps.length} Schritte, mehrphasig erstellt).`,
    title: outline.title,
    description: outline.description,
    notificationEmails: outline.notificationEmails,
    survey: validatedSurvey.data,
  };

  const proposal = wrapProposalWithFolder({
    createSurvey,
    placement: folderPlacement,
  });

  return {
    ok: true,
    assistantText: JSON.stringify(proposal),
    model: outlineCall.model,
    phaseCount: 1 + chunks.length,
    stepCount: validatedSurvey.data.steps.length,
  };
}
