import { googleAccountForN8nRouting } from "@/lib/dt/seo/google-accounts";

/** Legacy `seo_clients` row shape expected by n8n SEO workflows. */
export type LegacySeoClientConfig = {
  url: string;
  focus_keyword: string | null;
  timeframe: string;
  recipient_email: string;
  ga4_property_id: string | null;
  gsc_site_url: string | null;
  sistrix_domain: string | null;
  ga4_account: string;
  gsc_account: string;
  client: string;
};

export function mapReportTimeframe(value: string | null | undefined): string {
  const tf = String(value ?? "last_30_days").trim();
  if (tf === "last_7_days" || tf === "last_30_days" || tf === "last_90_days") return tf;
  return "last_30_days";
}

export function buildLegacySeoClientConfig(input: {
  url: string;
  focus_keyword?: string | null;
  timeframe?: string | null;
  recipient_email: string;
  ga4_property_id?: string | null;
  gsc_site_url?: string | null;
  sistrix_domain?: string | null;
  ga4_account?: string | null;
  gsc_account?: string | null;
  client: string;
}): LegacySeoClientConfig {
  return {
    url: input.url,
    focus_keyword: input.focus_keyword ?? null,
    timeframe: mapReportTimeframe(input.timeframe),
    recipient_email: input.recipient_email,
    ga4_property_id: input.ga4_property_id ?? null,
    gsc_site_url: input.gsc_site_url ?? null,
    sistrix_domain: input.sistrix_domain ?? null,
    ga4_account: googleAccountForN8nRouting(input.ga4_account),
    gsc_account: googleAccountForN8nRouting(input.gsc_account),
    client: input.client,
  };
}
