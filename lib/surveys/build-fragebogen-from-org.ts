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
import {
  extractServiceLabels,
  formatSeoMetricsAnswer,
  isPlausiblePrefill,
  parseServiceLabelList,
} from "@/lib/surveys/org-crawl-prefill";
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
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import {
  type ExtraQuestionPlacement,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
  buildSurveyAndAnswersFromReview,
  createSurveyDefinitionId,
} from "@/lib/surveys/fragebogen-review-draft";
import {
  applyClientAudienceToText,
  resolveAudienceVocab,
  type ClientAudienceKind,
  type ClientAudienceVocab,
} from "@/lib/surveys/client-audience";
import { customizeCoreQuestions, mergeSuggestedCheckboxOptions } from "@/lib/surveys/customize-fragebogen";
import { generatedChoiceCustomOptionFlags } from "@/lib/surveys/choice-custom-options";
import { extraGapHints, parseAiExtraQuestions } from "@/lib/surveys/ai-extra-questions";
import { proofreadAiExtraQuestions } from "@/lib/surveys/proofread-ai-extras";

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
  documentText?: string;
  coreItems: Array<{
    key: string;
    title: string;
    hasPrefill: boolean;
    hint?: CoreQuestionTemplate["prefillHint"];
  }>;
  includeAiExtras: boolean;
  vocab: ClientAudienceVocab;
  serviceLabels: string[];
  maxExtras?: number;
}): Promise<{
  extras: Array<{ title: string; description: string }>;
  aiPrefills: Record<string, PrefillDraft>;
  optionSets: Record<string, string[]>;
  warning: string | null;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { extras: [], aiPrefills: {}, optionSets: {}, warning: null };

  const anthropic = new Anthropic({ apiKey });
  const maxExtras = input.maxExtras ?? 4;
  const missing = input.coreItems.filter((c) => !c.hasPrefill);
  const vocab = input.vocab;
  const audience =
    input.purpose === "anbieter"
      ? `Anbieter-Fragebogen für „${input.organisationName}“ (${vocab.label}). Wortwahl strikt: Anbieter = „${vocab.business}“, Person = „${vocab.singular}“ / „${vocab.plural}“, Arbeit = „${vocab.engagement}“. Nicht Mandat/Patient/Kunde vermischen.`
      : input.purpose === "intern"
        ? `Interner Recherche-Fragebogen (TEIL C) für „${input.organisationName}“. Nicht an den Kunden.`
        : `Persona-Fragebogen für Wunsch${vocab.singular.toLowerCase()} „${input.wunschkundeLabel?.trim() || "Avatar"}“ von „${input.organisationName}“ (${vocab.label}). Person heißt durchgängig ${vocab.singular}. Arbeit heißt ${vocab.engagement}.`;

  const documentBlock = input.documentText?.trim()
    ? `\nHochgeladene Dateien (HÖCHSTE PRIORITÄT):\n${input.documentText.slice(0, 8000)}\n`
    : "";
  const meetingBlock = input.meetingContext?.trim()
    ? `\nMeeting-Briefing:\n${input.meetingContext.slice(0, 3500)}\n`
    : "";
  const servicesBlock = input.serviceLabels.length
    ? `\nBereits erkannte Leistungen:\n${input.serviceLabels.map((s) => `- ${s}`).join("\n")}\n`
    : "";

  const targets = missing.length > 0 ? missing : input.coreItems.slice(0, 12);

  try {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyChatModels(),
      maxTokens: 3200,
      timeoutMs: 35_000,
      stream: true,
      system:
        "Du lieferst nur JSON. Prefills und optionSets nur aus belegtem Kontext — dort nichts erfinden. questions sind neue Fragen zu Lücken (keine Antworten erfinden).",
      messages: [
        {
          role: "user",
          content: `${audience}

Offene Kernfragen (nur diese prefills füllen, wenn der Kontext es hergibt):
${targets.map((c) => `- [${c.key}] ${c.title}`).join("\n")}

Bereits im Fragebogen — NICHT als Zusatzfrage wiederholen:
${input.coreItems.map((c) => `- ${c.title}`).join("\n")}
${documentBlock}${meetingBlock}${servicesBlock}
Crawl (Presse, Über uns, Team, Leistungen, Impressum zuerst):
${input.crawlSummary.slice(0, 9000)}

Fülle nur Felder, die der Kontext klar hergibt. Team, Leistungen, USP, Standort, Impressum, Presse besonders. source=upload bei Dateien, sonst source=ai.
Strikt zuordnen — lieber weglassen als falsch:
- company_name: nur offizieller Praxis-/Firmenname, nie Behandlungs- oder Preistext.
- location_catchment: nur Sitz/Ort/Einzugsgebiet (z. B. Meerbusch), nie Preisliste. „pro Region“ bei Botox ist KEINE Region.
- portfolio / Leistungen: nur Angebotsnamen (Laser, Botox, …), nie Impressum-, Datenschutz- oder Menü-Seitentitel. Keine zusammengeklebten Wörter wie „RegionHyaluronsäure“.
Leistungsnamen in optionSets.portfolio und optionSets.services_ranked (3–8 kurze Labels, keine Sätze, keine €-Preise).
Für Persona außerdem optionSets.persona_goals, persona_objections, persona_alternatives, persona_budget (je 3–6 branchentypische Optionen).
${
  input.includeAiExtras
    ? `questions: ${maxExtras} Zusatzfragen. ${extraGapHints(vocab.kind)} Denk zuerst: was fehlt in den Kernfragen für GENAU dieses Angebot? Jede Frage: title = grammatisch korrekte deutsche Frage, description = warum + ein konkretes Antwort-Beispiel mit ${vocab.singular}/${vocab.engagement}. Keine Objekte als title, keine Rechtschreibfehler, keine Artikel wie „jedem Behandlung“.`
    : "questions=[]."
}

{"prefills":[{"key":"team_members","value":"...","note":"kurz","source":"upload"}],"optionSets":{"portfolio":["Leistung A"]},"questions":[{"title":"Welche Geräte setzt die ${vocab.business} ein, und wofür?","description":"Fachbegriffe für Texte. Beispiel: „Candela-Laser für Haarentfernung und Pigmente.“"}]}`,
        },
      ],
    });

    if (!result) {
      return {
        extras: [],
        aiPrefills: {},
        optionSets: {},
        warning:
          "KI-Vorausfüllung war nicht verfügbar. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
      };
    }
    const raw = extractAnthropicText(result.response);
    const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
    if (!jsonText) return { extras: [], aiPrefills: {}, optionSets: {}, warning: null };

    const parsed = JSON.parse(jsonText) as {
      prefills?: Array<{
        key?: unknown;
        value?: unknown;
        note?: unknown;
        source?: unknown;
      }>;
      optionSets?: Record<string, unknown>;
      questions?: unknown;
    };
    const allowedKeys = new Set(input.coreItems.map((m) => m.key));
    const hintByKey = new Map(input.coreItems.map((m) => [m.key, m.hint]));
    const alreadyFilled = new Set(
      input.coreItems.filter((c) => c.hasPrefill).map((c) => c.key),
    );
    const aiPrefills: Record<string, PrefillDraft> = {};
    for (const row of parsed.prefills ?? []) {
      const key = String(row.key ?? "").trim();
      const value = String(row.value ?? "").trim();
      if (!allowedKeys.has(key) || value.length < 3) continue;
      const fromUpload = String(row.source ?? "").trim() === "upload";
      if (!fromUpload && alreadyFilled.has(key)) continue;
      if (!fromUpload && !isPlausiblePrefill(hintByKey.get(key), value)) continue;
      aiPrefills[key] = {
        value: value.slice(0, 2000),
        source: fromUpload ? "upload" : "ai",
        note: String(
          row.note ??
            (fromUpload
              ? "Aus hochgeladener Datei — bitte prüfen"
              : "KI-Vorschlag aus Crawl — bitte prüfen"),
        ).slice(0, 160),
      };
    }
    const optionSets: Record<string, string[]> = {};
    if (parsed.optionSets && typeof parsed.optionSets === "object") {
      for (const [key, rawLabels] of Object.entries(parsed.optionSets)) {
        if (!Array.isArray(rawLabels)) continue;
        const labels = rawLabels
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length >= 2 && item.length <= 80 && !/^\[object object\]$/i.test(item));
        const cleaned =
          key === "portfolio" || key === "services_ranked"
            ? parseServiceLabelList(labels.join("\n"))
            : labels.slice(0, 10);
        if (cleaned.length >= 2) optionSets[key] = cleaned.slice(0, 10);
      }
    }
    let extras = input.includeAiExtras
      ? parseAiExtraQuestions(parsed.questions, {
          max: maxExtras,
          existingTitles: input.coreItems.map((c) => c.title),
        })
      : [];
    if (extras.length > 0) {
      extras = await proofreadAiExtraQuestions({
        extras,
        vocab,
        organisationName: input.organisationName,
        services: input.serviceLabels,
        coreTitles: input.coreItems.map((c) => c.title),
        max: maxExtras,
      });
    }
    return { extras, aiPrefills, optionSets, warning: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const timedOut = /Zeitlimit|timeout|aborted/i.test(message);
    return {
      extras: [],
      aiPrefills: {},
      optionSets: {},
      warning: timedOut
        ? "KI-Vorausfüllung hat zu lange gedauert. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen."
        : "KI-Vorausfüllung ist ausgefallen. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
    };
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
  sourceDocuments?: SourceDocument[] | null;
  clientAudience?: ClientAudienceKind | null;
  audienceVocab?: ClientAudienceVocab | null;
}): Promise<FragebogenReviewDraft> {
  const purpose = input.purpose;
  const extraPlacement = input.extraPlacement ?? "end";
  const vocab = resolveAudienceVocab(input.audienceVocab ?? input.clientAudience);
  const audience = vocab.kind;
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

  const meetingServices = parseServiceLabelList(briefing?.services ?? "");
  const crawlServices = extractServiceLabels(crawl);
  const serviceLabels =
    meetingServices.length >= 2
      ? meetingServices
      : crawlServices.length > 0
        ? crawlServices
        : meetingServices;

  // Crawl first, then AI for gaps — Meeting, then uploaded files win.
  const basePrefills: Record<string, PrefillDraft> = { ...heuristic };
  const titledForAi = customizeCoreQuestions({
    templates: selectedTemplates,
    audience: vocab,
    serviceLabels,
  });

  const aiBundle = await generateExtrasAndAiPrefills({
    purpose,
    organisationName: crawl.organisationName,
    wunschkundeLabel: input.wunschkundeLabel,
    crawlSummary: crawl.summaryText,
    meetingContext: meetingText,
    documentText,
    includeAiExtras: Boolean(input.includeAiExtras),
    vocab,
    serviceLabels,
    coreItems: titledForAi.map((t) => ({
      key: t.key,
      title: t.title,
      hint: t.prefillHint,
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

  const optionSets: Record<string, string[]> = { ...aiBundle.optionSets };
  if (serviceLabels.length > 0) {
    optionSets.portfolio = serviceLabels;
    optionSets.services_ranked = serviceLabels;
  }

  const customized = customizeCoreQuestions({
    templates: selectedTemplates,
    audience: vocab,
    serviceLabels,
    optionSets,
  });

  if (serviceLabels.length > 0 && !prefills.portfolio?.value) {
    prefills.portfolio = {
      value: serviceLabels.join("\n"),
      source: meetingServices.length >= 2 ? "meeting" : "crawl",
      note: "Leistungen aus Website/Gespräch — bitte Checkboxen prüfen",
    };
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

  const coreQuestions: ReviewQuestionItem[] = customized.map((t) => {
    const draft = prefills[t.key];
    const flags = generatedChoiceCustomOptionFlags(t.type);
    const options =
      t.type === "checkbox"
        ? mergeSuggestedCheckboxOptions(t.options ?? [], draft?.value ?? "")
        : (t.options ?? []).map((o) => ({ id: o.id, label: o.label }));
    return {
      id: fieldIdForCoreKey(t.key),
      kind: "core",
      coreKey: t.key,
      title: t.title,
      description: t.description,
      included: true,
      required: t.required,
      type: t.type,
      options,
      allowOtherOption: flags.allowOtherOption ?? t.allowOtherOption,
      allowExtraEntries: flags.allowExtraEntries ?? t.allowExtraEntries,
      allowCustomEntries: flags.allowCustomEntries ?? t.allowCustomEntries,
      addEntryLabel: t.addEntryLabel,
      answer: draft?.value ?? "",
      answerSource: draft?.source ?? "none",
      answerNote: draft?.note ?? "",
    };
  });

  const seoExtra: ReviewQuestionItem[] =
    crawl.seoMetrics &&
    !customized.some((t) => t.prefillHint === "seo_metrics" && prefills[t.key]?.value)
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
    ...aiBundle.extras.map((extra, index) => ({
      id: `extra_${slugifyKey(extra.title)}_${index + 1}`,
      kind: "extra" as const,
      title: applyClientAudienceToText(extra.title, vocab, { replaceBusiness: true }),
      description: applyClientAudienceToText(
        extra.description ||
          "Individuelle Zusatzfrage aus Crawl/KI — bearbeiten, kopieren oder löschen.",
        vocab,
        { replaceBusiness: true },
      ),
      included: true,
      required: true,
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
        : `Persona: ${input.wunschkundeLabel?.trim() || `Wunsch${vocab.singular}`} (${crawl.organisationName})`;

  const description =
    purpose === "anbieter"
      ? `Firmenfragebogen für ${crawl.organisationName} (${vocab.label}). Kernfragen + Meeting/Crawl-Vorlagen.`
      : purpose === "intern"
        ? `Interner Recherche-Block für ${crawl.organisationName}. Nicht an den Kunden senden.`
        : `${vocab.plural}-Fragebogen für ${crawl.organisationName}. Kernfragen + optionale Zusatzfragen.`;

  return {
    title,
    description,
    purpose,
    extraPlacement,
    crawlPageCount: crawl.pageCount,
    websiteUrl: crawl.websiteUrl,
    organisationName: crawl.organisationName,
    clientAudience: audience,
    audienceVocab: vocab,
    definitionId: createSurveyDefinitionId(),
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
