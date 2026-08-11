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

function normalizeName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Match survey folders to an organisation by name.
 * Folders are the Umfragen-Explorer groups (often named like the org).
 */
export function matchSurveyFoldersToOrganisationName(
  folders: Array<{ id: string; name: string }>,
  organisationName: string,
): Array<{ id: string; name: string }> {
  const org = normalizeName(organisationName);
  if (!org) return [];

  const exact = folders.filter((f) => normalizeName(f.name) === org);
  if (exact.length > 0) return exact;

  const orgTokens = org.split(" ").filter((t) => t.length >= 3);

  // Soft match: shared meaningful tokens (handles “Ruth Hennes” vs “Hennes”).
  return folders.filter((f) => {
    const name = normalizeName(f.name);
    if (name.length < 4) return false;
    if (org.includes(name) || name.includes(org)) return true;
    const folderTokens = name.split(" ").filter((t) => t.length >= 3);
    if (folderTokens.length === 0 || orgTokens.length === 0) return false;
    const shared = folderTokens.filter((t) => orgTokens.includes(t));
    // Require at least 2 shared tokens, or 1 strong token (≥6 chars) plus another.
    if (shared.length >= 2) return true;
    return shared.some((t) => t.length >= 6) && shared.length >= 1 && folderTokens.length <= 3;
  });
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
 * Questionnaire options for Abgleich / Herkunft.
 * Primary source: all surveys in the organisation's Umfragen-Ordner (by folder name).
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
  const limit = input.limit ?? 80;
  const preferAnbieter =
    input.agentKind === "seo_advisor" || input.agentKind === "seo";

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("id", input.organisationId)
    .maybeSingle();

  const surveyById = new Map<string, SurveyListRow>();

  // 1) Surveys linked by organisation_id
  const { data: orgSurveys, error: surveysError } = await supabase
    .from("surveys")
    .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
    .eq("organisation_id", input.organisationId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (surveysError) {
    console.warn("[dt] listSurveyResponsesForAgentCoverage surveys:", surveysError.message);
  }
  for (const s of orgSurveys ?? []) {
    surveyById.set(s.id, s as SurveyListRow);
  }

  // 2) All surveys in folders named like the organisation (Umfragen-Explorer).
  const { data: folders } = await supabase
    .from("survey_folders")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);

  const matchedFolders = matchSurveyFoldersToOrganisationName(
    folders ?? [],
    organisation?.name ?? "",
  );
  const folderIds = new Set(matchedFolders.map((f) => f.id));

  // Also keep folders already referenced by org-linked surveys.
  for (const s of surveyById.values()) {
    if (s.folder_id) folderIds.add(s.folder_id);
  }

  if (folderIds.size > 0) {
    const { data: folderSurveys } = await supabase
      .from("surveys")
      .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
      .in("folder_id", [...folderIds])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(120);
    for (const s of folderSurveys ?? []) {
      surveyById.set(s.id, s as SurveyListRow);
    }
  }

  // 3) Surveys already used as source by agents in this org.
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
    .limit(500);

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

    // Folder questionnaires without an answer yet: still list with a placeholder
    // response id only when we have a row; otherwise skip (Abgleich needs answers).
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
    return a.surveyTitle.localeCompare(b.surveyTitle, "de");
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
