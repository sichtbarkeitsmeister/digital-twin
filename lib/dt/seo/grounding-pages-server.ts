import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DT_GROUNDING_PAGE_SELECT,
  serializeGroundingPage,
  sortGroundingPages,
  type DtGroundingPageView,
} from "@/lib/dt/seo/grounding-pages";
import type { DtGroundingPageRow } from "@/lib/dt/types";

const dateInput = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum ungültig"),
    z.literal(""),
    z.null(),
  ])
  .optional();

/** Shared body schema for creating / patching a grounding page. */
export const groundingPagePatchSchema = z.object({
  kind: z.enum(["hub", "entity"]).optional(),
  url: z.string().trim().url().max(2000).optional(),
  entityName: z.string().max(200).nullable().optional(),
  slug: z.string().max(120).nullable().optional(),
  standardVersion: z.string().max(10).nullable().optional(),
  reviewStatus: z.enum(["draft", "approved"]).optional(),
  uploadedAt: dateInput,
  dateModified: dateInput,
  lastReviewed: dateInput,
  reviewedBy: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  position: z.number().int().min(0).max(9999).optional(),
});

export type GroundingPagePatchInput = z.infer<typeof groundingPagePatchSchema>;

export async function loadGroundingPageRows(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtGroundingPageRow[]> {
  const { data, error } = await supabase
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return sortGroundingPages((data ?? []) as DtGroundingPageRow[]);
}

export async function loadGroundingPageViews(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtGroundingPageView[]> {
  const rows = await loadGroundingPageRows(supabase, organisationId);
  return rows.map((row) => serializeGroundingPage(row));
}

export async function loadGroundingPageRow(
  supabase: SupabaseClient,
  pageId: string,
): Promise<DtGroundingPageRow | null> {
  const { data } = await supabase
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("id", pageId)
    .maybeSingle();
  return (data as DtGroundingPageRow | null) ?? null;
}
