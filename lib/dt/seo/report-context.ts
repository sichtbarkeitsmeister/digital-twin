import { resolveOrganisationSlug } from "@/lib/dt/org-slug";
import { syncOrgFocusKeywordFromAnbieter } from "@/lib/dt/seo/focus-keywords-from-anbieter";
import { buildLegacySeoClientConfig } from "@/lib/dt/seo/legacy-seo-config";
import { createServiceClient } from "@/lib/supabase/service";

export type { LegacySeoClientConfig as LegacySeoReportConfig } from "@/lib/dt/seo/legacy-seo-config";

export type SeoReportContext = {
  reportId: string;
  organisationId: string;
  recipientType: string;
  config: ReturnType<typeof buildLegacySeoClientConfig>;
};

export async function loadSeoReportContext(reportId: string): Promise<SeoReportContext | null> {
  const supabase = createServiceClient();

  const { data: report, error } = await supabase
    .from("dt_seo_reports")
    .select(
      "id,organisation_id,recipient_type,recipient_email,url,focus_keyword,timeframe,ga4_property_id,gsc_site_url,sistrix_domain",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error || !report) return null;

  const { data: org } = await supabase
    .from("organisations")
    .select("name,slug")
    .eq("id", report.organisation_id)
    .maybeSingle();

  const slug = resolveOrganisationSlug({ slug: org?.slug, name: org?.name });
  if (!slug) return null;

  const { data: orgCfg } = await supabase
    .from("dt_org_config")
    .select("ga4_account,gsc_account,focus_keyword")
    .eq("organisation_id", report.organisation_id)
    .maybeSingle();

  const url = String(report.url ?? "").trim();
  if (!url) return null;

  let focusKeyword =
    String(report.focus_keyword ?? "").trim() || String(orgCfg?.focus_keyword ?? "").trim() || "";

  // Report rows snapshot focus_keyword at queue time. Keywords typed into the
  // Anbieter questions (Angebotsbegriffe / Problembegriffe) often never landed
  // in that column, so n8n received null.
  if (!focusKeyword) {
    try {
      const resolved = await syncOrgFocusKeywordFromAnbieter({
        organisationId: report.organisation_id,
        supabase,
      });
      focusKeyword = String(resolved.joined ?? "").trim();
    } catch (e) {
      console.error("syncOrgFocusKeywordFromAnbieter failed", e);
    }
  }

  if (focusKeyword && focusKeyword !== String(report.focus_keyword ?? "").trim()) {
    await supabase.from("dt_seo_reports").update({ focus_keyword: focusKeyword }).eq("id", report.id);
  }

  return {
    reportId: report.id,
    organisationId: report.organisation_id,
    recipientType: report.recipient_type,
    config: buildLegacySeoClientConfig({
      url,
      focus_keyword: focusKeyword || null,
      timeframe: report.timeframe,
      recipient_email: report.recipient_email,
      ga4_property_id: report.ga4_property_id,
      gsc_site_url: report.gsc_site_url,
      sistrix_domain: report.sistrix_domain,
      ga4_account: orgCfg?.ga4_account,
      gsc_account: orgCfg?.gsc_account,
      client: slug,
    }),
  };
}
