import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOrgConfig } from "@/lib/dt/db";
import { isOrgOwner, isPlatformAdmin } from "@/lib/dt/org-access";

/** Platform admin only — full SEO workspace (chat, tasks, crawl, config). */
export async function canAccessDtSeo(
  supabase: SupabaseClient,
  userId: string,
  _organisationId: string,
): Promise<boolean> {
  return isPlatformAdmin(supabase, userId);
}

/** Platform admin or org owner — read SEO reports for an organisation. */
export async function canViewOrgSeoReports(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(supabase, userId)) return true;
  return isOrgOwner(supabase, userId, organisationId);
}

export async function requireDtSeoReportAccess(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const allowed = await canViewOrgSeoReports(supabase, userId, organisationId);
  if (!allowed) {
    return {
      ok: false,
      message: "Kein Zugriff auf SEO-Reports dieser Organisation.",
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

  return { ok: true };
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
      message: "SEO-Modus ist nur für Plattform-Administratoren verfügbar.",
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
  return isPlatformAdmin(supabase, userId);
}
