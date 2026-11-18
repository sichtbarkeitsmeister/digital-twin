/**
 * „Kernregeln“: the agency's rules that hold in EVERY step of Texte. The Text-Prompt and the
 * Textvorlagen reach the SEO step only; whatever the later steps must keep (what may stand once
 * per page, headings that are not allowed, where a mandatory element belongs) had to be repeated
 * in each step prompt. The Kernregeln are one field under Globale Prompts, stored in
 * `dt_platform_settings.content_core_rules` (migration 20261118) and added to every step's system
 * prompt in code. Empty means none: the prompts are exactly as before. Pure helpers plus the loader.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTENT_CORE_RULES_MAX_CHARS = 20_000;
export const CONTENT_CORE_RULES_MIGRATION_FILE = "database/migrations/20261118_dt_content_core_rules.sql";
export const CONTENT_CORE_RULES_HREF = "/dashboard/verwaltung/globale-prompts#kernregeln";

/** The stored text, cleaned; empty when there are none. Never cut silently: the route refuses a longer text. */
export function resolveContentCoreRules(stored: string | null | undefined): string {
  return (stored ?? "").replace(/\r\n?/g, "\n").trim().slice(0, CONTENT_CORE_RULES_MAX_CHARS);
}

/**
 * The block every step's system prompt gets; empty without Kernregeln. They stand beside the
 * step's own instruction. The fixed rules of the tool (facts, Anrede, verbotene Wörter,
 * Branchenregel) and the „Hinweise zum Texten“ of the customer go before them.
 */
export function contentCoreRulesBlock(rules: string | null | undefined): string {
  const text = resolveContentCoreRules(rules);
  if (!text) return "";
  return `Kernregeln der Agentur (gelten in jedem Schritt dieser Pipeline, zusammen mit der Schrittanweisung; kein Schritt hebt sie auf oder macht rückgängig, was ein früherer Schritt nach ihnen geschrieben hat; die festen Regeln zu Tatsachen, Anrede, verbotenen Wörtern und Branche sowie die Hinweise zum Texten gehen ihnen vor):\n${text}`;
}

export function isMissingCoreRulesColumn(message: string): boolean {
  return /content_core_rules|schema cache/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

/** The Kernregeln a page run reads. Any problem (also the missing migration) means none, never a failed step. */
export async function loadContentCoreRules(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.from("dt_platform_settings").select("content_core_rules").eq("id", "default").maybeSingle();
  if (error) {
    if (!isMissingCoreRulesColumn(error.message)) console.warn("[dt/content-core-rules] load:", error.message);
    return "";
  }
  const stored = (data as { content_core_rules?: unknown } | null)?.content_core_rules;
  return resolveContentCoreRules(typeof stored === "string" ? stored : null);
}
