import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";
import type { AgentCoverageSurveyOption } from "@/lib/dt/agent-survey-coverage-option-helpers";

export type { AgentCoverageSurveyOption } from "@/lib/dt/agent-survey-coverage-option-helpers";
export {
  formatCoverageOptionLabel,
  pickDefaultCoverageOption,
  suggestCoverageOptionForAgent,
} from "@/lib/dt/agent-survey-coverage-option-helpers";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function hasAnswerPayload(answers: unknown): boolean {
  if (!isRecord(answers)) return false;
  return Object.keys(answers).length > 0;
}

function pickBestResponse<T extends {
  id: string;
  status: string;
  completed_at: string | null;
  updated_at?: string | null;
  answers: unknown;
}>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const usable = rows.filter(
    (r) => r.status === "completed" || hasAnswerPayload(r.answers),
  );
  const pool = usable.length > 0 ? usable : rows;
  return [...pool].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return bDone - aDone;
    const at = a.completed_at ?? a.updated_at ?? "";
    const bt = b.completed_at ?? b.updated_at ?? "";
    return bt.localeCompare(at);
  })[0] ?? null;
}

type SurveyListRow = {
  id: string;
  title: string;
  purpose: unknown;
  organisation_id: string | null;
  folder_id: string | null;
  deleted_at: string | null;
  updated_at: string | null;
};

/**
 * Questionnaire responses for prompt↔survey Abgleich / Herkunft.
 * Lists org surveys (and same-folder siblings) with a usable answer —
 * not a global “recent 120” slice that can drop older org questionnaires.
 */
export async function listSurveyResponsesForAgentCoverage(input: {
  organisationId: string;
  agentId?: string | null;
  agentKind?: string | null;
  sourceSurveyId?: string | null;
  sourceResponseId?: string | null;
  limit?: number;
}): Promise<AgentCoverageSurveyOption[]> {
  const supabase = createServiceClient();
  const limit = input.limit ?? 40;
  const preferAnbieter =
    input.agentKind === "seo_advisor" || input.agentKind === "seo";

  const { data: orgSurveys, error: surveysError } = await supabase
    .from("surveys")
    .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
    .eq("organisation_id", input.organisationId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (surveysError) {
    console.warn("[dt] listSurveyResponsesForAgentCoverage surveys:", surveysError.message);
    return [];
  }

  const surveyById = new Map<string, SurveyListRow>();
  for (const s of orgSurveys ?? []) {
    surveyById.set(s.id, s as SurveyListRow);
  }

  // Include other surveys in the same folders (Umfragen-Explorer groups by folder).
  const folderIds = [
    ...new Set(
      [...surveyById.values()]
        .map((s) => s.folder_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (folderIds.length > 0) {
    const { data: folderSurveys } = await supabase
      .from("surveys")
      .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
      .in("folder_id", folderIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(80);
    for (const s of folderSurveys ?? []) {
      if (!surveyById.has(s.id)) surveyById.set(s.id, s as SurveyListRow);
    }
  }

  // Surveys already used as source by agents in this org.
  const { data: agentSources } = await supabase
    .from("dt_agents")
    .select("source_survey_id")
    .eq("organisation_id", input.organisationId)
    .not("source_survey_id", "is", null);
  const agentSourceIds = [
    ...new Set(
      (agentSources ?? [])
        .map((a) => a.source_survey_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const missingSourceSurveyIds = agentSourceIds.filter((id) => !surveyById.has(id));
  if (input.sourceSurveyId && !surveyById.has(input.sourceSurveyId)) {
    missingSourceSurveyIds.push(input.sourceSurveyId);
  }
  if (missingSourceSurveyIds.length > 0) {
    const { data: linkedSurveys } = await supabase
      .from("surveys")
      .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
      .in("id", missingSourceSurveyIds)
      .is("deleted_at", null);
    for (const s of linkedSurveys ?? []) {
      surveyById.set(s.id, s as SurveyListRow);
    }
  }

  const surveyIds = [...surveyById.keys()];
  if (surveyIds.length === 0) return [];

  const { data: responseRows, error: responsesError } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, completed_at, updated_at, answers")
    .in("survey_id", surveyIds)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (responsesError) {
    console.warn(
      "[dt] listSurveyResponsesForAgentCoverage responses:",
      responsesError.message,
    );
    return [];
  }

  const responsesBySurvey = new Map<string, NonNullable<typeof responseRows>>();
  for (const row of responseRows ?? []) {
    const list = responsesBySurvey.get(row.survey_id) ?? [];
    list.push(row);
    responsesBySurvey.set(row.survey_id, list);
  }

  const options: AgentCoverageSurveyOption[] = [];

  for (const surveyId of surveyIds) {
    const survey = surveyById.get(surveyId);
    if (!survey?.title || survey.deleted_at) continue;

    const purpose = normalizeSurveyPurpose(survey.purpose);
    const responses = responsesBySurvey.get(surveyId) ?? [];
    let best = pickBestResponse(responses);

    if (input.sourceSurveyId === surveyId && input.sourceResponseId) {
      const sourceResp = responses.find((r) => r.id === input.sourceResponseId);
      if (sourceResp) best = sourceResp;
    }

    if (!best) continue;

    const isSource =
      input.sourceSurveyId === surveyId &&
      input.sourceResponseId === best.id;

    options.push({
      surveyId,
      responseId: best.id,
      surveyTitle: survey.title,
      purpose,
      completedAt: best.completed_at ?? best.updated_at ?? null,
      isSource,
    });

    if (options.length >= limit) break;
  }

  if (
    input.sourceSurveyId &&
    input.sourceResponseId &&
    !options.some((o) => o.responseId === input.sourceResponseId)
  ) {
    const { data: sourceRow } = await supabase
      .from("survey_responses")
      .select(
        "id, survey_id, completed_at, updated_at, surveys!inner(id, title, purpose, deleted_at)",
      )
      .eq("id", input.sourceResponseId)
      .eq("survey_id", input.sourceSurveyId)
      .maybeSingle();

    if (sourceRow) {
      const survey = sourceRow.surveys as
        | { id: string; title: string; purpose?: unknown }
        | { id: string; title: string; purpose?: unknown }[];
      const surveyData = Array.isArray(survey) ? survey[0] : survey;
      if (surveyData?.title) {
        options.unshift({
          surveyId: sourceRow.survey_id,
          responseId: sourceRow.id,
          surveyTitle: surveyData.title,
          purpose: normalizeSurveyPurpose(surveyData.purpose),
          completedAt: sourceRow.completed_at ?? sourceRow.updated_at ?? null,
          isSource: true,
        });
      }
    }
  }

  const responseIds = options.map((o) => o.responseId);
  if (responseIds.length > 0) {
    const { data: owners } = await supabase
      .from("dt_agents")
      .select("id, name, source_survey_response_id")
      .in("source_survey_response_id", responseIds);

    const ownerByResponse = new Map<string, { id: string; name: string }>();
    for (const owner of owners ?? []) {
      const rid = owner.source_survey_response_id;
      if (typeof rid !== "string") continue;
      ownerByResponse.set(rid, { id: owner.id, name: owner.name });
    }

    for (const option of options) {
      const owner = ownerByResponse.get(option.responseId);
      if (owner && owner.id !== input.agentId) {
        option.usedByOtherAgentName = owner.name;
      }
    }
  }

  options.sort((a, b) => {
    if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
    const aPurposeScore = preferAnbieter
      ? a.purpose === "anbieter"
        ? 1
        : 0
      : a.purpose === "persona"
        ? 1
        : 0;
    const bPurposeScore = preferAnbieter
      ? b.purpose === "anbieter"
        ? 1
        : 0
      : b.purpose === "persona"
        ? 1
        : 0;
    if (aPurposeScore !== bPurposeScore) return bPurposeScore - aPurposeScore;
    const at = a.completedAt ?? "";
    const bt = b.completedAt ?? "";
    return bt.localeCompare(at);
  });

  return options;
}

/** Pure helper exported for unit tests. */
export function pickBestSurveyResponseForCoverage<T extends {
  id: string;
  status: string;
  completed_at: string | null;
  updated_at?: string | null;
  answers: unknown;
}>(rows: T[]): T | null {
  return pickBestResponse(rows);
}
