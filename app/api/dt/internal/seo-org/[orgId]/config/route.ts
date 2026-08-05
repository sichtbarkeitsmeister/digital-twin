import { NextResponse } from "next/server";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { resolveOrganisationSlug } from "@/lib/dt/org-slug";
import { buildLegacySeoClientConfig } from "@/lib/dt/seo/legacy-seo-config";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: Request, context: { params: Promise<{ orgId: string }> }) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const { orgId } = await context.params;
  const supabase = createServiceClient();

  const { data: cfg, error } = await supabase
    .from("dt_org_config")
    .select(
      "organisation_id,display_name,website_url,ga4_property_id,gsc_site_url,sistrix_domain,report_timeframe,report_recipient_email,seo_enabled,disabled,ga4_account,gsc_account,organisations(name,slug)",
    )
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error || !cfg) {
    return NextResponse.json({ ok: false, message: "Organisation nicht gefunden." }, { status: 404 });
  }

  if (!cfg.seo_enabled || cfg.disabled) {
    return NextResponse.json({ ok: false, message: "SEO nicht aktiv." }, { status: 400 });
  }

  const org = cfg.organisations as { name?: string; slug?: string } | null;
  const slug = resolveOrganisationSlug({ slug: org?.slug, name: org?.name }) ?? "";

  return NextResponse.json({
    ok: true,
    organisationId: cfg.organisation_id,
    config: buildLegacySeoClientConfig({
      url: cfg.website_url ?? "",
      focus_keyword: null,
      timeframe: cfg.report_timeframe,
      recipient_email: cfg.report_recipient_email ?? "",
      ga4_property_id: cfg.ga4_property_id,
      gsc_site_url: cfg.gsc_site_url,
      sistrix_domain: cfg.sistrix_domain,
      ga4_account: cfg.ga4_account,
      gsc_account: cfg.gsc_account,
      client: slug,
    }),
  });
}
