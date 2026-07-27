import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose, surveyPurposeLabel } from "@/lib/surveys/purpose";

import {
  buildSurveyResponseContextForAgent,
  getSurveySteps,
  type SurveyFieldQuestionRow,
} from "@/lib/dt/survey-to-agent-context";

export type SurveyClarificationSuggestedAction =
  | "import_anbieter_survey"
  | "import_sibling_survey"
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

/** Cross-refs that clearly point at the Anbieter-Fragebogen. */
const ANBIETER_CROSS_REF_PATTERNS: Array<{ re: RegExp; intent: string }> = [
  {
    re: /selber\s+ablauf\s+wie\s+im\s+anbieter/i,
    intent: "Gleicher Ablauf wie im Anbieter-Fragebogen übernehmen",
  },
  {
    re: /gleiche?r?\s+ablauf\s+wie\s+im\s+anbieter/i,
    intent: "Gleicher Ablauf wie im Anbieter-Fragebogen übernehmen",
  },
  {
    re: /wie\s+im\s+anbieter[\s-]*(fragebogen|umfrage)?/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
  },
  {
    re: /wie\s+(beim?|im|der|die)\s+anbieter/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
  },
  {
    re: /anbieter[\s-]*(fragebogen|umfrage)/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
  },
  {
    re: /siehe\s+(den\s+)?anbieter/i,
    intent: "Verweis auf den Anbieter-Fragebogen",
  },
  {
    re: /übernehmen\s+(vom?|aus)\s+(dem\s+)?anbieter/i,
    intent: "Inhalte aus dem Anbieter-Fragebogen übernehmen",
  },
  {
    re: /analog\s+(zum?\s+)?anbieter/i,
    intent: "Analog zum Anbieter-Fragebogen übernehmen",
  },
  {
    re: /entsprechend\s+(dem?\s+)?anbieter/i,
    intent: "Entsprechend dem Anbieter-Fragebogen übernehmen",
  },
];

/** Vague remarks that need admin judgment before inventing content. */
const AMBIGUOUS_REMARK_PATTERNS: Array<{ re: RegExp; intent: string }> = [
  {
    re: /selber\s+ablauf/i,
    intent: "„Selber Ablauf“ ohne klare Quelle — Freigabe nötig",
  },
  {
    re: /gleiche?r?\s+ablauf/i,
    intent: "„Gleicher Ablauf“ ohne klare Quelle — Freigabe nötig",
  },
  {
    re: /siehe\s+(oben|unten|anhang|vorher|andere|anderen\s+fragebogen)/i,
    intent: "Unklarer Verweis („siehe …“) — Freigabe nötig",
  },
  {
    re: /wie\s+(üblich|bekannt|immer|sonst)/i,
    intent: "Vage Formulierung — Freigabe nötig",
  },
  {
    re: /wie\s+beim?\s+anderen/i,
    intent: "Verweis auf „anderen“ Fragebogen — Quelle wählen",
  },
  {
    re: /übernehmen\s+(vom?|aus)/i,
    intent: "Übernahme-Hinweis ohne klare Quelle",
  },
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

/**
 * Detect remarks that cross-reference other surveys or are too vague to resolve alone.
 * Pure heuristics (no LLM) — cheap enough to run before every generation.
 */
export function detectSurveyClarifications(input: {
  definition: unknown;
  fieldQuestions: SurveyFieldQuestionRow[];
}): SurveyClarificationItem[] {
  const titles = buildFieldTitleMap(input.definition);
  const items: SurveyClarificationItem[] = [];

  for (const q of input.fieldQuestions) {
    if (q.kind !== "remark") continue;
    const text = remarkTextFromQuestion(q);
    if (!text) continue;

    let matched: SurveyClarificationItem | null = null;

    for (const pattern of ANBIETER_CROSS_REF_PATTERNS) {
      if (!pattern.re.test(text)) continue;
      matched = {
        id: `clar-${q.id}`,
        type: "cross_reference",
        questionId: q.id,
        fieldId: q.field_id,
        fieldTitle: titles.get(q.field_id) ?? "Frage",
        remarkText: text,
        detectedIntent: pattern.intent,
        suggestedAction: "import_anbieter_survey",
        suggestedPurpose: "anbieter",
      };
      break;
    }

    if (!matched) {
      for (const pattern of AMBIGUOUS_REMARK_PATTERNS) {
        if (!pattern.re.test(text)) continue;
        matched = {
          id: `clar-${q.id}`,
          type: "ambiguous_remark",
          questionId: q.id,
          fieldId: q.field_id,
          fieldTitle: titles.get(q.field_id) ?? "Frage",
          remarkText: text,
          detectedIntent: pattern.intent,
          suggestedAction: "import_sibling_survey",
          suggestedPurpose: null,
        };
        break;
      }
    }

    if (matched) items.push(matched);
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

async function loadCompletedResponseContext(input: {
  surveyId: string;
  responseId: string;
}): Promise<{ ok: true; title: string; purpose: string; context: string } | { ok: false }> {
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
  const context = buildSurveyResponseContextForAgent({
    surveyTitle: survey.title,
    definition: survey.definition,
    answers,
    fieldQuestions: (questions ?? []) as SurveyFieldQuestionRow[],
  });

  return {
    ok: true,
    title: survey.title,
    purpose: normalizeSurveyPurpose(survey.purpose),
    context,
  };
}

/**
 * Apply admin Freigaben: append approved sibling survey contexts,
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

    const sourceResponseId = resolution.sourceResponseId?.trim() || null;
    if (!sourceResponseId) {
      blocks.push(
        [
          "=== Freigabe ohne Quelle (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          "Status: Freigegeben, aber keine Quell-Umfrage gewählt — Bemerkung nur wörtlich verwenden.",
        ].join("\n"),
      );
      continue;
    }

    const sourceMeta = sourceByResponseId.get(sourceResponseId);
    const loaded = await loadCompletedResponseContext({
      surveyId: sourceMeta?.surveyId ?? "",
      responseId: sourceResponseId,
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
        });
      }
    }

    if (!contextBlock.ok) {
      blocks.push(
        [
          "=== Freigabe fehlgeschlagen (Admin) ===",
          `Bemerkung zu „${item.fieldTitle}“: „${item.remarkText}“`,
          "Status: Freigegebene Quelle konnte nicht geladen werden — nichts erfinden.",
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
        "Die folgenden Inhalte wurden vom Admin zur Übernahme freigegeben. Nutze sie für den Bereich, auf den die Bemerkung verweist — nichts darüber hinaus erfinden.",
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
}): Promise<{
  clarifications: SurveyClarificationItem[];
  sources: SurveyClarificationSource[];
  anbieterSources: SurveyClarificationSource[];
}> {
  const clarifications = detectSurveyClarifications({
    definition: input.definition,
    fieldQuestions: input.fieldQuestions,
  });

  const needsAnySource = clarifications.some(
    (c) =>
      c.suggestedAction === "import_anbieter_survey" ||
      c.suggestedAction === "import_sibling_survey",
  );

  if (!needsAnySource) {
    return { clarifications, sources: [], anbieterSources: [] };
  }

  const sources = await listSiblingSurveySources({
    organisationId: input.organisationId,
    excludeSurveyId: input.surveyId,
    excludeResponseId: input.responseId,
  });

  const anbieterSources = sources.filter((s) => s.purpose === "anbieter");

  return { clarifications, sources, anbieterSources };
}
