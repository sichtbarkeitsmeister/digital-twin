/**
 * n8n Code node: turn webhook + org config into one item per URL for inspection.
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
if (!gscSiteUrl) {
  throw new Error("gsc_site_url fehlt in den SEO-Einstellungen.");
}

const limit = Math.min(Math.max(Number(webhook.limit) || 10, 1), 20);
let urls = Array.isArray(webhook.urls)
  ? webhook.urls.map((u) => String(u).trim()).filter(Boolean)
  : [];

if (!urls.length) {
  const sitemapRes = await this.helpers.httpRequest({
    method: "POST",
    url: `${appBase}/api/dt/seo/site-search`,
    headers: {
      "Content-Type": "application/json",
      "X-DT-Webhook-Secret": dtSecret,
    },
    body: { organisationId, action: "sitemap", limit },
    json: true,
  });
  const text = String(sitemapRes?.text || "");
  const found = [...text.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) => m[0]);
  urls = [...new Set(found)].slice(0, limit);
}

urls = [...new Set(urls)].slice(0, limit);
if (!urls.length) {
  throw new Error("Keine URLs für die Inspection gefunden.");
}

return urls.map((url) => ({
  json: {
    organisationId,
    gscSiteUrl,
    gscAccount,
    inspectionUrl: url,
  },
}));
