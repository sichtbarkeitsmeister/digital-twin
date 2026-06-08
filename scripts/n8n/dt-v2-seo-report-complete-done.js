/**
 * n8n Code node — finalize dt_seo_report (replaces "SEO Cache: Status Done").
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

const params = $('Parameter verarbeiten').first().json;
const reportId = params.reportId;
if (!reportId) {
  throw new Error('reportId fehlt');
}

let merged = {};
try {
  merged = $('Merge All Data').first().json ?? {};
} catch {
  merged = {};
}

let reportHtml = '';
try {
  reportHtml = $('Format Report').first().json?.report_html ?? '';
} catch {
  reportHtml = '';
}

const recommendations = [];
for (const item of merged.actionable_recommendations ?? merged.recommendations ?? []) {
  if (!item || typeof item !== 'object') continue;
  const action = typeof item.action === 'string' ? item.action.trim() : '';
  if (!action) continue;
  recommendations.push({
    title: item.title ?? null,
    keyword: item.keyword ?? null,
    position: item.position ?? null,
    impressions: item.impressions ?? null,
    clicks: item.clicks ?? null,
    url: item.url ?? null,
    action,
  });
}

await this.helpers.httpRequest({
  method: 'POST',
  url: `${appBase}/api/dt/seo/reports/${reportId}/complete`,
  headers: {
    'Content-Type': 'application/json',
    'X-DT-Webhook-Secret': secret,
  },
  body: {
    state: 'done',
    payload: {
      generatedAt: new Date().toISOString(),
      summary: merged.summary ?? null,
      keyword_analysis: merged.keyword_analysis ?? null,
      performance_matrix: merged.performance_matrix ?? null,
      reportHtml,
      recommendations,
      raw: merged,
    },
    pdfPath: null,
  },
  json: true,
});

return $input.all();
