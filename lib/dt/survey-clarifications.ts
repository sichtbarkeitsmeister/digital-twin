import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose, surveyPurposeLabel } from "@/lib/surveys/purpose";
import type { SurveyField } from "@/lib/surveys/types";

import {
  extractSurveyFacts,
  formatSurveyFactsForAgentContext,
  type SurveyFact,
  type SurveyFactsBundle,
} from "@/lib/dt/survey-facts";

import {
  getSurveySteps,
  isPlaceholderOrEmptyAnswer,
  normalizeSurveyAnswer,
  type SurveyFieldQuestionRow,
} from "@/lib/dt/survey-to-agent-context";

export type SurveyClarificationSuggestedAction =
  | "import_anbieter_survey"
  | "import_sibling_survey"
  | "provide_manual"
  | "leave_as_is";

export type SurveyClarificationItem = {
  id: string;
  type: "cross_reference" | "ambiguous_remark";
  questionId: string;
  fieldId: string;
  fieldTitle: string;
  remarkText: string;
  detectedIntent: string;
  suggestedAction: SurveyClarificationSuggestedAction;
  suggestedPurpose: "anbieter" | "persona" | null;
  /** Hint for the wizard: prefer surveys whose title matches this. */
  preferredSourceHint: string | null;
};

export type SurveyClarificationSource = {
  responseId: string;
  surveyId: string;
  surveyTitle: string;
  purpose: "anbieter" | "persona";
  purposeLabel: string;
  completedAt: string | null;
};

export type SurveyClarificationResolution = {
  clarificationId: string;
  approved: boolean;
  /** Required when approved and a sibling survey should be imported. */
  sourceResponseId?: string | null;
  /** Admin-supplied text when no sibling source is available (or preferred). */
  manualText?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function remarkTextFromQuestion(q: SurveyFieldQuestionRow): string {
  const question = q.question?.trim() ?? "";
  const answer = q.answer?.trim() ?? "";
  if (question && answer) return `${question}\n${answer}`.trim();
  return question || answer;
}

type PatternMatch = {
  re: RegExp;
  intent: string;
  suggestedAction: SurveyClarificationSuggestedAction;
  suggestedPurpose: "anbieter" | "persona" | null;
  preferredSourceHint: string | null;
  type: "cross_reference" | "ambiguous_remark";
};

/** Cross-refs that clearly point at the Anbieter-Fragebogen. */
const ANBIETER_CROSS_REF_PATTERNS: PatternMatch[] = [
  {
    re: /selber\s+ablauf\s+wie\s+im\s+anbieter/i,
    intent: "Gleicher Ablauf wie im Anbieter-Fragebogen übernehmen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /gleiche?r?\s+ablauf\s+wie\s+im\s+anbieter/i,
    intent: "Gleicher Ablauf wie im Anbieter-Fragebogen übernehmen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /wie\s+im\s+anbieter[\s-]*(fragebogen|umfrage)?/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /wie\s+(beim?|im|der|die)\s+anbieter/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /anbieter[\s-]*(fragebogen|umfrage)/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /siehe\s+(den\s+)?anbieter/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /übernehmen\s+(vom?|aus)\s+(dem\s+)?anbieter/i,
    intent: "Inhalte aus dem Anbieter-Fragebogen übernehmen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /analog\s+(zum?\s+)?anbieter/i,
    intent: "Analog zum Anbieter-Fragebogen übernehmen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
  {
    re: /entsprechend\s+(dem?\s+)?anbieter/i,
    intent: "Entsprechend dem Anbieter-Fragebogen übernehmen",
    suggestedAction: "import_anbieter_survey",
    suggestedPurpose: "anbieter",
    preferredSourceHint: "anbieter",
    type: "cross_reference",
  },
];

/** Cross-refs to another persona survey (e.g. Arbeitgeber ↔ Arbeitnehmer). */
const SIBLING_CROSS_REF_PATTERNS: PatternMatch[] = [
  {
    re: /ist\s+die\s+gleiche\s+wie\s+beim?\s+arbeitgeber/i,
    intent: "Gleicher Inhalt wie beim Arbeitgeber — Übernahme freigeben oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /gleiche?\s+(mandatsreise|reise|ablauf|phasen?|bedürfnisse?)?\s*wie\s+(beim?|der|die|dem)\s+arbeitgeber/i,
    intent: "Gleicher Inhalt wie beim Arbeitgeber — Übernahme freigeben oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /wie\s+(beim?|der|die|dem|im)\s+arbeitgeber/i,
    intent: "Verweis auf den Arbeitgeber-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /siehe\s+(den\s+)?arbeitgeber([\s-]*(fragebogen|umfrage))?/i,
    intent: "Verweis auf den Arbeitgeber-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /arbeitgeber[\s-]*(fragebogen|umfrage)/i,
    intent: "Verweis auf den Arbeitgeber-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /(bitte\s+)?(dort|beim?\s+arbeitgeber|aus\s+dem\s+arbeitgeber).{0,40}übernehmen|übernehmen.{0,40}arbeitgeber/i,
    intent: "Übernahme aus dem Arbeitgeber-Fragebogen gewünscht",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitgeber",
    type: "cross_reference",
  },
  {
    re: /wie\s+(beim?|der|die|dem|im)\s+arbeitnehmer/i,
    intent: "Verweis auf den Arbeitnehmer-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitnehmer",
    type: "cross_reference",
  },
  {
    re: /siehe\s+(den\s+)?arbeitnehmer([\s-]*(fragebogen|umfrage))?/i,
    intent: "Verweis auf den Arbeitnehmer-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitnehmer",
    type: "cross_reference",
  },
  {
    re: /arbeitnehmer[\s-]*(fragebogen|umfrage)/i,
    intent: "Verweis auf den Arbeitnehmer-Fragebogen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: "arbeitnehmer",
    type: "cross_reference",
  },
  {
    re: /siehe\s+(den\s+)?(anderen\s+)?(persona[\s-]*)?(fragebogen|umfrage)/i,
    intent: "Verweis auf einen anderen Fragebogen — Quelle wählen oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: null,
    type: "cross_reference",
  },
  {
    re: /wie\s+(beim?|im|der|die)\s+anderen\s+(fragebogen|persona|umfrage)/i,
    intent: "Verweis auf einen anderen Fragebogen — Quelle wählen oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: null,
    type: "cross_reference",
  },
  {
    re: /bitte\s+.*(übernehmen|übernahme)/i,
    intent: "Übernahme-Hinweis — Quelle wählen oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: "persona",
    preferredSourceHint: null,
    type: "cross_reference",
  },
];

/** Vague remarks that need admin judgment before inventing content. */
const AMBIGUOUS_REMARK_PATTERNS: PatternMatch[] = [
  {
    re: /selber\s+ablauf/i,
    intent: "„Selber Ablauf“ ohne klare Quelle — Freigabe nötig",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /gleiche?r?\s+ablauf/i,
    intent: "„Gleicher Ablauf“ ohne klare Quelle — Freigabe nötig",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /gleiche?\s+wie\s+bei/i,
    intent: "„Gleich wie bei …“ — Quelle wählen oder Inhalt angeben",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /siehe\s+(oben|unten|anhang|vorher|andere|anderen\s+fragebogen)/i,
    intent: "Unklarer Verweis („siehe …“) — Freigabe nötig",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /wie\s+(üblich|bekannt|immer|sonst)/i,
    intent: "Vage Formulierung — Freigabe nötig",
    suggestedAction: "provide_manual",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /wie\s+beim?\s+anderen/i,
    intent: "Verweis auf „anderen“ Fragebogen — Quelle wählen",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
  {
    re: /übernehmen\s+(vom?|aus)/i,
    intent: "Übernahme-Hinweis ohne klare Quelle",
    suggestedAction: "import_sibling_survey",
    suggestedPurpose: null,
    preferredSourceHint: null,
    type: "ambiguous_remark",
  },
];

const ALL_PATTERNS: PatternMatch[] = [
  ...ANBIETER_CROSS_REF_PATTERNS,
  ...SIBLING_CROSS_REF_PATTERNS,
  ...AMBIGUOUS_REMARK_PATTERNS,
];

function buildFieldTitleMap(definition: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const step of getSurveySteps(definition)) {
    for (const field of step.fields ?? []) {
      map.set(field.id, field.title?.trim() || "Frage");
    }
  }
  return map;
}

function matchText(text: string): PatternMatch | null {
  for (const pattern of ALL_PATTERNS) {
    if (pattern.re.test(text)) return pattern;
  }
  return null;
}

function toClarificationItem(input: {
  id: string;
  fieldId: string;
  fieldTitle: string;
  remarkText: string;
  pattern: PatternMatch;
}): SurveyClarificationItem {
  return {
    id: input.id,
    type: input.pattern.type,
    questionId: input.id.replace(/^clar-/, ""),
    fieldId: input.fieldId,
    fieldTitle: input.fieldTitle,
    remarkText: input.remarkText,
    detectedIntent: input.pattern.intent,
    suggestedAction: input.pattern.suggestedAction,
    suggestedPurpose: input.pattern.suggestedPurpose,
    preferredSourceHint: input.pattern.preferredSourceHint,
  };
}

/**
 * Detect remarks/answers that cross-reference other surveys or are too vague to resolve alone.
 * Pure heuristics (no LLM) — cheap enough to run before every generation.
 *
 * Scans:
 * - Bemerkungen (kind=remark)
 * - Nachfragen mit Antwort
 * - Direkte Feld-Antworten (z. B. „Ist die gleiche wie beim Arbeitgeber…“)
 */
export function detectSurveyClarifications(input: {
  definition: unknown;
  fieldQuestions: SurveyFieldQuestionRow[];
  answers?: Record<string, unknown>;
}): SurveyClarificationItem[] {
  const titles = buildFieldTitleMap(input.definition);
  const items: SurveyClarificationItem[] = [];
  const seenFieldTexts = new Set<string>();

  function pushIfNew(item: SurveyClarificationItem) {
    const key = `${item.fieldId}::${item.remarkText.toLowerCase()}`;
    if (seenFieldTexts.has(key)) return;
    seenFieldTexts.add(key);
    items.push(item);
  }

  for (const q of input.fieldQuestions) {
    if (q.kind === "remark") {
      const text = remarkTextFromQuestion(q);
      if (!text) continue;
      const pattern = matchText(text);
      if (!pattern) continue;
      pushIfNew(
        toClarificationItem({
          id: `clar-${q.id}`,
          fieldId: q.field_id,
          fieldTitle: titles.get(q.field_id) ?? "Frage",
          remarkText: text,
          pattern,
        }),
      );
      continue;
    }

    // Follow-up answers can contain cross-refs — match on the answer only,
    // not the interviewer question (which may mention „Anbieter“ rhetorically).
    const answer = q.answer?.trim() ?? "";
    if (!answer || isPlaceholderOrEmptyAnswer(answer)) continue;
    const pattern = matchText(answer);
    if (!pattern) continue;
    pushIfNew(
      toClarificationItem({
        id: `clar-${q.id}`,
        fieldId: q.field_id,
        fieldTitle: titles.get(q.field_id) ?? "Frage",
        remarkText: answer,
        pattern,
      }),
    );
  }

  // Direct field answers (often where "gleiche Mandatsreise wie Arbeitgeber" is typed)
  if (input.answers) {
    for (const step of getSurveySteps(input.definition)) {
      for (const field of step.fields ?? []) {
        const raw = input.answers[field.id];
        const answer = normalizeSurveyAnswer(raw, field as SurveyField).trim();
        if (!answer || isPlaceholderOrEmptyAnswer(answer)) continue;
        const pattern = matchText(answer);
        if (!pattern) continue;
        pushIfNew(
          toClarificationItem({
            id: `clar-answer-${field.id}`,
            fieldId: field.id,
            fieldTitle: field.title?.trim() || titles.get(field.id) || "Frage",
            remarkText: answer,
            pattern,
          }),
        );
      }
    }
  }

  return items;
}

export async function listSiblingSurveySources(input: {
  organisationId: string;
  excludeSurveyId?: string;
  excludeResponseId?: string;
  purpose?: "anbieter" | "persona";
}): Promise<SurveyClarificationSource[]> {
  const supabase = createServiceClient();

  let surveyQuery = supabase
    .from("surveys")
    .select("id, title, purpose")
    .eq("organisation_id", input.organisationId)
    .is("deleted_at", null);

  if (input.excludeSurveyId) {
    surveyQuery = surveyQuery.neq("id", input.excludeSurveyId);
  }

  const { data: surveys, error } = await surveyQuery;
  if (error) {
    console.warn("[dt] listSiblingSurveySources surveys:", error.message);
    return [];
  }

  const filtered = (surveys ?? []).filter((s) => {
    const purpose = normalizeSurveyPurpose(s.purpose);
    if (input.purpose) return purpose === input.purpose;
    return true;
  });

  if (filtered.length === 0) return [];

  const surveyIds = filtered.map((s) => s.id);
  const surveyById = new Map(
    filtered.map((s) => [
      s.id,
      {
        title: s.title as string,
        purpose: normalizeSurveyPurpose(s.purpose),
      },
    ]),
  );

  const { data: responses, error: respError } = await supabase
    .from("survey_responses")
    .select("id, survey_id, completed_at")
    .in("survey_id", surveyIds)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  if (respError) {
    console.warn("[dt] listSiblingSurveySources responses:", respError.message);
    return [];
  }

  const sources: SurveyClarificationSource[] = [];
  const seenSurveys = new Set<string>();

  for (const row of responses ?? []) {
    if (input.excludeResponseId && row.id === input.excludeResponseId) continue;
    if (seenSurveys.has(row.survey_id)) continue;
    const meta = surveyById.get(row.survey_id);
    if (!meta) continue;
    seenSurveys.add(row.survey_id);
    sources.push({
      responseId: row.id,
      surveyId: row.survey_id,
      surveyTitle: meta.title,
      purpose: meta.purpose,
      purposeLabel: surveyPurposeLabel(meta.purpose),
      completedAt: row.completed_at ?? null,
    });
  }

  return sources;
}

/** Prefer sources whose title matches the clarification hint (e.g. „Arbeitgeber“). */
export function rankSourcesForClarification(
  sources: SurveyClarificationSource[],
  item: SurveyClarificationItem,
): SurveyClarificationSource[] {
  const hint = item.preferredSourceHint?.trim().toLowerCase();
  if (!hint) return sources;
  return [...sources].sort((a, b) => {
    const aHit = a.surveyTitle.toLowerCase().includes(hint) ? 0 : 1;
    const bHit = b.surveyTitle.toLowerCase().includes(hint) ? 0 : 1;
    return aHit - bHit;
  });
}

/**
 * First try to find a matching sibling survey; only fall back to asking the admin
 * when nothing suitable exists.
 */
export function resolveClarificationSourcePool(
  sources: SurveyClarificationSource[],
  item: SurveyClarificationItem,
): {
  pool: SurveyClarificationSource[];
  best: SurveyClarificationSource | null;
  foundMatch: boolean;
  statusMessage: string;
} {
  const ranked = rankSourcesForClarification(sources, item);
  const hint = item.preferredSourceHint?.trim().toLowerCase();

  if (hint) {
    const hinted = ranked.filter((s) => s.surveyTitle.toLowerCase().includes(hint));
    if (hinted.length > 0) {
      return {
        pool: hinted,
        best: hinted[0] ?? null,
        foundMatch: true,
        statusMessage: `Passende Quelle gefunden: „${hinted[0]?.surveyTitle ?? ""}“.`,
      };
    }
  }

  if (ranked.length > 0) {
    const label = hint
      ? `Keine Umfrage mit „${hint}“ im Titel — nächste verfügbare Quelle vorgeschlagen.`
      : `Passende Quell-Umfrage gefunden: „${ranked[0]?.surveyTitle ?? ""}“.`;
    return {
      pool: ranked,
      best: ranked[0] ?? null,
      foundMatch: !hint, // hint miss → not a confident auto-find
      statusMessage: label,
    };
  }

  const askHint = hint ? ` („${hint}“)` : "";
  return {
    pool: [],
    best: null,
    foundMatch: false,
    statusMessage: `Keine passende abgeschlossene Umfrage gefunden${askHint}. Bitte Inhalt selbst angeben.`,
  };
}

function tokenizeForRelevance(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .filter(
      (t) =>
        ![
          "siehe",
          "bitte",
          "gleiche",
          "gleicher",
          "gleichen",
          "übernehmen",
          "übernahme",
          "fragebogen",
          "umfrage",
          "dort",
          "beim",
          "wenn",
          "oder",
          "auch",
          "diese",
          "dieser",
          "dieses",
          "lange",
          "dauert",
          "jeder",
          "jede",
          "jedes",
          "beschreibe",
          "beschreiben",
          "nennen",
          "welche",
          "was",
          "sind",
          "wichtigsten",
          "typische",
          "typischer",
          "typisches",
          "eines",
          "einer",
          "einem",
          "noch",
          "etwas",
          "bisher",
          "nicht",
          "abgefragt",
          "worden",
        ].includes(t),
    );
}

/** Words that point at the sibling persona — must not drive field matching. */
const SOURCE_HINT_TOKENS = new Set([
  "arbeitgeber",
  "arbeitnehmer",
  "anbieter",
  "persona",
  "mandant",
  "mandanten",
  "mandantin",
  "wunschmandant",
  "wunschmandanten",
]);

/**
 * Distinctive topic tokens from the *target field title only*.
 * Remark text is ignored here — it only says where to look, not which field.
 */
function distinctiveFieldTokens(fieldTitle: string): string[] {
  return tokenizeForRelevance(fieldTitle).filter((t) => !SOURCE_HINT_TOKENS.has(t));
}

function normalizeFieldTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[„“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((t) => t.length >= 3)
    .filter((t) => !SOURCE_HINT_TOKENS.has(t))
    .filter(
      (t) =>
        ![
          "bitte",
          "die",
          "der",
          "das",
          "und",
          "in",
          "von",
          "für",
          "mit",
          "eines",
          "einer",
          "einem",
          "beschreibe",
          "beschreiben",
          "nennen",
          "sind",
          "was",
          "wie",
          "jede",
          "jeder",
          "jedes",
        ].includes(t),
    )
    .join(" ");
}

function tokenOverlapScore(haystack: string, tokens: string[]): number {
  let score = 0;
  for (const t of tokens) {
    if (!haystack.includes(t)) continue;
    // Longer / rarer topic words weigh more (e.g. mandatsreise).
    score += t.length >= 8 ? 3 : t.length >= 6 ? 2 : 1;
  }
  return score;
}

/** Shared Mandatsreise-context — alone must not pick a sibling field. */
const SHARED_JOURNEY_TOKENS = new Set(["mandatsreise", "phase", "phasen", "ablauf"]);

/**
 * Tokens that identify *which* Mandatsreise question (Bedürfnisse vs Dauer vs Schritte).
 * All of these must appear in the winning sibling field title.
 */
function requiredTopicTokens(tokens: string[]): string[] {
  const specific = tokens.filter((t) => !SHARED_JOURNEY_TOKENS.has(t) && t.length >= 6);
  if (specific.length > 0) return specific;
  return tokens.filter((t) => t.length >= 8);
}

function fieldCoversRequiredTokens(fieldTitle: string, required: string[]): boolean {
  if (required.length === 0) return true;
  const hay = fieldTitle.toLowerCase();
  return required.every((t) => hay.includes(t));
}

function titleForFieldId(bundle: SurveyFactsBundle, fieldId: string): string {
  return bundle.facts.find((f) => f.fieldId === fieldId)?.fieldTitle ?? "";
}

export type ClarificationFactScope = "focused" | "full_survey" | "empty";

/** Absolute safety: never hand the model more than one sibling field. */
const MAX_IMPORT_FIELD_IDS = 1;
const MAX_IMPORT_FACTS = 8;

function factsForSingleField(
  bundle: SurveyFactsBundle,
  fieldId: string,
): SurveyFact[] {
  return bundle.facts.filter((f) => f.fieldId === fieldId).slice(0, MAX_IMPORT_FACTS);
}

/**
 * Near-match only when titles are almost the same after role-noise stripping.
 * Prevents short stems like „mandatsreise“ from matching a long unrelated title
 * via naive substring checks.
 */
function isNearTitleMatch(a: string, b: string): boolean {
  if (a.length < 16 || b.length < 16) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= 0.7;
}

function acceptFocusedField(
  bundle: SurveyFactsBundle,
  fieldId: string,
  tokens: string[],
): { facts: SurveyFact[]; scope: ClarificationFactScope } {
  const title = titleForFieldId(bundle, fieldId);
  const required = requiredTopicTokens(tokens);
  if (!fieldCoversRequiredTokens(title, required)) {
    return { facts: [], scope: "empty" };
  }
  return {
    facts: factsForSingleField(bundle, fieldId),
    scope: "focused",
  };
}

/**
 * Pick only facts that clearly belong to the same question as the clarification.
 * Never dump the whole sibling survey — better empty (admin pastes) than over-import.
 */
function filterFactsForFieldFocus(
  bundle: SurveyFactsBundle,
  fieldTitle: string,
  _remarkText: string,
): { facts: SurveyFact[]; scope: ClarificationFactScope } {
  if (bundle.facts.length === 0) return { facts: [], scope: "empty" };

  const tokens = distinctiveFieldTokens(fieldTitle);

  const titleNorm = fieldTitle.trim().toLowerCase();
  if (titleNorm) {
    const exact = bundle.facts.filter((f) => f.fieldTitle.toLowerCase() === titleNorm);
    if (exact.length > 0) {
      return acceptFocusedField(bundle, exact[0]!.fieldId, tokens);
    }
  }

  const normalizedTarget = normalizeFieldTitleForMatch(fieldTitle);
  if (normalizedTarget.length >= 8) {
    const byNormalized = bundle.facts.filter(
      (f) => normalizeFieldTitleForMatch(f.fieldTitle) === normalizedTarget,
    );
    if (byNormalized.length > 0) {
      return acceptFocusedField(bundle, byNormalized[0]!.fieldId, tokens);
    }
  }

  if (normalizedTarget.length >= 16) {
    const near = bundle.facts.filter((f) =>
      isNearTitleMatch(normalizedTarget, normalizeFieldTitleForMatch(f.fieldTitle)),
    );
    if (near.length > 0) {
      const ranked = [...near].sort(
        (a, b) =>
          tokenOverlapScore(b.fieldTitle.toLowerCase(), tokens) -
          tokenOverlapScore(a.fieldTitle.toLowerCase(), tokens),
      );
      return acceptFocusedField(bundle, ranked[0]!.fieldId, tokens);
    }
  }

  if (tokens.length === 0) {
    return { facts: [], scope: "empty" };
  }

  // Score per fieldId (best fact title per field), then take only the top field.
  const bestByField = new Map<string, { score: number; fieldId: string }>();
  for (const f of bundle.facts) {
    const score = tokenOverlapScore(f.fieldTitle.toLowerCase(), tokens);
    const prev = bestByField.get(f.fieldId);
    if (!prev || score > prev.score) {
      bestByField.set(f.fieldId, { score, fieldId: f.fieldId });
    }
  }

  const rankedFields = [...bestByField.values()].sort((a, b) => b.score - a.score);
  const best = rankedFields[0];
  // Require a real topic hit (e.g. „mandatsreise“ alone = 3). Soft matches only → empty.
  const minScore = Math.max(3, Math.ceil(tokens.length * 0.5));
  if (!best || best.score < minScore) {
    return { facts: [], scope: "empty" };
  }

  // Ambiguous: two fields tied at the top → don't guess, ask admin.
  const tied = rankedFields.filter((r) => r.score === best.score);
  if (tied.length > MAX_IMPORT_FIELD_IDS) {
    return { facts: [], scope: "empty" };
  }

  return acceptFocusedField(bundle, best.fieldId, tokens);
}

export type SurveyClarificationPreviewFact = {
  fieldTitle: string;
  kind: "answer" | "remark" | "follow_up";
  label: string;
  value: string;
};

/** What the model will receive for one clarification ↔ source pair. */
export type SurveyClarificationImportPreview = {
  clarificationId: string;
  sourceResponseId: string;
  sourceSurveyTitle: string;
  scope: ClarificationFactScope;
  facts: SurveyClarificationPreviewFact[];
};

const PREVIEW_VALUE_MAX = 600;

function truncatePreviewValue(value: string): string {
  const t = value.trim();
  if (t.length <= PREVIEW_VALUE_MAX) return t;
  return `${t.slice(0, PREVIEW_VALUE_MAX).trimEnd()}…`;
}

async function loadSourceFactsBundle(input: {
  surveyId: string;
  responseId: string;
}): Promise<{ ok: true; title: string; purpose: string; bundle: SurveyFactsBundle } | { ok: false }> {
  const supabase = createServiceClient();

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, definition, purpose")
    .eq("id", input.surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) return { ok: false };

  const { data: response } = await supabase
    .from("survey_responses")
    .select("id, status, answers")
    .eq("id", input.responseId)
    .eq("survey_id", input.surveyId)
    .maybeSingle();

  if (!response || response.status !== "completed") return { ok: false };

  const { data: questions } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", input.responseId)
    .order("asked_at", { ascending: true });

  const answers: Record<string, unknown> = isRecord(response.answers) ? response.answers : {};
  const fieldQuestions = (questions ?? []) as SurveyFieldQuestionRow[];
  const bundle = extractSurveyFacts({
    surveyTitle: survey.title,
    definition: survey.definition,
    answers,
    fieldQuestions,
  });

  return {
    ok: true,
    title: survey.title,
    purpose: normalizeSurveyPurpose(survey.purpose),
    bundle,
  };
}

export function buildImportPreviewFromBundle(input: {
  clarificationId: string;
  sourceResponseId: string;
  sourceSurveyTitle: string;
  bundle: SurveyFactsBundle;
  fieldTitle: string;
  remarkText: string;
}): SurveyClarificationImportPreview {
  const { facts, scope } = filterFactsForFieldFocus(
    input.bundle,
    input.fieldTitle,
    input.remarkText,
  );

  return {
    clarificationId: input.clarificationId,
    sourceResponseId: input.sourceResponseId,
    sourceSurveyTitle: input.sourceSurveyTitle,
    scope,
    facts: facts.map((f) => ({
      fieldTitle: f.fieldTitle,
      kind: f.kind,
      label: f.label,
      value: truncatePreviewValue(f.value),
    })),
  };
}

async function loadCompletedResponseContext(input: {
  surveyId: string;
  responseId: string;
  focusFieldTitle?: string;
  focusRemarkText?: string;
}): Promise<
  | {
      ok: true;
      title: string;
      purpose: string;
      context: string;
      factCount: number;
      scope: ClarificationFactScope;
    }
  | { ok: false }
> {
  const loaded = await loadSourceFactsBundle({
    surveyId: input.surveyId,
    responseId: input.responseId,
  });
  if (!loaded.ok) return { ok: false };

  if (input.focusFieldTitle || input.focusRemarkText) {
    const { facts, scope } = filterFactsForFieldFocus(
      loaded.bundle,
      input.focusFieldTitle ?? "",
      input.focusRemarkText ?? "",
    );
    return {
      ok: true,
      title: loaded.title,
      purpose: loaded.purpose,
      context: formatSurveyFactsForAgentContext({
        ...loaded.bundle,
        facts,
      }),
      factCount: facts.length,
      scope,
    };
  }

  return {
    ok: true,
    title: loaded.title,
    purpose: loaded.purpose,
    context: formatSurveyFactsForAgentContext(loaded.bundle),
    factCount: loaded.bundle.facts.length,
    scope: "full_survey",
  };
}

/**
 * Apply admin Freigaben: append approved sibling survey contexts or manual text,
 * and annotate rejected cross-refs so the model does not invent them.
 */
export async function applyClarificationResolutionsToContext(input: {
  baseContext: string;
  clarifications: SurveyClarificationItem[];
  resolutions: SurveyClarificationResolution[];
  sources: SurveyClarificationSource[];
}): Promise<string> {
  if (input.clarifications.length === 0) return input.baseContext;

  const resolutionById = new Map(input.resolutions.map((r) => [r.clarificationId, r]));
  const sourceByResponseId = new Map(input.sources.map((s) => [s.responseId, s]));
  const blocks: string[] = [];

  for (const item of input.clarifications) {
    const resolution = resolutionById.get(item.id);
    if (!resolution) {
      blocks.push(
        [
          "=== Klärung ausstehend (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          "Status: Keine Freigabe übermittelt — Inhalt nicht spekulativ auflösen, Bemerkung nur wörtlich erwähnen.",
        ].join("\n"),
      );
      continue;
    }

    if (!resolution.approved) {
      blocks.push(
        [
          "=== Freigabe verweigert (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          `Erkannt: ${item.detectedIntent}`,
          "Status: Übernahme NICHT freigegeben. Die Bemerkung nicht spekulativ auflösen und keine fremden Fragebogen-Inhalte erfinden.",
        ].join("\n"),
      );
      continue;
    }

    const manualText = resolution.manualText?.trim() || "";
    if (manualText) {
      blocks.push(
        [
          "=== Freigegebene Angabe (Admin, manuell) ===",
          `Bezug: Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          `Erkannt: ${item.detectedIntent}`,
          "Die folgenden Inhalte wurden vom Admin als Ersatz/Übernahme freigegeben. Nutze sie für den Bereich, auf den die Bemerkung verweist — nichts darüber hinaus erfinden.",
          "",
          manualText,
        ].join("\n"),
      );
      continue;
    }

    const sourceResponseId = resolution.sourceResponseId?.trim() || null;
    if (!sourceResponseId) {
      blocks.push(
        [
          "=== Freigabe ohne Quelle (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          "Status: Freigegeben, aber keine Quell-Umfrage und kein manueller Text — Bemerkung nur wörtlich verwenden.",
        ].join("\n"),
      );
      continue;
    }

    const sourceMeta = sourceByResponseId.get(sourceResponseId);
    const loaded = await loadCompletedResponseContext({
      surveyId: sourceMeta?.surveyId ?? "",
      responseId: sourceResponseId,
      focusFieldTitle: item.fieldTitle,
      focusRemarkText: item.remarkText,
    });

    // If meta missing, try resolving survey_id from DB via response alone
    let contextBlock = loaded;
    if (!loaded.ok) {
      const supabase = createServiceClient();
      const { data: resp } = await supabase
        .from("survey_responses")
        .select("id, survey_id, status")
        .eq("id", sourceResponseId)
        .maybeSingle();
      if (resp?.status === "completed" && resp.survey_id) {
        contextBlock = await loadCompletedResponseContext({
          surveyId: resp.survey_id,
          responseId: sourceResponseId,
          focusFieldTitle: item.fieldTitle,
          focusRemarkText: item.remarkText,
        });
      }
    }

    if (!contextBlock.ok) {
      blocks.push(
        [
          "=== Freigabe fehlgeschlagen (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          "Status: Freigegebene Quelle konnte nicht geladen werden — nichts erfinden. Admin muss den Inhalt manuell angeben.",
        ].join("\n"),
      );
      continue;
    }

    if (contextBlock.factCount === 0 || contextBlock.scope === "empty") {
      blocks.push(
        [
          "=== Freigabe ohne passenden Inhalt (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          `Quelle: „${contextBlock.title}“`,
          "Status: In der Quell-Umfrage wurde kein passendes Feld gefunden. Den ganzen Fragebogen nicht übernehmen — nichts erfinden. Admin muss den Inhalt manuell angeben.",
        ].join("\n"),
      );
      continue;
    }

    blocks.push(
      [
        "=== Freigegebene Übernahme (Admin) ===",
        `Bezug: Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
        `Erkannt: ${item.detectedIntent}`,
        `Quelle: „${contextBlock.title}“ (${surveyPurposeLabel(normalizeSurveyPurpose(contextBlock.purpose))})`,
        "Die folgenden Inhalte wurden vom Admin zur Übernahme freigegeben (fokussiert auf den verwiesenen Bereich). Nutze sie für diesen Bereich — nichts darüber hinaus erfinden.",
        "",
        contextBlock.context,
      ].join("\n"),
    );
  }

  if (blocks.length === 0) return input.baseContext;
  return `${input.baseContext.trim()}\n\n${blocks.join("\n\n")}`.trim();
}

export async function loadClarificationsForSurveyResponse(input: {
  surveyId: string;
  responseId: string;
  organisationId: string;
  definition: unknown;
  fieldQuestions: SurveyFieldQuestionRow[];
  answers?: Record<string, unknown>;
}): Promise<{
  clarifications: SurveyClarificationItem[];
  sources: SurveyClarificationSource[];
  anbieterSources: SurveyClarificationSource[];
  previews: SurveyClarificationImportPreview[];
}> {
  const clarifications = detectSurveyClarifications({
    definition: input.definition,
    fieldQuestions: input.fieldQuestions,
    answers: input.answers,
  });

  const needsAnySource = clarifications.some(
    (c) =>
      c.suggestedAction === "import_anbieter_survey" ||
      c.suggestedAction === "import_sibling_survey" ||
      c.suggestedAction === "provide_manual",
  );

  if (!needsAnySource) {
    return { clarifications, sources: [], anbieterSources: [], previews: [] };
  }

  const sources = await listSiblingSurveySources({
    organisationId: input.organisationId,
    excludeSurveyId: input.surveyId,
    excludeResponseId: input.responseId,
  });

  const anbieterSources = sources.filter((s) => s.purpose === "anbieter");

  // Load each candidate source once, then build per-clarification focused previews.
  const bundleCache = new Map<
    string,
    Awaited<ReturnType<typeof loadSourceFactsBundle>>
  >();

  async function cachedBundle(source: SurveyClarificationSource) {
    const existing = bundleCache.get(source.responseId);
    if (existing) return existing;
    const loaded = await loadSourceFactsBundle({
      surveyId: source.surveyId,
      responseId: source.responseId,
    });
    bundleCache.set(source.responseId, loaded);
    return loaded;
  }

  const previews: SurveyClarificationImportPreview[] = [];

  for (const item of clarifications) {
    const base =
      item.suggestedAction === "import_anbieter_survey" || item.suggestedPurpose === "anbieter"
        ? anbieterSources.length > 0
          ? anbieterSources
          : sources
        : sources;
    const resolved = resolveClarificationSourcePool(base, item);
    // Preview best + up to 2 alternates so source switching still shows content.
    const toPreview = resolved.pool.slice(0, 3);
    for (const source of toPreview) {
      const loaded = await cachedBundle(source);
      if (!loaded.ok) continue;
      previews.push(
        buildImportPreviewFromBundle({
          clarificationId: item.id,
          sourceResponseId: source.responseId,
          sourceSurveyTitle: loaded.title,
          bundle: loaded.bundle,
          fieldTitle: item.fieldTitle,
          remarkText: item.remarkText,
        }),
      );
    }
  }

  return { clarifications, sources, anbieterSources, previews };
}
