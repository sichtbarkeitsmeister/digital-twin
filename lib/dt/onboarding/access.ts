import type { SupabaseClient } from "@supabase/supabase-js";

import { isPlatformAdmin } from "@/lib/dt/org-access";
import { shouldListAllOnboardingOrganisations } from "@/lib/dt/sbkm-staff";

async function emailForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId && user.email) return user.email;
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  return typeof data?.email === "string" ? data.email : null;
}

export async function canAccessOrgOnboarding(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const platformAdmin = await isPlatformAdmin(supabase, userId);
  const email = await emailForUser(supabase, userId);
  if (shouldListAllOnboardingOrganisations({ isPlatformAdmin: platformAdmin, email })) {
    return true;
  }
  const { data } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return true;
  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_user_id", userId)
    .is("archived_at", null)
    .maybeSingle();
  return Boolean(org);
}

export async function requireOnboardingAccess(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (await canAccessOrgOnboarding(supabase, userId, organisationId)) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    message: "Kein Zugriff auf das Onboarding dieser Organisation.",
  };
}
