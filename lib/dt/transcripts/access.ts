import type { SupabaseClient } from "@supabase/supabase-js";

import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";

export async function requireTranscriptAccess(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (await isPlatformAdmin(supabase, userId)) return { ok: true };
  if (await canManageDtAgents(supabase, userId, organisationId)) return { ok: true };
  return {
    ok: false,
    status: 403,
    message: "Keine Berechtigung für Transkripte dieser Organisation.",
  };
}
