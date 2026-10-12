import type { SupabaseClient } from "@supabase/supabase-js";

import { formatGroundingPagesForPrompt } from "@/lib/dt/seo/grounding-pages";
import { loadGroundingPageViews } from "@/lib/dt/seo/grounding-pages-server";

/**
 * "Tool-Kontext" for the Grounding tool prompt: Hub, Entitätsseiten, llms.txt,
 * Datumswerte, Status und Notizen je Seite. Empty string on failure (never throws).
 */
export async function loadGroundingPromptText(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<string> {
  try {
    const [pages, { data: config }] = await Promise.all([
      loadGroundingPageViews(supabase, organisationId),
      supabase
        .from("dt_org_config")
        .select("website_url,grounding_llms_txt_url")
        .eq("organisation_id", organisationId)
        .maybeSingle(),
    ]);
    return formatGroundingPagesForPrompt({
      pages,
      llmsTxtUrl: config?.grounding_llms_txt_url ?? null,
      websiteUrl: config?.website_url ?? null,
    });
  } catch (err) {
    console.error("[grounding] prompt:", err instanceof Error ? err.message : err);
    return "";
  }
}
