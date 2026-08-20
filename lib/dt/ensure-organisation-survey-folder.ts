import {
  matchSurveyFoldersToOrganisationName,
  pickPreferredSurveyFolder,
} from "@/lib/dt/agent-survey-coverage-options";
import { createServiceClient } from "@/lib/supabase/service";

const FOLDER_NAME_MAX = 80;

export function suggestedSurveyFolderName(input: {
  name?: string | null;
  slug?: string | null;
  displayName?: string | null;
}): string {
  const raw =
    String(input.displayName ?? "").trim() ||
    String(input.name ?? "").trim() ||
    String(input.slug ?? "").trim() ||
    "Organisation";
  return raw.slice(0, FOLDER_NAME_MAX);
}

type FolderRow = { id: string; name: string };

async function loadOrganisationFolderContext(organisationId: string) {
  const supabase = createServiceClient();
  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name, slug")
    .eq("id", organisationId)
    .maybeSingle();
  if (!organisation) return null;

  const { data: orgConfig } = await supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  const { data: folders } = await supabase
    .from("survey_folders")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);

  const aliases = [organisation.slug, orgConfig?.display_name].filter(
    (v): v is string => Boolean(v?.trim()),
  );
  const preferredNames = [
    organisation.name,
    orgConfig?.display_name,
    organisation.slug,
  ].filter((v): v is string => Boolean(v?.trim()));
  const matched = matchSurveyFoldersToOrganisationName(
    folders ?? [],
    organisation.name,
    aliases,
  );
  const existing = pickPreferredSurveyFolder(matched, preferredNames);

  return {
    supabase,
    organisation,
    displayName: orgConfig?.display_name ?? null,
    aliases,
    preferredNames,
    existing: existing ? { id: existing.id, name: existing.name } : null,
  };
}

export async function findOrganisationSurveyFolder(
  organisationId: string,
): Promise<FolderRow | null> {
  const ctx = await loadOrganisationFolderContext(organisationId);
  return ctx?.existing ?? null;
}

export async function ensureOrganisationSurveyFolder(input: {
  organisationId: string;
  createdByUserId: string;
}): Promise<
  | { ok: true; folderId: string; folderName: string; created: boolean }
  | { ok: false; message: string }
> {
  const ctx = await loadOrganisationFolderContext(input.organisationId);
  if (!ctx) return { ok: false, message: "Organisation nicht gefunden." };
  if (ctx.existing) {
    return {
      ok: true,
      folderId: ctx.existing.id,
      folderName: ctx.existing.name,
      created: false,
    };
  }

  const baseName = suggestedSurveyFolderName({
    name: ctx.organisation.name,
    slug: ctx.organisation.slug,
    displayName: ctx.displayName,
  });
  const slugSuffix = ctx.organisation.slug?.trim()
    ? ` (${ctx.organisation.slug.trim()})`
    : "";
  const fallbackName = `${baseName.slice(
    0,
    Math.max(1, FOLDER_NAME_MAX - slugSuffix.length),
  )}${slugSuffix}`.slice(0, FOLDER_NAME_MAX);

  for (const folderName of [...new Set([baseName, fallbackName])]) {
    const { data: created, error } = await ctx.supabase
      .from("survey_folders")
      .insert({ name: folderName, created_by_user_id: input.createdByUserId })
      .select("id, name")
      .single();
    if (created?.id) {
      return {
        ok: true,
        folderId: created.id,
        folderName: created.name,
        created: true,
      };
    }
    if (error) {
      const retried = await loadOrganisationFolderContext(input.organisationId);
      if (retried?.existing) {
        return {
          ok: true,
          folderId: retried.existing.id,
          folderName: retried.existing.name,
          created: false,
        };
      }
    }
  }

  return { ok: false, message: "Fragebogen-Ordner konnte nicht angelegt werden." };
}
