import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOrgConfig } from "@/lib/dt/db";
import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";

/** Org owner/admin or platform admin — required for SEO mode. */
export async function canAccessDtSeo(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  return canManageDtAgents(supabase, userId, organisationId);
}

export async function requireDtSeoAccess(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const allowed = await canAccessDtSeo(supabase, userId, organisationId);
  if (!allowed) {
    return {
      ok: false,
      message: "SEO-Modus ist nur für Administratoren verfügbar.",
      status: 403,
    };
  }

  const config = await loadOrgConfig(organisationId);
  if (!config) {
    return { ok: false, message: "Organisation nicht gefunden.", status: 404 };
  }

  if (config.disabled) {
    return { ok: false, message: "DigitalTwin ist für diese Organisation deaktiviert.", status: 503 };
  }

  const platformAdmin = await isPlatformAdmin(supabase, userId);
  if (!config.seo_enabled && !platformAdmin) {
    return { ok: false, message: "SEO ist für diese Organisation nicht aktiviert.", status: 403 };
  }

  return { ok: true };
}

export async function userCanAccessAnyDtSeo(userId: string): Promise<boolean> {
  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  if (await isPlatformAdmin(supabase, userId)) return true;

  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id, org_role")
    .eq("user_id", userId)
    .in("org_role", ["owner", "admin"]);

  if (!memberships?.length) return false;

  const ids = memberships.map((m) => m.organisation_id);
  const { data: configs } = await supabase
    .from("dt_org_config")
    .select("organisation_id,seo_enabled,disabled")
    .in("organisation_id", ids);

  return (configs ?? []).some((c) => c.seo_enabled && !c.disabled);
}
