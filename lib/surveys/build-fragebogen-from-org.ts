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
import { formatSeoMetricsAnswer } from "@/lib/surveys/org-crawl-prefill";
import {
  firstConversationToMeetingBriefing,
} from "@/lib/surveys/first-conversation";
import { loadFirstConversationIfAny } from "@/lib/surveys/first-conversation-store";
import { loadFirstConversationDocumentText } from "@/lib/surveys/first-conversation-files";
import {
  buildMeetingExtraQuestions,
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
  documentContext?: string;
  coreItems: Array<{ key: string; title: string; hasPrefill: boolean }>;
  includeAiExtras: boolean;
  maxExtras?: number;
}): Promise<{ extras: string[]; aiPrefills: Record<string, PrefillDraft> }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { extras: [], aiPrefills: {} };

  const anthropic = new Anthropic({ apiKey });
  const maxExtras = input.maxExtras ?? 8;
  const missing = input.coreItems.filter((c) => !c.hasPrefill);
  const audience =
    input.purpose === "anbieter"
      ? `Anbieter-Fragebogen für „${input.organisationName}“ (Firmenwissen).`
      : input.purpose === "intern"
        ? `Interner Recherche-Fragebogen (TEIL C) für „${input.organisationName}“. Nicht an den Kunden.`
        : `Kunden-Persona-Fragebogen für Wunschkunde „${input.wunschkundeLabel?.trim() || "Avatar"}“ von „${input.organisationName}“.`;

  const meetingBlock = input.meetingContext?.trim()
    ? `\nKundengespräch / Meeting-Briefing (PRIORITÄT — direkt übernehmen, nicht erfinden):\n${input.meetingContext.slice(0, 6000)}\n`
    : "";
  const documentBlock = input.documentContext?.trim()
    ? `\nHochgeladene Meeting-Zusammenfassungen / Unternehmensunterlagen (nur übernehmen, was klar im Text steht):\n${input.documentContext.slice(0, 12000)}\n`
    : "";

  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: [DEFAULT_SURVEY_ACTION_MODEL],
    maxTokens: 4000,
    timeoutMs: 70_000,
    stream: false,
    system:
      "Du hilfst beim Aufbau deutscher Fragebögen. Nutze Erstgespräch, hochgeladene Meeting-Dokumente, Website-Crawl und SEO-Zahlen. Meeting hat Vorrang, dann Dokumente, dann belegbare Crawl-/Performance-Daten. Nichts erfinden. Antworte nur mit JSON.",
    messages: [
      {
        role: "user",
        content: `${audience}

Kernfragen:
${input.coreItems.map((c) => `- [${c.key}] ${c.title}${c.hasPrefill ? " (schon vorausgefüllt)" : ""}`).join("\n")}

Noch ohne Prefill — bitte alles ausfüllen, was Meeting, Dokumente, Crawl oder SEO-Zahlen klar hergeben:
${missing.map((c) => `- ${c.key}: ${c.title}`).join("\n") || "(alle Kernfragen haben schon Prefill)"}
${meetingBlock}${documentBlock}
Website-/Crawl-/SEO-Kontext:
${input.crawlSummary.slice(0, 14000)}

Aufgabe:
1) Für fehlende Kernfragen: Antwortvorschläge. Reihenfolge: Meeting, dann hochgeladene Dokumente, dann Crawl/SEO. Wenn unklar: weglassen.
2) Zahlen (Impressionen, Klicks, Rankings, Teamgröße) wörtlich aus dem Kontext übernehmen, nicht runden oder schätzen.
3) Mitbewerber/gute Wettbewerber/Inhaber/Seiten-Links aus Meeting oder Dokumenten möglichst wörtlich übernehmen.
4) ${input.includeAiExtras ? `Bis zu ${maxExtras} zusätzliche unternehmensspezifische Fragen vorschlagen. Nicht die Kernfragen wiederholen.` : "Keine Zusatzfragen (questions=[])."}

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
        value: value.slice(0, 2000),
        source: "ai",
        note: String(row.note ?? "KI-Vorschlag aus Dokument/Crawl — bitte prüfen").slice(0, 160),
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

  let briefing = input.meetingBriefing ?? null;
  if (!meetingBriefingHasContent(briefing)) {
    const saved = await loadFirstConversationIfAny(input.organisationId);
    if (saved) briefing = firstConversationToMeetingBriefing(saved);
  }

  const heuristic = suggestPrefillsFromCrawl({
    context: crawl,
    hints,
  });
  const meeting = suggestPrefillsFromMeeting({
    briefing: briefing ?? {},
    hints,
  });
  const meetingText = meetingBriefingHasContent(briefing)
    ? meetingBriefingContextText(briefing)
    : "";

  const documentText = await loadFirstConversationDocumentText(input.organisationId);
  const fromDocuments = suggestPrefillsFromMeeting({
    briefing: documentText ? { notes: documentText } : {},
    hints,
  });
  const documentPrefills: Record<string, PrefillDraft> = {};
  for (const [key, draft] of Object.entries(fromDocuments)) {
    documentPrefills[key] = {
      ...draft,
      source: "document",
      note: "Aus hochgeladenem Meeting-Dokument übernommen",
    };
  }

  // Crawl first, documents, AI gaps — Meeting/Erstgespräch wins.
  const basePrefills: Record<string, PrefillDraft> = { ...heuristic };
  for (const [key, draft] of Object.entries(documentPrefills)) {
    if (!basePrefills[key]) basePrefills[key] = draft;
  }

  const aiBundle = await generateExtrasAndAiPrefills({
    purpose,
    organisationName: crawl.organisationName,
    wunschkundeLabel: input.wunschkundeLabel,
    crawlSummary: crawl.summaryText,
    meetingContext: meetingText,
    documentContext: documentText,
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

  // Meeting notes → Kernfragen (via suggestPrefillsFromMeeting) + getrennte Zusatzfragen
  // (Region/USP → Kern; Fokuskeywords/Links → eigene Fragen; kein Notiz-Haufen).
  const customerRequired = purpose !== "intern";

  const meetingExtras: ReviewQuestionItem[] = buildMeetingExtraQuestions(
    briefing,
  ).map((e) => ({
    id: e.id,
    kind: "extra" as const,
    title: e.title,
    description: e.description,
    included: true,
    required: customerRequired,
    type: "text" as const,
    options: [],
    answer: e.answer,
    answerSource: "meeting" as const,
    answerNote: "Aus Kundengespräch übernommen",
  }));

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
      options: (t.options ?? []).map((o) => ({ id: o.id, label: o.label })),
      allowOtherOption: t.allowOtherOption,
      allowExtraEntries: t.allowExtraEntries,
      allowCustomEntries: t.allowCustomEntries,
      addEntryLabel: t.addEntryLabel,
      answer: draft?.value ?? "",
      answerSource: draft?.source ?? "none",
      answerNote: draft?.note ?? "",
    };
  });

  const seoExtra: ReviewQuestionItem[] =
    crawl.seoMetrics &&
    !selectedTemplates.some((t) => t.prefillHint === "seo_metrics" && prefills[t.key]?.value)
      ? [
          {
            id: "extra_seo_performance",
            kind: "extra" as const,
            title:
              "Aktuelle Performance-Daten (Impressionen, Klicks, Rankings) — automatisch aus SEO/Crawl",
            description:
              "Nicht vom Kunden ausfüllen. Zahlen aus dem Monatsstand; bitte prüfen, nichts ergänzen, was nicht belegt ist.",
            included: true,
            required: false,
            type: "text" as const,
            options: [],
            answer: formatSeoMetricsAnswer(crawl.seoMetrics),
            answerSource: "organisation" as const,
            answerNote: "Monatliche SEO-Zahlen",
          },
        ]
      : [];

  const extraQuestions: ReviewQuestionItem[] = [
    ...meetingExtras,
    ...seoExtra,
    ...aiBundle.extras.map((title, index) => ({
      id: `extra_${slugifyKey(title)}_${index + 1}`,
      kind: "extra" as const,
      title,
      description:
        "Individuelle Zusatzfrage aus Crawl/KI — bearbeiten, kopieren oder löschen.",
      included: true,
      required: customerRequired,
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
      : purpose === "intern"
        ? `Intern: ${crawl.organisationName}`
        : `Persona: ${input.wunschkundeLabel?.trim() || "Wunschkunde"} (${crawl.organisationName})`;

  const description =
    purpose === "anbieter"
      ? `Firmenfragebogen für ${crawl.organisationName}. Kernfragen + Meeting/Crawl-Vorlagen.`
      : purpose === "intern"
        ? `Interner Recherche-Block für ${crawl.organisationName}. Nicht an den Kunden senden.`
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
