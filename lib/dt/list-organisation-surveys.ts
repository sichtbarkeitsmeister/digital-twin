import {
  escapeIlikePattern,
  matchSurveyFoldersToOrganisationName,
  organisationIlikeNeedles,
  organisationLabelMatches,
  organisationMatchAliases,
} from "@/lib/dt/agent-survey-coverage-options";
import { normalizeSurveyPurpose, type SurveyPurpose } from "@/lib/surveys/purpose";
import { createServiceClient } from "@/lib/supabase/service";

export { organisationSurveyOpenHref } from "@/lib/dt/organisation-survey-open-href";

export type OrganisationSurveyListItem = {
  surveyId: string;
  title: string;
  purpose: SurveyPurpose;
  folderId: string | null;
  folderName: string | null;
  organisationId: string | null;
  updatedAt: string | null;
  slug: string | null;
  visibility: "public" | "private" | string | null;
  responseId: string | null;
  responseStatus: string | null;
  responseUpdatedAt: string | null;
};

type SurveyRow = {
  id: string;
  title: string;
  purpose: unknown;
  organisation_id: string | null;
  folder_id: string | null;
  deleted_at: string | null;
  updated_at: string | null;
  slug: string | null;
  visibility: string | null;
};

const SURVEY_LIST_COLUMNS =
  "id, title, purpose, organisation_id, folder_id, deleted_at, updated_at, slug, visibility";

/**
 * All questionnaires belonging to an organisation:
 * - `surveys.organisation_id`
 * - folders named like the organisation (name, slug or display name)
 * - survey titles that match those identifiers
 * - surveys used as agent source in this org
 *
 * Surveys found via folder/title with a missing `organisation_id` are linked
 * so they stay assigned after folder renames.
 */
export async function listSurveysForOrganisation(input: {
  organisationId: string;
  limit?: number;
}): Promise<OrganisationSurveyListItem[]> {
  const supabase = createServiceClient();
  const limit = input.limit ?? 120;

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name, slug")
    .eq("id", input.organisationId)
    .maybeSingle();

  const { data: orgConfig } = await supabase
    .from("dt_org_config")
    .select("display_name, website_url")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  const aliases = organisationMatchAliases({
    name: organisation?.name,
    slug: organisation?.slug,
    displayName: orgConfig?.display_name,
    websiteUrl: orgConfig?.website_url,
  });
  const orgName = aliases[0] ?? organisation?.name ?? organisation?.slug ?? "";
  const orgAliases = aliases.slice(1);
  const needles = organisationIlikeNeedles(aliases);

  const surveyById = new Map<string, SurveyRow>();

  const { data: orgSurveys } = await supabase
    .from("surveys")
    .select(SURVEY_LIST_COLUMNS)
    .eq("organisation_id", input.organisationId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  for (const s of orgSurveys ?? []) {
    surveyById.set(s.id, s as SurveyRow);
  }

  const { data: folders } = await supabase
    .from("survey_folders")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);

  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name]));
  const matchedFolders = matchSurveyFoldersToOrganisationName(
    folders ?? [],
    orgName,
    orgAliases,
  );
  const folderIds = new Set(matchedFolders.map((f) => f.id));

  for (const needle of needles) {
    const { data: namedFolders } = await supabase
      .from("survey_folders")
      .select("id, name")
      .ilike("name", `%${escapeIlikePattern(needle)}%`)
      .limit(80);
    for (const folder of namedFolders ?? []) {
      folderNameById.set(folder.id, folder.name);
      if (organisationLabelMatches(folder.name, orgName, orgAliases)) {
        folderIds.add(folder.id);
      }
    }
  }
  for (const s of surveyById.values()) {
    if (s.folder_id) folderIds.add(s.folder_id);
  }

  if (folderIds.size > 0) {
    const { data: folderSurveys } = await supabase
      .from("surveys")
      .select(SURVEY_LIST_COLUMNS)
      .in("folder_id", [...folderIds])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    for (const s of folderSurveys ?? []) {
      surveyById.set(s.id, s as SurveyRow);
    }
  }

  const { data: agentSources } = await supabase
    .from("dt_agents")
    .select("source_survey_id")
    .eq("organisation_id", input.organisationId)
    .not("source_survey_id", "is", null);

  const missingIds = [
    ...new Set(
      (agentSources ?? [])
        .map((a) => a.source_survey_id)
        .filter((id): id is string => typeof id === "string" && !surveyById.has(id)),
    ),
  ];
  if (missingIds.length > 0) {
    const { data: linked } = await supabase
      .from("surveys")
      .select(SURVEY_LIST_COLUMNS)
      .in("id", missingIds)
      .is("deleted_at", null);
    for (const s of linked ?? []) {
      surveyById.set(s.id, s as SurveyRow);
    }
  }

  const { data: titleCandidates } = await supabase
    .from("surveys")
    .select(SURVEY_LIST_COLUMNS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  for (const s of titleCandidates ?? []) {
    const row = s as SurveyRow;
    if (surveyById.has(row.id)) continue;
    if (row.organisation_id && row.organisation_id !== input.organisationId) continue;
    if (!organisationLabelMatches(row.title, orgName, orgAliases)) continue;
    surveyById.set(row.id, row);
  }

  for (const needle of needles) {
    const { data: namedSurveys } = await supabase
      .from("surveys")
      .select(SURVEY_LIST_COLUMNS)
      .is("deleted_at", null)
      .ilike("title", `%${escapeIlikePattern(needle)}%`)
      .limit(80);
    for (const s of namedSurveys ?? []) {
      const row = s as SurveyRow;
      if (surveyById.has(row.id)) continue;
      if (!organisationLabelMatches(row.title, orgName, orgAliases)) continue;
      surveyById.set(row.id, row);
    }
  }

  const unassignedIds = [...surveyById.values()]
    .filter((s) => !s.organisation_id)
    .map((s) => s.id);
  if (unassignedIds.length > 0) {
    const { error: linkError } = await supabase
      .from("surveys")
      .update({ organisation_id: input.organisationId })
      .in("id", unassignedIds)
      .is("organisation_id", null)
      .is("deleted_at", null);
    if (!linkError) {
      for (const id of unassignedIds) {
        const row = surveyById.get(id);
        if (row) row.organisation_id = input.organisationId;
      }
    }
  }

  const surveyIds = [...surveyById.keys()];
  if (surveyIds.length === 0) return [];

  const { data: responses } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, updated_at, completed_at")
    .in("survey_id", surveyIds)
    .order("updated_at", { ascending: false })
    .limit(500);

  const bestResponseBySurvey = new Map<
    string,
    { id: string; status: string; updatedAt: string | null }
  >();
  for (const row of responses ?? []) {
    if (bestResponseBySurvey.has(row.survey_id)) continue;
    bestResponseBySurvey.set(row.survey_id, {
      id: row.id,
      status: row.status,
      updatedAt: row.completed_at ?? row.updated_at ?? null,
    });
  }

  const items: OrganisationSurveyListItem[] = [...surveyById.values()]
    .filter((s) => !s.deleted_at && s.title)
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
    .slice(0, limit)
    .map((s) => {
      const response = bestResponseBySurvey.get(s.id) ?? null;
      return {
        surveyId: s.id,
        title: s.title,
        purpose: normalizeSurveyPurpose(s.purpose),
        folderId: s.folder_id,
        folderName: s.folder_id ? folderNameById.get(s.folder_id) ?? null : null,
        organisationId: s.organisation_id,
        updatedAt: s.updated_at,
        slug: typeof s.slug === "string" && s.slug.trim() ? s.slug : null,
        visibility: s.visibility ?? null,
        responseId: response?.id ?? null,
        responseStatus: response?.status ?? null,
        responseUpdatedAt: response?.updatedAt ?? null,
      };
    });

  return items;
}

/** Questionnaires that have no `surveys.organisation_id` yet. */
export async function countUnassignedSurveys(): Promise<number> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("surveys")
    .select("id", { count: "exact", head: true })
    .is("organisation_id", null)
    .is("deleted_at", null);
  return count ?? 0;
}

export async function listUnassignedSurveys(input?: {
  limit?: number;
}): Promise<OrganisationSurveyListItem[]> {
  const supabase = createServiceClient();
  const limit = input?.limit ?? 120;

  const { data: surveys } = await supabase
    .from("surveys")
    .select(SURVEY_LIST_COLUMNS)
    .is("organisation_id", null)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const rows = (surveys ?? []) as SurveyRow[];
  if (rows.length === 0) return [];

  const { data: folders } = await supabase
    .from("survey_folders")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);
  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name]));

  const surveyIds = rows.map((s) => s.id);
  const { data: responses } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, updated_at, completed_at")
    .in("survey_id", surveyIds)
    .order("updated_at", { ascending: false })
    .limit(500);

  const bestResponseBySurvey = new Map<
    string,
    { id: string; status: string; updatedAt: string | null }
  >();
  for (const row of responses ?? []) {
    if (bestResponseBySurvey.has(row.survey_id)) continue;
    bestResponseBySurvey.set(row.survey_id, {
      id: row.id,
      status: row.status,
      updatedAt: row.completed_at ?? row.updated_at ?? null,
    });
  }

  return rows
    .filter((s) => !s.deleted_at && s.title)
    .map((s) => {
      const response = bestResponseBySurvey.get(s.id) ?? null;
      return {
        surveyId: s.id,
        title: s.title,
        purpose: normalizeSurveyPurpose(s.purpose),
        folderId: s.folder_id,
        folderName: s.folder_id ? folderNameById.get(s.folder_id) ?? null : null,
        organisationId: s.organisation_id,
        updatedAt: s.updated_at,
        slug: typeof s.slug === "string" && s.slug.trim() ? s.slug : null,
        visibility: s.visibility ?? null,
        responseId: response?.id ?? null,
        responseStatus: response?.status ?? null,
        responseUpdatedAt: response?.updatedAt ?? null,
      };
    });
}

/** True when the survey is among the questionnaires for this organisation. */
export async function surveyBelongsToOrganisation(input: {
  surveyId: string;
  organisationId: string;
}): Promise<boolean> {
  const items = await listSurveysForOrganisation({
    organisationId: input.organisationId,
    limit: 200,
  });
  return items.some((s) => s.surveyId === input.surveyId);
}
