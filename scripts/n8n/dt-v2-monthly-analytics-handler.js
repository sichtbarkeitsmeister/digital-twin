/**
 * n8n Code node — DT v2 Monthly Analytics (stub: writes placeholder stats; extend with GA4/GSC/Sistrix).
 * Expects input item: { organisationId, periodMonth? } per org.
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

const organisationId = $json.body?.organisationId ?? $json.organisationId;
if (!organisationId) {
  throw new Error('organisationId fehlt');
}

const now = new Date();
const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const periodMonth =
  $json.body?.periodMonth ??
  $json.periodMonth ??
  `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;

async function ingest(body) {
  return await this.helpers.httpRequest({
    method: 'POST',
    url: `${appBase}/api/dt/internal/seo-monthly-stats`,
    headers: {
      'Content-Type': 'application/json',
      'X-DT-Webhook-Secret': secret,
    },
    body,
    json: true,
  });
}

try {
  const res = await ingest({
    organisationId,
    periodMonth,
    aiClicks: Number($json.body?.aiClicks ?? $json.aiClicks ?? 0),
    totalClicks: Number($json.body?.totalClicks ?? $json.totalClicks ?? 0),
    impressions: Number($json.body?.impressions ?? $json.impressions ?? 0),
    rankingsTop10: Number($json.body?.rankingsTop10 ?? $json.rankingsTop10 ?? 0),
    rankingsTop3: Number($json.body?.rankingsTop3 ?? $json.rankingsTop3 ?? 0),
    visibilityIndex:
      $json.body?.visibilityIndex ?? $json.visibilityIndex ?? null,
    rawData: {
      source: 'dt-v2-monthly-analytics-stub',
      top_keywords: $json.body?.topKeywords ?? $json.topKeywords ?? [],
    },
  });

  return [{ json: { ok: true, organisationId, periodMonth, stat: res.stat } }];
} catch (err) {
  throw new Error(err.message || String(err));
}
