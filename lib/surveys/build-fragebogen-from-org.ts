import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractFirstJsonObject,
  escapeControlCharsInJsonStrings,
} from "@/lib/ai/anthropic-helpers";
import { DEFAULT_SURVEY_ACTION_MODEL } from "@/lib/ai/survey-model-config";
import {
  buildCoreFields,
  coreQuestionsForPurpose,
  fieldIdForCoreKey,
  type CoreQuestionTemplate,
} from "@/lib/surveys/core-question-templates";
import {
  loadOrgCrawlContext,
  suggestPrefillsFromCrawl,
  type PrefillDraft,
} from "@/lib/surveys/org-crawl-context";
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import { surveySchema } from "@/lib/surveys/schema";
import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";

export type ExtraQuestionPlacement = "start" | "end";

export type BuiltFragebogenDraft = {
  title: string;
  description: string;
  purpose: SurveyPurpose;
  definition: Survey;
  /** Prefill answers keyed by field id (for in_progress response). */
  suggestedAnswers: Record<string, string>;
  prefillMeta: Record<string, PrefillDraft>;
  extraQuestionTitles: string[];
  crawlPageCount: number;
};

function slugifyKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "extra";
}

async function generateExtraQuestions(input: {
  purpose: SurveyPurpose;
  organisationName: string;
  wunschkundeLabel?: string | null;
  crawlSummary: string;
  coreTitles: string[];
  maxExtras?: number;
}): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return [];

  const anthropic = new Anthropic({ apiKey });
  const maxExtras = input.maxExtras ?? 6;
  const audience =
    input.purpose === "anbieter"
      ? `Anbieter-Fragebogen für das Unternehmen „${input.organisationName}“ (Firmenwissen für SEO-Berater).`
      : `Kunden-Persona-Fragebogen für Wunschkunde „${input.wunschkundeLabel?.trim() || "Avatar"}“ von „${input.organisationName}“.`;

  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: [DEFAULT_SURVEY_ACTION_MODEL],
    maxTokens: 1200,
    timeoutMs: 45_000,
    stream: false,
    system:
      "Du entwirfst kurze, konkrete Fragebogen-Fragen auf Deutsch. Antworte nur mit JSON.",
    messages: [
      {
        role: "user",
        content: `${audience}

Kernfragen (schon vorhanden — nicht wiederholen):
${input.coreTitles.map((t) => `- ${t}`).join("\n")}

Website-/Crawl-Kontext:
${input.crawlSummary.slice(0, 8000)}

Aufgabe: Schlage bis zu ${maxExtras} zusätzliche, unternehmensspezifische Fragen vor, die die Kernfragen sinnvoll ergänzen (Branchenbesonderheiten, Leistungen, Tonalität, Zielgruppe).
Kein Smalltalk, keine Meta-Fragen zum Fragebogen selbst.

JSON-Format:
{"questions":["Frage 1?","Frage 2?"]}`,
      },
    ],
  });

  if (!result) return [];
  const raw = extractAnthropicText(result.response);
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .map((q) => String(q ?? "").trim())
      .filter((q) => q.length >= 8)
      .slice(0, maxExtras);
  } catch {
    return [];
  }
}

function extraFieldsFromTitles(titles: string[]): SurveyField[] {
  return titles.map((title, index) => ({
    id: `extra_${slugifyKey(title)}_${index + 1}`,
    type: "text" as const,
    title,
    description: "Individuelle Zusatzfrage (aus Crawl/KI) — bei Bedarf anpassen oder löschen.",
    required: false,
  }));
}

/**
 * Build an org-linked questionnaire draft from fixed core questions + optional AI extras.
 */
export async function buildFragebogenFromOrg(input: {
  organisationId: string;
  purpose: SurveyPurpose;
  /** Optional Wunschkunde label for persona surveys. */
  wunschkundeLabel?: string | null;
  /** Core question keys to include; default = all for purpose. */
  selectedCoreKeys?: string[] | null;
  includeAiExtras?: boolean;
  extraPlacement?: ExtraQuestionPlacement;
}): Promise<BuiltFragebogenDraft> {
  const purpose = input.purpose;
  const allCore = coreQuestionsForPurpose(purpose);
  const selectedKeys = new Set(
    (input.selectedCoreKeys?.length ? input.selectedCoreKeys : allCore.map((c) => c.key)).filter(
      Boolean,
    ),
  );
  const selectedTemplates: CoreQuestionTemplate[] = allCore.filter((c) =>
    selectedKeys.has(c.key),
  );
  if (selectedTemplates.length === 0) {
    throw new Error("Mindestens eine Kernfrage muss ausgewählt sein.");
  }

  const crawl = await loadOrgCrawlContext(input.organisationId);
  const { steps: coreSteps } = buildCoreFields(selectedTemplates);

  const extraTitles = input.includeAiExtras
    ? await generateExtraQuestions({
        purpose,
        organisationName: crawl.organisationName,
        wunschkundeLabel: input.wunschkundeLabel,
        crawlSummary: crawl.summaryText,
        coreTitles: selectedTemplates.map((t) => t.title),
      })
    : [];

  const extrasStep: SurveyStep | null =
    extraTitles.length > 0
      ? {
          id: "extra_individual",
          title: "Individuelle Fragen",
          description:
            "Zusatzfragen aus Website-Kontext. Veraltetes löschen, Neues ergänzen.",
          fields: extraFieldsFromTitles(extraTitles),
        }
      : null;

  const steps =
    extrasStep == null
      ? coreSteps
      : input.extraPlacement === "start"
        ? [extrasStep, ...coreSteps]
        : [...coreSteps, extrasStep];

  const title =
    purpose === "anbieter"
      ? `Anbieter: ${crawl.organisationName}`
      : `Persona: ${input.wunschkundeLabel?.trim() || "Wunschkunde"} (${crawl.organisationName})`;

  const description =
    purpose === "anbieter"
      ? `Firmenfragebogen für ${crawl.organisationName}. Kernfragen fest + optionale Zusatzfragen aus Website-Crawl.`
      : `Wunschkunden-Fragebogen für ${crawl.organisationName}. Kernfragen fest + optionale Zusatzfragen.`;

  const definitionCandidate: Survey = {
    version: 1,
    id: randomUUID(),
    title,
    description,
    infoTextEnabled: false,
    infoText: "",
    answerPlaceholder: "Deine Antwort…",
    steps,
  };

  const parsed = surveySchema.safeParse(definitionCandidate);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Fragebogen-Definition ungültig.",
    );
  }

  const prefills = suggestPrefillsFromCrawl({
    context: crawl,
    hints: selectedTemplates.map((t) => ({ key: t.key, hint: t.prefillHint })),
  });

  const suggestedAnswers: Record<string, string> = {};
  const prefillMeta: Record<string, PrefillDraft> = {};
  for (const [key, draft] of Object.entries(prefills)) {
    const fieldId = fieldIdForCoreKey(key);
    suggestedAnswers[fieldId] = draft.value;
    prefillMeta[fieldId] = draft;
  }

  return {
    title,
    description,
    purpose,
    definition: parsed.data as Survey,
    suggestedAnswers,
    prefillMeta,
    extraQuestionTitles: extraTitles,
    crawlPageCount: crawl.pageCount,
  };
}
