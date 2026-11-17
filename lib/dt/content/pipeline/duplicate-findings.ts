/**
 * The Endabnahme's duplicate check: the finished texts of the other pages are compared with this one
 * (code only, no model call), and what repeats becomes an open point for the release. It never
 * blocks the step: a text that cannot be loaded gives no findings.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { duplicateFindingsForPage, findDuplicateContent } from "@/lib/dt/content/duplicates";
import { loadContentTexts, type ContentPageRow } from "@/lib/dt/content/store";
import type { ContentFinding } from "@/lib/dt/content/types";

export async function loadDuplicateFindings(service: SupabaseClient, page: Pick<ContentPageRow, "organisation_id" | "slug">): Promise<ContentFinding[]> {
  try {
    const texts = await loadContentTexts(service, page.organisation_id);
    return duplicateFindingsForPage(findDuplicateContent(texts), page.slug);
  } catch (error) {
    console.warn("[content] duplicate check skipped:", error instanceof Error ? error.message : error);
    return [];
  }
}
