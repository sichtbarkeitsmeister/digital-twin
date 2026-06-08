/**
 * n8n Code node — compute previous calendar month date range.
 */
const cfg = $('Load Org Config').first().json.config ?? {};
const now = new Date();
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
const fmt = (d) => d.toISOString().slice(0, 10);
const periodMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;

return [{
  json: {
    organisationId: $('Load Org Config').first().json.organisationId,
    config: cfg,
    startDate: fmt(start),
    endDate: fmt(end),
    periodMonth,
    gscSiteUrl: cfg.gsc_site_url,
    ga4PropertyId: cfg.ga4_property_id,
    ga4_account: cfg.ga4_account ?? '',
    gsc_account: cfg.gsc_account ?? '',
  },
}];
