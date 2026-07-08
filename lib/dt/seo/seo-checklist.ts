import type { SupabaseClient } from "@supabase/supabase-js";

export type SeoChecklistItem = string | { label: string };

export function formatSeoChecklist(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  return raw
    .map((item, i) => {
      if (typeof item === "string") return `${i + 1}. ${item}`;
      if (item && typeof item === "object" && "label" in item) {
        const label = String((item as { label?: unknown }).label ?? "").trim();
        if (label) return `${i + 1}. ${label}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function checklistToText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "label" in item) {
        return String((item as { label?: unknown }).label ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function textToChecklist(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveSeoChecklistRaw(
  org: {
    seo_checklist?: unknown;
    seo_checklist_personalized?: boolean | null;
  },
  globalChecklist: unknown,
): unknown {
  if (org.seo_checklist_personalized) {
    return org.seo_checklist;
  }
  return globalChecklist;
}

export async function loadGlobalSeoChecklist(supabase: SupabaseClient): Promise<unknown> {
  const { data } = await supabase
    .from("dt_platform_settings")
    .select("global_seo_checklist")
    .eq("id", "default")
    .maybeSingle();
  return data?.global_seo_checklist ?? [];
}
