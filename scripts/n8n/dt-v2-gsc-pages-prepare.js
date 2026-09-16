/**
 * n8n Code node: load org GSC config + date range for the pages sync.
 * Placeholders baked by deploy script.
 */
const appBase = "__DT_APP_BASE_URL__";
const dtSecret = "__DT_INTERNAL_WEBHOOK_SECRET__";

const webhook = $input.first().json.body || $input.first().json;
const organisationId = webhook.organisationId || webhook.organisation_id;
if (!organisationId) {
  throw new Error("organisationId fehlt.");
}

const orgRes = await this.helpers.httpRequest({
  method: "GET",
  url: `${appBase}/api/dt/internal/seo-org/${organisationId}/config`,
  headers: { "X-DT-Webhook-Secret": dtSecret },
  json: true,
});

const cfg = orgRes?.config || orgRes || {};
const gscSiteUrl = cfg.gsc_site_url || cfg.gscSiteUrl || "";
const gscAccount =
  cfg.gsc_account || cfg.gscAccount || "ads@sichtbarkeitsmeister.de";
const websiteUrl = cfg.url || cfg.website_url || "";

if (!gscSiteUrl) {
  throw new Error("gsc_site_url fehlt in den SEO-Einstellungen.");
}

const end = new Date();
const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
const fmt = (d) => d.toISOString().slice(0, 10);

return [
  {
    json: {
      organisationId,
      crawlId: webhook.crawlId || webhook.crawl_id || null,
      gscSiteUrl,
      gscAccount,
      websiteUrl,
      startDate: fmt(start),
      endDate: fmt(end),
    },
  },
];
