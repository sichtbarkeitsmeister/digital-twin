import type { SupabaseClient } from "@supabase/supabase-js";

import { formatWebsiteStructureForPrompt } from "@/lib/dt/seo/website-structure";

export type DtWebsiteStructureRow = {
  organisation_id: string;
  filename: string | null;
  mime_type: string | null;
  raw_text: string;
  outline: string;
  node_count: number;
  notes: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
};

export async function loadDtWebsiteStructure(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtWebsiteStructureRow | null> {
  const { data } = await supabase
    .from("dt_website_structures")
    .select(
      "organisation_id,filename,mime_type,raw_text,outline,node_count,notes,uploaded_at,uploaded_by",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle();
  return (data as DtWebsiteStructureRow | null) ?? null;
}

export function formatLoadedWebsiteStructureForPrompt(
  row: DtWebsiteStructureRow | null,
  options?: { emptyHint?: boolean },
): string {
  return formatWebsiteStructureForPrompt({
    outline: row?.outline ?? "",
    nodeCount: row?.node_count ?? 0,
    filename: row?.filename,
    uploadedAt: row?.uploaded_at,
    notes: row?.notes,
    emptyHint: options?.emptyHint,
  });
}
