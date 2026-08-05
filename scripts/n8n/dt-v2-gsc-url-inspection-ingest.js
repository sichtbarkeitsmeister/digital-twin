/**
 * n8n Code node: map URL Inspection responses → app ingest API.
 */
const appBase = "__DT_APP_BASE_URL__";
const dtSecret = "__DT_INTERNAL_WEBHOOK_SECRET__";

const items = $input.all();
if (!items.length) {
  return [{ json: { ok: false, message: "Keine Inspection-Ergebnisse." } }];
}

const organisationId = items[0].json.organisationId;
const results = [];

for (const item of items) {
  const j = item.json;
  const inspectionUrl = j.inspectionUrl || j.url;
  const apiBody = j.body || j;
  const index =
    apiBody?.inspectionResult?.indexStatusResult ||
    apiBody?.indexStatusResult ||
    null;
  if (!inspectionUrl || !organisationId) continue;

  results.push({
    url: inspectionUrl,
    inspectedAt: new Date().toISOString(),
    verdict: index?.verdict ?? null,
    coverageState: index?.coverageState ?? null,
    indexingState: index?.indexingState ?? null,
    pageFetchState: index?.pageFetchState ?? null,
    robotsTxtState: index?.robotsTxtState ?? null,
    crawledAs: index?.crawledAs ?? null,
    sitemap: Array.isArray(index?.sitemap) ? index.sitemap[0] ?? null : index?.sitemap ?? null,
    referringUrls: Array.isArray(index?.referringUrls) ? index.referringUrls : [],
    raw: apiBody?.inspectionResult || apiBody || {},
  });
}

if (!results.length) {
  return [{ json: { ok: false, message: "Keine verwertbaren Inspection-Ergebnisse." } }];
}

const res = await this.helpers.httpRequest({
  method: "POST",
  url: `${appBase}/api/dt/internal/seo-url-index-status`,
  headers: {
    "Content-Type": "application/json",
    "X-DT-Webhook-Secret": dtSecret,
  },
  body: { organisationId, results },
  json: true,
});

return [{ json: { ok: true, organisationId, count: results.length, ingest: res } }];
