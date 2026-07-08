import { NextResponse } from "next/server";
import { z } from "zod";

import { loadOrgConfig, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  websiteUrl: z.string().url().nullable().optional(),
  footerUrl: z.string().url().nullable().optional(),
  seoEnabled: z.boolean().optional(),
  ga4PropertyId: z.string().max(120).nullable().optional(),
  gscSiteUrl: z.string().max(500).nullable().optional(),
  sistrixDomain: z.string().max(200).nullable().optional(),
  sitemapUrl: z.string().url().nullable().optional(),
  focusKeyword: z.string().max(200).nullable().optional(),
  reportRecipientEmail: z.string().email().nullable().optional(),
  reportTimeframe: z
    .enum(["last_7_days", "last_30_days", "last_90_days"])
    .optional(),
  seoChecklist: z.array(z.union([z.string(), z.object({ label: z.string() })])).optional(),
  seoChecklistPersonalized: z.boolean().optional(),
});

export async function GET(
  _: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { orgId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId!, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const config = await loadOrgConfig(orgId);
  if (!config) {
    return NextResponse.json({ ok: false, message: "Konfiguration nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, config });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { orgId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.displayName !== undefined) patch.display_name = d.displayName;
  if (d.websiteUrl !== undefined) patch.website_url = d.websiteUrl;
  if (d.footerUrl !== undefined) patch.footer_url = d.footerUrl;
  if (d.seoEnabled !== undefined) patch.seo_enabled = d.seoEnabled;
  if (d.ga4PropertyId !== undefined) patch.ga4_property_id = d.ga4PropertyId;
  if (d.gscSiteUrl !== undefined) patch.gsc_site_url = d.gscSiteUrl;
  if (d.sistrixDomain !== undefined) patch.sistrix_domain = d.sistrixDomain;
  if (d.sitemapUrl !== undefined) patch.sitemap_url = d.sitemapUrl;
  if (d.focusKeyword !== undefined) patch.focus_keyword = d.focusKeyword;
  if (d.reportRecipientEmail !== undefined) patch.report_recipient_email = d.reportRecipientEmail;
  if (d.reportTimeframe !== undefined) patch.report_timeframe = d.reportTimeframe;
  if (d.seoChecklist !== undefined) patch.seo_checklist = d.seoChecklist;
  if (d.seoChecklistPersonalized !== undefined) {
    patch.seo_checklist_personalized = d.seoChecklistPersonalized;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("dt_org_config")
    .update(patch)
    .eq("organisation_id", orgId)
    .select(
      "organisation_id,display_name,twin_provisioned,seo_enabled,disabled,website_url,footer_url,ga4_property_id,gsc_site_url,sistrix_domain,sitemap_url,focus_keyword,report_recipient_email,report_timeframe,seo_checklist,seo_checklist_personalized,videos",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Speichern fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, config: data });
}
