import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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
} from "@/lib/surveys/org-crawl-context";
import {
  meetingBriefingContextText,
  meetingBriefingHasContent,
  suggestPrefillsFromMeeting,
  type MeetingBriefing,
} from "@/lib/surveys/meeting-briefing";
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import {
  type ExtraQuestionPlacement,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
  buildSurveyAndAnswersFromReview,
} from "@/lib/surveys/fragebogen-review-draft";

export type { MeetingBriefing, ExtraQuestionPlacement, FragebogenReviewDraft, ReviewQuestionItem };
export { buildSurveyAndAnswersFromReview } from "@/lib/surveys/fragebogen-review-draft";

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
  meetingContext?: string;
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

  const meetingBlock = input.meetingContext?.trim()
    ? `\nKundengespräch / Meeting-Briefing (PRIORITÄT — direkt übernehmen, nicht erfinden):\n${input.meetingContext.slice(0, 6000)}\n`
    : "";

  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: [DEFAULT_SURVEY_ACTION_MODEL],
    maxTokens: 1800,
    timeoutMs: 55_000,
    stream: false,
    system:
      "Du hilfst beim Aufbau deutscher Fragebögen. Nutze Meeting-Briefing und Crawl. Meeting-Angaben haben Vorrang. Antworte nur mit JSON.",
    messages: [
      {
        role: "user",
        content: `${audience}

Kernfragen:
${input.coreItems.map((c) => `- [${c.key}] ${c.title}${c.hasPrefill ? " (schon vorausgefüllt)" : ""}`).join("\n")}

Noch ohne Prefill:
${missing.map((c) => `- ${c.key}: ${c.title}`).join("\n") || "(alle Kernfragen haben schon Prefill)"}
${meetingBlock}
Website-/Crawl-Kontext:
${input.crawlSummary.slice(0, 8000)}

Aufgabe:
1) Für fehlende Kernfragen: kurze Antwortvorschläge — zuerst aus Meeting, sonst nur wenn Crawl klar hergibt (sonst weglassen).
2) Mitbewerber/gute Wettbewerber/Inhaber/Seiten-Links aus dem Meeting möglichst wörtlich übernehmen.
3) ${input.includeAiExtras ? `Bis zu ${maxExtras} zusätzliche unternehmensspezifische Fragen vorschlagen (nicht die Kernfragen wiederholen).` : "Keine Zusatzfragen (questions=[])."}

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
        note: String(row.note ?? "KI-Vorschlag — bitte prüfen").slice(0, 160),
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
  meetingBriefing?: MeetingBriefing | null;
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

  const hints = selectedTemplates.map((t) => ({ key: t.key, hint: t.prefillHint }));
  const crawl = await loadOrgCrawlContext(input.organisationId);
  const heuristic = suggestPrefillsFromCrawl({
    context: crawl,
    hints,
  });
  const meeting = suggestPrefillsFromMeeting({
    briefing: input.meetingBriefing ?? {},
    hints,
  });
  const meetingText = meetingBriefingHasContent(input.meetingBriefing)
    ? meetingBriefingContextText(input.meetingBriefing)
    : "";

  // Crawl first, then AI for gaps — Meeting wins over both.
  const basePrefills: Record<string, PrefillDraft> = { ...heuristic };

  const aiBundle = await generateExtrasAndAiPrefills({
    purpose,
    organisationName: crawl.organisationName,
    wunschkundeLabel: input.wunschkundeLabel,
    crawlSummary: crawl.summaryText,
    meetingContext: meetingText,
    includeAiExtras: Boolean(input.includeAiExtras),
    coreItems: selectedTemplates.map((t) => ({
      key: t.key,
      title: t.title,
      hasPrefill: Boolean(basePrefills[t.key]?.value || meeting[t.key]?.value),
    })),
  });

  const prefills: Record<string, PrefillDraft> = { ...basePrefills };
  for (const [key, draft] of Object.entries(aiBundle.aiPrefills)) {
    if (!prefills[key]) prefills[key] = draft;
  }
  for (const [key, draft] of Object.entries(meeting)) {
    prefills[key] = draft;
  }

  // Seiten/Links aus dem Meeting als optionale Extra-Antwort-Notiz anhängen,
  // wenn noch keine extra-Frage dazu existiert — als eigene „Notiz“-Extrafrage.
  const pagesOrLinks = (input.meetingBriefing?.pagesOrLinks ?? "").trim();
  const notes = (input.meetingBriefing?.notes ?? "").trim();
  const meetingExtras: ReviewQuestionItem[] = [];
  if (pagesOrLinks) {
    meetingExtras.push({
      id: "extra_meeting_pages_links",
      kind: "extra",
      title: "Welche Seiten, Landingpages oder Links wurden im Kundengespräch genannt?",
      description: "Direkt aus dem Meeting — prüfen und bei Bedarf kürzen.",
      included: true,
      required: false,
      type: "text",
      options: [],
      answer: pagesOrLinks.slice(0, 2000),
      answerSource: "meeting",
      answerNote: "Aus Kundengespräch übernommen",
    });
  }
  if (notes) {
    meetingExtras.push({
      id: "extra_meeting_notes",
      kind: "extra",
      title: "Weitere relevante Punkte aus dem Kundengespräch",
      description: "Freie Notizen aus dem Briefing — in Antworten überführen oder entfernen.",
      included: true,
      required: false,
      type: "text",
      options: [],
      answer: notes.slice(0, 2000),
      answerSource: "meeting",
      answerNote: "Aus Kundengespräch übernommen",
    });
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
      required: t.required,
      type: t.type,
      options: [],
      answer: draft?.value ?? "",
      answerSource: draft?.source ?? "none",
      answerNote: draft?.note ?? "",
    };
  });

  const extraQuestions: ReviewQuestionItem[] = [
    ...meetingExtras,
    ...aiBundle.extras.map((title, index) => ({
      id: `extra_${slugifyKey(title)}_${index + 1}`,
      kind: "extra" as const,
      title,
      description:
        "Individuelle Zusatzfrage aus Crawl/KI — bei Bedarf entfernen oder umformulieren.",
      included: true,
      required: false,
      type: "text" as const,
      options: [],
      answer: "",
      answerSource: "none" as const,
      answerNote: "",
    })),
  ];

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
      ? `Firmenfragebogen für ${crawl.organisationName}. Kernfragen + Meeting/Crawl-Vorlagen.`
      : `Wunschkunden-Fragebogen für ${crawl.organisationName}. Kernfragen + optionale Zusatzfragen.`;

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
