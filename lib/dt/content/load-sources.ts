import type { SupabaseClient } from "@supabase/supabase-js";

import { isDefaultTwinAgent, isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import { filledWorkshopSections, type WorkshopAnbieterSection } from "@/lib/dt/content/mapping";
import type { ContentLocalSources } from "@/lib/dt/content/types";
import { normalizeAnbieterItems } from "@/lib/dt/transcripts/workshop-model";

export type ContentAvatarOption = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  createdAt: string;
};

export type ContentAvatarRow = {
  id: string;
  name: string;
  role: string | null;
  prompt_template: string | null;
  avatar_data: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The 13 Anbieter sections from the workshop corpus (always all keys; `current` may be empty). */
export async function loadContentWorkshopAnbieter(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<WorkshopAnbieterSection[]> {
  const { data, error } = await supabase
    .from("dt_workshop_corpus")
    .select("anbieter")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const anbieter = isRecord(data?.anbieter) ? data.anbieter : null;
  return normalizeAnbieterItems(anbieter?.items).map((item) => ({
    key: item.key,
    label: item.label,
    current: item.current,
  }));
}

/** Avatars for the dropdown: enabled `dt_agents` of the org without SEO advisors, newest first. */
export async function loadContentAvatarOptions(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentAvatarOption[]> {
  const { data } = await supabase
    .from("dt_agents")
    .select("id, name, role, kind, slug, created_at")
    .eq("organisation_id", organisationId)
    .eq("is_enabled", true)
    .order("created_at", { ascending: false });

  return (data ?? [])
    .filter((row) => !isSeoAdvisorAgent(row) && !isDefaultTwinAgent(row))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: (row.role as string | null) ?? null,
      kind: row.kind as string,
      createdAt: row.created_at as string,
    }));
}

export async function loadContentAvatarRow(
  supabase: SupabaseClient,
  organisationId: string,
  agentId: string,
): Promise<ContentAvatarRow | null> {
  const { data } = await supabase
    .from("dt_agents")
    .select("id, name, role, prompt_template, avatar_data")
    .eq("organisation_id", organisationId)
    .eq("id", agentId)
    .maybeSingle();
  return (data as ContentAvatarRow | null) ?? null;
}

export async function loadContentLocalSources(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentLocalSources> {
  const [sections, avatars, { data: structure }] = await Promise.all([
    loadContentWorkshopAnbieter(supabase, organisationId).catch(() => []),
    loadContentAvatarOptions(supabase, organisationId),
    supabase
      .from("dt_website_structures")
      .select("filename")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);
  const filled = filledWorkshopSections(sections);
  return {
    anbieter: filled > 0 ? { filled, total: sections.length } : null,
    avatarCount: avatars.length,
    structure: structure ? { filename: (structure.filename as string | null) ?? null } : null,
  };
}
