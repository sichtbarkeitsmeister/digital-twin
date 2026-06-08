/**
 * n8n Code node — parse GSC + optional GA4, ingest via internal API.
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

function firstNodeJson(...names) {
  for (const name of names) {
    try {
      const json = $(name).first().json;
      if (json) return json;
    } catch {
      // branch not executed
    }
  }
  return {};
}

const dates = $('Compute Dates').first().json;
const gsc = firstNodeJson('GSC Month Totals', 'GSC Month Totals ads2');
const rows = gsc.rows ?? [];

const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
const impressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);

let aiClicks = 0;
try {
  const ga4 = firstNodeJson('GA4 AI Referrers', 'GA4 AI Referrers ads2');
  aiClicks = (ga4.rows ?? []).reduce(
    (s, row) => s + parseInt(row.metricValues?.[0]?.value ?? '0', 10),
    0,
  );
} catch {
  aiClicks = 0;
}

let rankingsTop10 = 0;
let rankingsTop3 = 0;

try {
  const kw = firstNodeJson('GSC Keyword Rankings', 'GSC Keyword Rankings ads2');
  for (const row of kw.rows ?? []) {
    const pos = row.position ?? 99;
    if (pos <= 10) rankingsTop10 += 1;
    if (pos <= 3) rankingsTop3 += 1;
  }
} catch {
  // optional node
}

const res = await this.helpers.httpRequest({
  method: 'POST',
  url: `${appBase}/api/dt/internal/seo-monthly-stats`,
  headers: {
    'Content-Type': 'application/json',
    'X-DT-Webhook-Secret': secret,
  },
  body: {
    organisationId: dates.organisationId,
    periodMonth: dates.periodMonth,
    aiClicks,
    totalClicks,
    impressions,
    rankingsTop10,
    rankingsTop3,
    visibilityIndex: null,
    rawData: {
      source: 'dt-v2-monthly-analytics',
      slug: dates.config?.client ?? null,
      period: { start: dates.startDate, end: dates.endDate },
    },
  },
  json: true,
});

return [{ json: { ok: true, organisationId: dates.organisationId, periodMonth: dates.periodMonth, stat: res.stat } }];
