import type { SupabaseClient } from "@supabase/supabase-js";

import { isPlatformAdmin } from "@/lib/dt/org-access";

/**
 * Token counts and cost estimates are internal operating data — customers
 * (org owners, admins, employees) never see them, only platform admins do.
 */
export async function canViewDtUsage(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return isPlatformAdmin(supabase, userId);
}

export async function userCanViewAnyDtUsage(userId: string): Promise<boolean> {
  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  return isPlatformAdmin(supabase, userId);
}
