/**
 * n8n Code node — fetch GA4/GSC/Sistrix totals for one org (monthly stats).
 * Uses the same OAuth credentials as the legacy SEO report workflow.
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

const organisationId = $json.organisationId ?? $json.body?.organisationId;
if (!organisationId) {
  throw new Error('organisationId fehlt');
}

const ctxRes = await this.helpers.httpRequest({
  method: 'GET',
  url: `${appBase}/api/dt/internal/seo-org/${organisationId}/config`,
  headers: {
    Accept: 'application/json',
    'X-DT-Webhook-Secret': secret,
  },
  json: true,
});

const cfg = ctxRes.config;
if (!cfg?.gsc_site_url) {
  throw new Error('GSC nicht konfiguriert für Organisation');
}

const now = new Date();
const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const prevMonthStart = new Date(Date.UTC(prevMonthEnd.getUTCFullYear(), prevMonthEnd.getUTCMonth(), 1));
const fmt = (d) => d.toISOString().slice(0, 10);
const periodMonth = `${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}-01`;

const gscSite = encodeURIComponent(cfg.gsc_site_url);
const gscBody = {
  startDate: fmt(prevMonthStart),
  endDate: fmt(prevMonthEnd),
  rowLimit: 1,
};

const gscRes = await this.helpers.httpRequest({
  method: 'POST',
  url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${gscSite}/searchAnalytics/query`,
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'googleSearchConsoleOAuth2Api',
  json: true,
  body: gscBody,
});

const gscRows = gscRes.rows ?? [];
const totalClicks = gscRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
const impressions = gscRows.reduce((s, r) => s + (r.impressions ?? 0), 0);

let aiClicks = 0;
let rankingsTop10 = 0;
let rankingsTop3 = 0;
let visibilityIndex = null;

if (cfg.ga4_property_id) {
  const aiRes = await this.helpers.httpRequest({
    method: 'POST',
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4_property_id}:runReport`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleAnalyticsOAuth2',
    json: true,
    body: {
      dateRanges: [{ startDate: fmt(prevMonthStart), endDate: fmt(prevMonthEnd) }],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: {
        orGroup: {
          expressions: [
            { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'chatgpt' } } },
            { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'perplexity' } } },
            { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'gemini' } } },
            { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'claude' } } },
          ],
        },
      },
      limit: 100,
    },
  });
  aiClicks = (aiRes.rows ?? []).reduce((s, row) => s + parseInt(row.metricValues?.[0]?.value ?? '0', 10), 0);
}

if (cfg.sistrix_domain) {
  const sistrixKey = $env.SISTRIX_API_KEY;
  if (sistrixKey) {
    const domain = String(cfg.sistrix_domain).replace(/^=/, '');
    const visRes = await this.helpers.httpRequest({
      method: 'GET',
      url: 'https://api.sistrix.com/domain.sichtbarkeitsindex',
      qs: { api_key: sistrixKey, domain, format: 'json' },
      json: true,
    });
    visibilityIndex = visRes?.answer?.[0]?.sichtbarkeitsindex?.value ?? null;
  }
}

const kwRes = await this.helpers.httpRequest({
  method: 'POST',
  url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${gscSite}/searchAnalytics/query`,
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'googleSearchConsoleOAuth2Api',
  json: true,
  body: {
    startDate: fmt(prevMonthStart),
    endDate: fmt(prevMonthEnd),
    dimensions: ['query'],
    rowLimit: 25000,
  },
});

for (const row of kwRes.rows ?? []) {
  const pos = row.position ?? 99;
  if (pos <= 10) rankingsTop10 += 1;
  if (pos <= 3) rankingsTop3 += 1;
}

const ingest = await this.helpers.httpRequest({
  method: 'POST',
  url: `${appBase}/api/dt/internal/seo-monthly-stats`,
  headers: {
    'Content-Type': 'application/json',
    'X-DT-Webhook-Secret': secret,
  },
  body: {
    organisationId,
    periodMonth,
    aiClicks,
    totalClicks,
    impressions,
    rankingsTop10,
    rankingsTop3,
    visibilityIndex,
    rawData: {
      source: 'dt-v2-monthly-analytics',
      gscSiteUrl: cfg.gsc_site_url,
      slug: cfg.client,
    },
  },
  json: true,
});

return [{ json: { ok: true, organisationId, periodMonth, stat: ingest.stat } }];
