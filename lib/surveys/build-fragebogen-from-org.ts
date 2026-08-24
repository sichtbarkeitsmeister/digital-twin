import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractFirstJsonObject,
  escapeControlCharsInJsonStrings,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyChatModels } from "@/lib/ai/survey-model-config";
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
import {
  buildMeetingExtraQuestions,
  meetingBriefingContextText,
  meetingBriefingHasContent,
  suggestPrefillsFromMeeting,
  type MeetingBriefing,
} from "@/lib/surveys/meeting-briefing";
import {
  formatSourceDocuments,
  normalizeSourceDocuments,
  type SourceDocument,
} from "@/lib/surveys/source-documents";
import { joinAiWarnings, parseAiExtraQuestions } from "@/lib/surveys/ai-extra-questions";
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

function aiTimeoutWarning(err: unknown, timedOutText: string, failedText: string): string {
  const message = err instanceof Error ? err.message : "";
  return /Zeitlimit|timeout|aborted/i.test(message) ? timedOutText : failedText;
}

function parseModelJson(result: { response: Anthropic.Messages.Message } | null): Record<
  string,
  unknown
> | null {
  if (!result) return null;
  const raw = extractAnthropicText(result.response);
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function generateExtrasAndAiPrefills(input: {
  purpose: SurveyPurpose;
  organisationName: string;
  wunschkundeLabel?: string | null;
  crawlSummary: string;
  meetingContext?: string;
  documentText?: string;
  coreItems: Array<{ key: string; title: string; hasPrefill: boolean }>;
  includeAiExtras: boolean;
  maxExtras?: number;
}): Promise<{ extras: string[]; aiPrefills: Record<string, PrefillDraft>; warning: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { extras: [], aiPrefills: {}, warning: null };

  const anthropic = new Anthropic({ apiKey });
  const maxExtras = input.maxExtras ?? 6;
  const missing = input.coreItems.filter((c) => !c.hasPrefill);
  const audience =
    input.purpose === "anbieter"
      ? `Anbieter-Fragebogen für „${input.organisationName}“ (Firmenwissen).`
      : input.purpose === "intern"
        ? `Interner Recherche-Fragebogen (TEIL C) für „${input.organisationName}“. Nicht an den Kunden.`
        : `Kunden-Persona-Fragebogen für Wunschkunde „${input.wunschkundeLabel?.trim() || "Avatar"}“ von „${input.organisationName}“.`;

  const documentBlock = input.documentText?.trim()
    ? `\nHochgeladene Dateien (HÖCHSTE PRIORITÄT):\n${input.documentText.slice(0, 8000)}\n`
    : "";
  const meetingBlock = input.meetingContext?.trim()
    ? `\nMeeting-Briefing:\n${input.meetingContext.slice(0, 3500)}\n`
    : "";
  const crawlBlock = input.crawlSummary.slice(0, 9000);
  const targets = missing.length > 0 ? missing : input.coreItems.slice(0, 12);
  const models = resolveSurveyChatModels();

  const prefillsTask = (async (): Promise<{
    aiPrefills: Record<string, PrefillDraft>;
    warning: string | null;
  }> => {
    try {
      const result = await callAnthropicFirstAvailable({
        anthropic,
        models,
        maxTokens: 2500,
        timeoutMs: 35_000,
        stream: true,
        system:
          "Du füllst deutsche Fragebogen-Felder aus belegtem Kontext. Nichts erfinden. Nur JSON.",
        messages: [
          {
            role: "user",
            content: `${audience}

Offene Kernfragen:
${targets.map((c) => `- [${c.key}] ${c.title}`).join("\n")}
${documentBlock}${meetingBlock}
Crawl (Presse, Über uns, Team, Leistungen zuerst):
${crawlBlock}

Fülle nur Felder, die der Kontext klar hergibt. Team, Leistungen, USP, Standort, Presse besonders. source=upload bei Dateien, sonst source=ai.

{"prefills":[{"key":"team_members","value":"...","note":"kurz","source":"upload"}]}`,
          },
        ],
      });
      if (!result) {
        return {
          aiPrefills: {},
          warning:
            "KI-Vorausfüllung war nicht verfügbar. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
        };
      }
      const parsed = parseModelJson(result);
      const allowedKeys = new Set(input.coreItems.map((m) => m.key));
      const alreadyFilled = new Set(
        input.coreItems.filter((c) => c.hasPrefill).map((c) => c.key),
      );
      const aiPrefills: Record<string, PrefillDraft> = {};
      const rows = Array.isArray(parsed?.prefills) ? parsed.prefills : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const key = String(rec.key ?? "").trim();
        const value = String(rec.value ?? "").trim();
        if (!allowedKeys.has(key) || value.length < 3) continue;
        const fromUpload = String(rec.source ?? "").trim() === "upload";
        if (!fromUpload && alreadyFilled.has(key)) continue;
        aiPrefills[key] = {
          value: value.slice(0, 2000),
          source: fromUpload ? "upload" : "ai",
          note: String(
            rec.note ??
              (fromUpload
                ? "Aus hochgeladener Datei — bitte prüfen"
                : "KI-Vorschlag aus Crawl — bitte prüfen"),
          ).slice(0, 160),
        };
      }
      return { aiPrefills, warning: null };
    } catch (err) {
      return {
        aiPrefills: {},
        warning: aiTimeoutWarning(
          err,
          "KI-Vorausfüllung hat zu lange gedauert. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
          "KI-Vorausfüllung ist ausgefallen. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
        ),
      };
    }
  })();

  const extrasTask = input.includeAiExtras
    ? (async (): Promise<{ extras: string[]; warning: string | null }> => {
        try {
          const result = await callAnthropicFirstAvailable({
            anthropic,
            models,
            maxTokens: 1200,
            timeoutMs: 25_000,
            stream: true,
            system:
              "Du schlägst Zusatzfragen für deutsche Fragebögen vor. Nur JSON. Keine Kernfragen wiederholen.",
            messages: [
              {
                role: "user",
                content: `${audience}

Diese Kernfragen gibt es schon — NICHT wiederholen:
${input.coreItems.map((c) => `- ${c.title}`).join("\n")}
${documentBlock}${meetingBlock}
Crawl (Branche, Leistungen, Region, Team):
${input.crawlSummary.slice(0, 6000)}

Schlage ${maxExtras} unternehmensspezifische Zusatzfragen vor, die die Vorlage nicht abdeckt (z. B. besondere Leistungen, Standorte, Zertifikate, Zielgruppen, Tools). Nur Fragetexte, keine Antworten.

{"questions":["Welche konkreten Referenzen aus [Branche] dürfen öffentlich genannt werden?","Gibt es saisonale Angebote oder Wartezeiten, die Kund:innen kennen sollten?"]}`,
              },
            ],
          });
          if (!result) {
            return {
              extras: [],
              warning:
                "KI-Zusatzfragen waren nicht verfügbar. Du kannst sie in der Prüfung selbst ergänzen.",
            };
          }
          const parsed = parseModelJson(result);
          const extras = parseAiExtraQuestions(parsed?.questions, maxExtras);
          return {
            extras,
            warning:
              extras.length === 0
                ? "Die KI hat keine Zusatzfragen vorgeschlagen. Du kannst sie in der Prüfung selbst ergänzen."
                : null,
          };
        } catch (err) {
          return {
            extras: [],
            warning: aiTimeoutWarning(
              err,
              "KI-Zusatzfragen haben zu lange gedauert. Du kannst sie in der Prüfung selbst ergänzen.",
              "KI-Zusatzfragen sind ausgefallen. Du kannst sie in der Prüfung selbst ergänzen.",
            ),
          };
        }
      })()
    : Promise.resolve({ extras: [] as string[], warning: null as string | null });

  const [prefillBundle, extrasBundle] = await Promise.all([prefillsTask, extrasTask]);
  return {
    extras: extrasBundle.extras,
    aiPrefills: prefillBundle.aiPrefills,
    warning: joinAiWarnings(prefillBundle.warning, extrasBundle.warning),
  };
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
  sourceDocuments?: SourceDocument[] | null;
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
  const documents = normalizeSourceDocuments(input.sourceDocuments);
  const documentText = formatSourceDocuments(documents);

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

  // Crawl first, then AI for gaps — Meeting, then uploaded files win.
  const basePrefills: Record<string, PrefillDraft> = { ...heuristic };

  const aiBundle = await generateExtrasAndAiPrefills({
    purpose,
    organisationName: crawl.organisationName,
    wunschkundeLabel: input.wunschkundeLabel,
    crawlSummary: crawl.summaryText,
    meetingContext: meetingText,
    documentText,
    includeAiExtras: Boolean(input.includeAiExtras),
    coreItems: selectedTemplates.map((t) => ({
      key: t.key,
      title: t.title,
      hasPrefill: Boolean(basePrefills[t.key]?.value || meeting[t.key]?.value),
    })),
  });

  const prefills: Record<string, PrefillDraft> = { ...basePrefills };
  for (const [key, draft] of Object.entries(aiBundle.aiPrefills)) {
    if (draft.source === "upload" || !prefills[key]) prefills[key] = draft;
  }
  for (const [key, draft] of Object.entries(meeting)) {
    if (prefills[key]?.source === "upload") continue;
    prefills[key] = draft;
  }

  // Meeting notes → Kernfragen (via suggestPrefillsFromMeeting) + getrennte Zusatzfragen
  // (Region/USP → Kern; Fokuskeywords/Links → eigene Fragen; kein Notiz-Haufen).
  const meetingExtras: ReviewQuestionItem[] = buildMeetingExtraQuestions(
    briefing,
  ).map((e) => ({
    id: e.id,
    kind: "extra" as const,
    title: e.title,
    description: e.description,
    included: true,
    required: true,
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
            required: true,
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
        "KI-Vorschlag für dieses Unternehmen — bearbeiten, kopieren oder löschen.",
      included: true,
      required: true,
      type: "text" as const,
      options: [],
      answer: "",
      answerSource: "ai" as const,
      answerNote: "KI-Vorschlag — bitte prüfen",
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
    aiWarning: aiBundle.warning,
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
