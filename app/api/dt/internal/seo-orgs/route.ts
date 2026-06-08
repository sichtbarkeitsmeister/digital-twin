import { NextResponse } from "next/server";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_config")
    .select(
      "organisation_id,display_name,website_url,ga4_property_id,gsc_site_url,sistrix_domain,report_timeframe,organisations(slug)",
    )
    .eq("seo_enabled", true)
    .eq("disabled", false);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const orgs = (data ?? [])
    .map((row) => {
      const slug = (row.organisations as { slug?: string } | null)?.slug;
      if (!slug) return null;
      return {
        organisationId: row.organisation_id,
        slug,
        displayName: row.display_name,
        websiteUrl: row.website_url,
        ga4PropertyId: row.ga4_property_id,
        gscSiteUrl: row.gsc_site_url,
        sistrixDomain: row.sistrix_domain,
        reportTimeframe: row.report_timeframe,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, orgs });
}
