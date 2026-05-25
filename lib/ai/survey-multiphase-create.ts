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
- All step.id and field.id must be globally unique within the survey.`;

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
  onStatus?: (message: string) => void;
}): Promise<MultiPhaseSurveyCreateResult> {
  const models = resolveSurveyActionModels();
  const emit = input.onStatus ?? (() => {});

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
    maxTokens: 8192,
    system: input.system,
    messages: outlineMessages,
  });
  if (!outlineCall) {
    return { ok: false, message: "Outline-Modell nicht verfügbar." };
  }

  const outlineParsed = tryParseJsonObject(extractAnthropicText(outlineCall.response));
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
        maxTokens: 8192,
        system: input.system,
        messages: expandMessages,
      });
      if (!expandCall) {
        return { ok: false, message: "Expand-Modell nicht verfügbar." };
      }

      const expandParsed = tryParseJsonObject(extractAnthropicText(expandCall.response));
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

  const proposal = {
    kind: "create_survey" as const,
    summary: `Neue Umfrage „${outline.title}" (${validatedSurvey.data.steps.length} Schritte, mehrphasig erstellt).`,
    title: outline.title,
    description: outline.description,
    notificationEmails: outline.notificationEmails,
    survey: validatedSurvey.data,
  };

  return {
    ok: true,
    assistantText: JSON.stringify(proposal),
    model: outlineCall.model,
    phaseCount: 1 + chunks.length,
    stepCount: validatedSurvey.data.steps.length,
  };
}
