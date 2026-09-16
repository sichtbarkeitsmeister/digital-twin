/**
 * n8n Code node: map Search Analytics page rows → app ingest API.
 */
const appBase = "__DT_APP_BASE_URL__";
const dtSecret = "__DT_INTERNAL_WEBHOOK_SECRET__";

const items = $input.all();
const prep = $("Prepare").first().json;
const organisationId = prep.organisationId;
const crawlId = prep.crawlId || null;
const startDate = prep.startDate;
const endDate = prep.endDate;

if (!organisationId) {
  throw new Error("organisationId fehlt.");
}

const first = items[0]?.json || {};
const errorText =
  first.error ||
  first.message ||
  (first.status >= 400 ? `GSC HTTP ${first.status}` : null);

const rows = Array.isArray(first.rows)
  ? first.rows
  : Array.isArray(first.body?.rows)
    ? first.body.rows
    : [];

const pages = rows.map((row) => ({
  keys: row.keys,
  url: Array.isArray(row.keys) ? row.keys[0] : row.url,
  clicks: row.clicks,
  impressions: row.impressions,
  ctr: row.ctr,
  position: row.position,
}));

const res = await this.helpers.httpRequest({
  method: "POST",
  url: `${appBase}/api/dt/internal/seo-gsc-pages`,
  headers: {
    "Content-Type": "application/json",
    "X-DT-Webhook-Secret": dtSecret,
  },
  body: {
    organisationId,
    crawlId,
    startDate,
    endDate,
    error: pages.length === 0 && errorText ? String(errorText) : null,
    pages,
  },
  json: true,
});

return [
  {
    json: {
      ok: true,
      organisationId,
      crawlId,
      pageCount: pages.length,
      ingest: res,
    },
  },
];
