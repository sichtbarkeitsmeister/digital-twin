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
  coreQuestionsForPurpose,
  fieldIdForCoreKey,
  type CoreQuestionTemplate,
} from "@/lib/surveys/core-question-templates";
import {
  loadOrgCrawlContext,
  suggestPrefillsFromCrawl,
  type PrefillDraft,
  type PrefillSource,
} from "@/lib/surveys/org-crawl-context";
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import { surveySchema } from "@/lib/surveys/schema";
import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";

export type ExtraQuestionPlacement = "start" | "end";

export type ReviewQuestionItem = {
  id: string;
  kind: "core" | "extra";
  coreKey?: string;
  title: string;
  description: string;
  included: boolean;
  answer: string;
  answerSource: PrefillSource | "none";
  answerNote: string;
};

export type FragebogenReviewDraft = {
  title: string;
  description: string;
  purpose: SurveyPurpose;
  extraPlacement: ExtraQuestionPlacement;
  crawlPageCount: number;
  websiteUrl: string | null;
  organisationName: string;
  questions: ReviewQuestionItem[];
};

function slugifyKey(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "extra"
  );
}

async function generateExtrasAndAiPrefills(input: {
  purpose: SurveyPurpose;
  organisationName: string;
  wunschkundeLabel?: string | null;
  crawlSummary: string;
  coreItems: Array<{ key: string; title: string; hasPrefill: boolean }>;
  includeAiExtras: boolean;
  maxExtras?: number;
}): Promise<{ extras: string[]; aiPrefills: Record<string, PrefillDraft> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { extras: [], aiPrefills: {} };

  const anthropic = new Anthropic({ apiKey });
  const maxExtras = input.maxExtras ?? 6;
  const missing = input.coreItems.filter((c) => !c.hasPrefill);
  const audience =
    input.purpose === "anbieter"
      ? `Anbieter-Fragebogen für „${input.organisationName}“ (Firmenwissen).`
      : `Kunden-Persona-Fragebogen für Wunschkunde „${input.wunschkundeLabel?.trim() || "Avatar"}“ von „${input.organisationName}“.`;

  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: [DEFAULT_SURVEY_ACTION_MODEL],
    maxTokens: 1800,
    timeoutMs: 55_000,
    stream: false,
    system:
      "Du hilfst beim Aufbau deutscher Fragebögen. Nutze nur Informationen aus dem Crawl-Kontext. Antworte nur mit JSON.",
    messages: [
      {
        role: "user",
        content: `${audience}

Kernfragen:
${input.coreItems.map((c) => `- [${c.key}] ${c.title}${c.hasPrefill ? " (schon vorausgefüllt)" : ""}`).join("\n")}

Noch ohne Prefill:
${missing.map((c) => `- ${c.key}: ${c.title}`).join("\n") || "(alle Kernfragen haben schon Prefill)"}

Website-/Crawl-Kontext:
${input.crawlSummary.slice(0, 10000)}

Aufgabe:
1) Für fehlende Kernfragen: kurze Antwortvorschläge NUR wenn der Crawl das klar hergibt (sonst weglassen).
2) ${input.includeAiExtras ? `Bis zu ${maxExtras} zusätzliche unternehmensspezifische Fragen vorschlagen (nicht die Kernfragen wiederholen).` : "Keine Zusatzfragen (questions=[])."}

JSON:
{
  "prefills":[{"key":"focus","value":"...","note":"kurz warum"}],
  "questions":["Zusatzfrage 1?"]
}`,
      },
    ],
  });

  if (!result) return { extras: [], aiPrefills: {} };
  const raw = extractAnthropicText(result.response);
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) return { extras: [], aiPrefills: {} };

  try {
    const parsed = JSON.parse(jsonText) as {
      prefills?: Array<{ key?: unknown; value?: unknown; note?: unknown }>;
      questions?: unknown;
    };
    const allowedKeys = new Set(missing.map((m) => m.key));
    const aiPrefills: Record<string, PrefillDraft> = {};
    for (const row of parsed.prefills ?? []) {
      const key = String(row.key ?? "").trim();
      const value = String(row.value ?? "").trim();
      if (!allowedKeys.has(key) || value.length < 3) continue;
      aiPrefills[key] = {
        value: value.slice(0, 500),
        source: "ai",
        note: String(row.note ?? "KI-Vorschlag aus Crawl — bitte prüfen").slice(0, 160),
      };
    }
    const extras = input.includeAiExtras
      ? (Array.isArray(parsed.questions) ? parsed.questions : [])
          .map((q) => String(q ?? "").trim())
          .filter((q) => q.length >= 8)
          .slice(0, maxExtras)
      : [];
    return { extras, aiPrefills };
  } catch {
    return { extras: [], aiPrefills: {} };
  }
}

/**
 * Build a reviewable draft (not yet persisted).
 */
export async function buildFragebogenReviewDraft(input: {
  organisationId: string;
  purpose: SurveyPurpose;
  wunschkundeLabel?: string | null;
  selectedCoreKeys?: string[] | null;
  includeAiExtras?: boolean;
  extraPlacement?: ExtraQuestionPlacement;
}): Promise<FragebogenReviewDraft> {
  const purpose = input.purpose;
  const extraPlacement = input.extraPlacement ?? "end";
  const allCore = coreQuestionsForPurpose(purpose);
  const selectedKeys = new Set(
    (input.selectedCoreKeys?.length
      ? input.selectedCoreKeys
      : allCore.map((c) => c.key)
    ).filter(Boolean),
  );
  const selectedTemplates: CoreQuestionTemplate[] = allCore.filter((c) =>
    selectedKeys.has(c.key),
  );
  if (selectedTemplates.length === 0) {
    throw new Error("Mindestens eine Kernfrage muss ausgewählt sein.");
  }

  const crawl = await loadOrgCrawlContext(input.organisationId);
  const heuristic = suggestPrefillsFromCrawl({
    context: crawl,
    hints: selectedTemplates.map((t) => ({ key: t.key, hint: t.prefillHint })),
  });

  const aiBundle = await generateExtrasAndAiPrefills({
    purpose,
    organisationName: crawl.organisationName,
    wunschkundeLabel: input.wunschkundeLabel,
    crawlSummary: crawl.summaryText,
    includeAiExtras: Boolean(input.includeAiExtras),
    coreItems: selectedTemplates.map((t) => ({
      key: t.key,
      title: t.title,
      hasPrefill: Boolean(heuristic[t.key]?.value),
    })),
  });

  const prefills: Record<string, PrefillDraft> = { ...heuristic };
  for (const [key, draft] of Object.entries(aiBundle.aiPrefills)) {
    if (!prefills[key]) prefills[key] = draft;
  }

  const coreQuestions: ReviewQuestionItem[] = selectedTemplates.map((t) => {
    const draft = prefills[t.key];
    return {
      id: fieldIdForCoreKey(t.key),
      kind: "core",
      coreKey: t.key,
      title: t.title,
      description: t.description,
      included: true,
      answer: draft?.value ?? "",
      answerSource: draft?.source ?? "none",
      answerNote: draft?.note ?? "",
    };
  });

  const extraQuestions: ReviewQuestionItem[] = aiBundle.extras.map((title, index) => ({
    id: `extra_${slugifyKey(title)}_${index + 1}`,
    kind: "extra" as const,
    title,
    description: "Individuelle Zusatzfrage aus Crawl/KI — bei Bedarf entfernen oder umformulieren.",
    included: true,
    answer: "",
    answerSource: "none" as const,
    answerNote: "",
  }));

  const questions =
    extraPlacement === "start"
      ? [...extraQuestions, ...coreQuestions]
      : [...coreQuestions, ...extraQuestions];

  const title =
    purpose === "anbieter"
      ? `Anbieter: ${crawl.organisationName}`
      : `Persona: ${input.wunschkundeLabel?.trim() || "Wunschkunde"} (${crawl.organisationName})`;

  const description =
    purpose === "anbieter"
      ? `Firmenfragebogen für ${crawl.organisationName}. Kernfragen fest + optionale Zusatzfragen aus Website-Crawl.`
      : `Wunschkunden-Fragebogen für ${crawl.organisationName}. Kernfragen fest + optionale Zusatzfragen.`;

  return {
    title,
    description,
    purpose,
    extraPlacement,
    crawlPageCount: crawl.pageCount,
    websiteUrl: crawl.websiteUrl,
    organisationName: crawl.organisationName,
    questions,
  };
}

function surveyFromReview(draft: FragebogenReviewDraft): Survey {
  const included = draft.questions.filter((q) => q.included && q.title.trim());
  if (included.length === 0) {
    throw new Error("Mindestens eine Frage muss übernommen werden.");
  }

  const coreIncluded = included.filter((q) => q.kind === "core");
  const extraIncluded = included.filter((q) => q.kind === "extra");
  const original = coreQuestionsForPurpose(draft.purpose);
  const byKey = new Map(original.map((t) => [t.key, t]));

  const extrasStep: SurveyStep | null =
    extraIncluded.length > 0
      ? {
          id: "extra_individual",
          title: "Individuelle Fragen",
          description:
            "Zusatzfragen aus Website-Kontext. Veraltetes löschen, Neues ergänzen.",
          fields: extraIncluded.map((q) => ({
            id: q.id,
            type: "text" as const,
            title: q.title.trim(),
            description: q.description,
            required: false,
          })),
        }
      : null;

  const coreByStep = new Map<string, SurveyStep>();
  for (const q of coreIncluded) {
    const key = q.coreKey || q.id.replace(/^core_/, "");
    const base = byKey.get(key);
    const stepId = base?.stepId ?? "core_reviewed";
    const stepTitle = base?.stepTitle ?? "Kernfragen";
    const field: SurveyField = {
      id: q.id,
      type: "text",
      title: q.title.trim(),
      description: q.description,
      required: base?.required ?? false,
    };
    const existing = coreByStep.get(stepId);
    if (existing) existing.fields.push(field);
    else {
      coreByStep.set(stepId, {
        id: stepId,
        title: stepTitle,
        description: "",
        fields: [field],
      });
    }
  }

  const coreSteps = [...coreByStep.values()];
  const steps =
    extrasStep == null
      ? coreSteps
      : draft.extraPlacement === "start"
        ? [extrasStep, ...coreSteps]
        : [...coreSteps, extrasStep];

  const definitionCandidate: Survey = {
    version: 1,
    id: randomUUID(),
    title: draft.title.trim() || "Fragebogen",
    description: draft.description,
    infoTextEnabled: false,
    infoText: "",
    answerPlaceholder: "Deine Antwort…",
    steps,
  };

  const parsed = surveySchema.safeParse(definitionCandidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Fragebogen-Definition ungültig.");
  }
  return parsed.data as Survey;
}

export function answersFromReview(
  draft: FragebogenReviewDraft,
  savePrefills: boolean,
): Record<string, string> {
  if (!savePrefills) return {};
  const out: Record<string, string> = {};
  for (const q of draft.questions) {
    if (!q.included) continue;
    const answer = q.answer.trim();
    if (!answer) continue;
    out[q.id] = answer;
  }
  return out;
}

export function buildSurveyAndAnswersFromReview(input: {
  draft: FragebogenReviewDraft;
  savePrefills: boolean;
}): { definition: Survey; answers: Record<string, string> } {
  return {
    definition: surveyFromReview(input.draft),
    answers: answersFromReview(input.draft, input.savePrefills),
  };
}

/** @deprecated use buildFragebogenReviewDraft */
export async function buildFragebogenFromOrg(input: {
  organisationId: string;
  purpose: SurveyPurpose;
  wunschkundeLabel?: string | null;
  selectedCoreKeys?: string[] | null;
  includeAiExtras?: boolean;
  extraPlacement?: ExtraQuestionPlacement;
}) {
  const review = await buildFragebogenReviewDraft(input);
  const { definition, answers } = buildSurveyAndAnswersFromReview({
    draft: review,
    savePrefills: true,
  });
  return {
    title: review.title,
    description: review.description,
    purpose: review.purpose,
    definition,
    suggestedAnswers: answers,
    prefillMeta: Object.fromEntries(
      review.questions
        .filter((q) => q.answerSource !== "none" && q.answer.trim())
        .map((q) => [
          q.id,
          {
            value: q.answer,
            source: q.answerSource === "none" ? "crawl" : q.answerSource,
            note: q.answerNote,
          } satisfies PrefillDraft,
        ]),
    ),
    extraQuestionTitles: review.questions
      .filter((q) => q.kind === "extra" && q.included)
      .map((q) => q.title),
    crawlPageCount: review.crawlPageCount,
  };
}
