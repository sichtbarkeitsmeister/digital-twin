import { createServiceClient } from "@/lib/supabase/service";
import { slugifyOrganisationName } from "@/lib/dt/org-slug";
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

/** Letters/digits only — “Arctic Tub”, “arctic-tub” and “arctictub” become the same key. */
function compactAlnum(v: string): string {
  return v
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function identityKeys(label: string): Set<string> {
  const keys = new Set<string>();
  const norm = normalizeName(label);
  if (norm) keys.add(`n:${norm}`);
  const compact = compactAlnum(label);
  if (compact.length >= 4) keys.add(`c:${compact}`);
  const slug = slugifyOrganisationName(label);
  if (slug.length >= 4) {
    keys.add(`s:${slug}`);
    const slugCompact = compactAlnum(slug);
    if (slugCompact.length >= 4) keys.add(`c:${slugCompact}`);
  }
  return keys;
}

function collectAliases(organisationName: string, extraAliases: string[] = []): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const raw of [organisationName, ...extraAliases]) {
    const value = raw.trim();
    if (!value) continue;
    const key = normalizeName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(value);
  }
  return aliases;
}

function websiteHostAliases(websiteUrl: string | null | undefined): string[] {
  const raw = String(websiteUrl ?? "").trim();
  if (!raw) return [];
  let hostname = "";
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return [];
  }
  hostname = hostname.replace(/^www\./, "");
  if (!hostname) return [];
  const aliases = [hostname];
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length >= 2) {
    const sld = labels[0]!;
    aliases.push(sld);
    aliases.push(sld.replace(/-/g, " "));
    aliases.push(sld.replace(/-/g, ""));
  }
  return aliases;
}

/** Name, slug, display name and website host variants used to match folders/titles. */
export function organisationMatchAliases(input: {
  name?: string | null;
  slug?: string | null;
  displayName?: string | null;
  websiteUrl?: string | null;
}): string[] {
  return collectAliases(input.name ?? "", [
    input.slug ?? "",
    input.displayName ?? "",
    ...websiteHostAliases(input.websiteUrl),
  ]);
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Distinct strings to use with SQL ILIKE for this organisation. */
export function organisationIlikeNeedles(aliases: string[]): string[] {
  const needles = new Set<string>();
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (trimmed.length >= 4) needles.add(trimmed);
    const compact = compactAlnum(trimmed);
    if (compact.length >= 6) needles.add(compact);
    const slug = slugifyOrganisationName(trimmed);
    if (slug.length >= 4) needles.add(slug);
    const spaced = slug.replace(/-/g, " ");
    if (spaced.length >= 4) needles.add(spaced);
  }
  return [...needles];
}

/**
 * True when a folder name or survey title belongs to the organisation.
 * Treats slug, spaced brand names and camelCase as the same identity
 * (“arctictub” ↔ “Arctic Tub” ↔ “ArcticTub”).
 */
export function organisationLabelMatches(
  label: string,
  organisationName: string,
  extraAliases: string[] = [],
): boolean {
  const aliases = collectAliases(organisationName, extraAliases);
  if (aliases.length === 0) return false;

  const labelKeys = identityKeys(label);
  const labelCompact = compactAlnum(slugifyOrganisationName(label) || label);
  if (labelCompact.length < 4 && labelKeys.size === 0) return false;

  const aliasKeys = new Set<string>();
  const aliasCompacts: string[] = [];
  for (const alias of aliases) {
    for (const key of identityKeys(alias)) aliasKeys.add(key);
    const compact = compactAlnum(slugifyOrganisationName(alias) || alias);
    if (compact.length >= 4) aliasCompacts.push(compact);
  }

  for (const key of labelKeys) {
    if (aliasKeys.has(key)) return true;
  }

  for (const aliasCompact of aliasCompacts) {
    if (aliasCompact.length >= 6 && labelCompact.includes(aliasCompact)) return true;
  }

  const labelNorm = normalizeName(label);
  if (labelNorm.length < 4) return false;
  return aliases.some((alias) => {
    const org = normalizeName(alias);
    return Boolean(org) && (org.includes(labelNorm) || labelNorm.includes(org));
  });
}

/**
 * Match survey folders to an organisation by name, slug or display name.
 * Folders are the Umfragen-Explorer groups (often named like the org).
 */
export function matchSurveyFoldersToOrganisationName(
  folders: Array<{ id: string; name: string }>,
  organisationName: string,
  extraAliases: string[] = [],
): Array<{ id: string; name: string }> {
  const aliases = collectAliases(organisationName, extraAliases);
  if (aliases.length === 0) return [];

  const aliasKeys = new Set<string>();
  const aliasCompacts: string[] = [];
  for (const alias of aliases) {
    for (const key of identityKeys(alias)) aliasKeys.add(key);
    const compact = compactAlnum(slugifyOrganisationName(alias) || alias);
    if (compact.length >= 4) aliasCompacts.push(compact);
  }

  const exact = folders.filter((f) => {
    for (const key of identityKeys(f.name)) {
      if (aliasKeys.has(key)) return true;
    }
    return false;
  });
  if (exact.length > 0) return exact;

  const orgTokens = [
    ...new Set(
      aliases.flatMap((alias) =>
        normalizeName(alias)
          .split(/[\s/_-]+/)
          .filter((t) => t.length >= 3),
      ),
    ),
  ];

  // Soft match: shared meaningful tokens (handles “Ruth Hennes” vs “Hennes”).
  return folders.filter((f) => {
    const name = normalizeName(f.name);
    if (name.length < 4) return false;
    const folderCompact = compactAlnum(slugifyOrganisationName(f.name) || f.name);
    for (const alias of aliases) {
      const org = normalizeName(alias);
      if (org && (org.includes(name) || name.includes(org))) return true;
    }
    for (const aliasCompact of aliasCompacts) {
      if (aliasCompact.length >= 6 && folderCompact.includes(aliasCompact)) return true;
      if (folderCompact.length >= 8 && aliasCompact.includes(folderCompact)) return true;
    }
    const folderTokens = name.split(/[\s/_-]+/).filter((t) => t.length >= 3);
    if (folderTokens.length === 0 || orgTokens.length === 0) return false;
    const shared = folderTokens.filter((t) => orgTokens.includes(t));
    // Require at least 2 shared tokens, or 1 strong token (≥6 chars) plus another.
    if (shared.length >= 2) return true;
    return shared.some((t) => t.length >= 6) && shared.length >= 1 && folderTokens.length <= 3;
  });
}

/** Prefer a folder whose name equals the org name/slug/display name. */
export function pickPreferredSurveyFolder<T extends { id: string; name: string }>(
  folders: T[],
  preferredNames: string[],
): T | null {
  if (folders.length === 0) return null;
  for (const preferred of preferredNames) {
    const key = normalizeName(preferred);
    if (!key) continue;
    const hit = folders.find((f) => normalizeName(f.name) === key);
    if (hit) return hit;
  }
  for (const preferred of preferredNames) {
    const compact = compactAlnum(slugifyOrganisationName(preferred) || preferred);
    if (compact.length < 4) continue;
    const hit = folders.find(
      (f) => compactAlnum(slugifyOrganisationName(f.name) || f.name) === compact,
    );
    if (hit) return hit;
  }
  return folders[0] ?? null;
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
      if (organisationLabelMatches(folder.name, orgName, orgAliases)) {
        folderIds.add(folder.id);
      }
    }
  }

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

  const { data: titleCandidates } = await supabase
    .from("surveys")
    .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(500);
  for (const s of titleCandidates ?? []) {
    const row = s as SurveyListRow;
    if (surveyById.has(row.id)) continue;
    if (row.organisation_id && row.organisation_id !== input.organisationId) continue;
    if (!organisationLabelMatches(row.title, orgName, orgAliases)) continue;
    surveyById.set(row.id, row);
  }

  for (const needle of needles) {
    const { data: namedSurveys } = await supabase
      .from("surveys")
      .select("id, title, purpose, organisation_id, folder_id, deleted_at, updated_at")
      .is("deleted_at", null)
      .ilike("title", `%${escapeIlikePattern(needle)}%`)
      .limit(80);
    for (const s of namedSurveys ?? []) {
      const row = s as SurveyListRow;
      if (surveyById.has(row.id)) continue;
      if (!organisationLabelMatches(row.title, orgName, orgAliases)) continue;
      surveyById.set(row.id, row);
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
