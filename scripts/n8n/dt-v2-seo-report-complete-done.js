/**
 * n8n Code node — finalize dt_seo_report (replaces "SEO Cache: Status Done").
 * Claude continuing on error used to store a conversion-only HTML shell as done.
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

const params = $('Parameter verarbeiten').first().json;
const reportId = params.reportId;
if (!reportId) {
  throw new Error('reportId fehlt');
}

const postComplete = async (body) => {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${appBase}/api/dt/seo/reports/${reportId}/complete`,
    headers: {
      'Content-Type': 'application/json',
      'X-DT-Webhook-Secret': secret,
    },
    body,
    json: true,
  });
};

const claudeOutcome = () => {
  let claude;
  try {
    claude = $('Message a model').first().json;
  } catch {
    return { text: '', error: 'Knoten „Message a model“ hat keine Ausgabe.' };
  }
  const errMsg =
    (claude && claude.error && (claude.error.message || claude.error.description)) || '';
  if (errMsg) return { text: '', error: String(errMsg) };
  const blocks = claude && Array.isArray(claude.content) ? claude.content : [];
  const text = blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) {
    return {
      text: '',
      error: 'Claude hat kein Report-HTML geliefert. Report wird nicht als fertig gespeichert.',
    };
  }
  return { text, error: '' };
};

const claude = claudeOutcome();
if (!claude.text) {
  await postComplete({
    state: 'error',
    stateMessage: claude.error.slice(0, 2000),
  });
  throw new Error(claude.error);
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

if (!String(reportHtml).trim()) {
  const message = 'Format Report hat kein HTML geliefert. Report wird nicht als fertig gespeichert.';
  await postComplete({ state: 'error', stateMessage: message });
  throw new Error(message);
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

await postComplete({
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
});

return $input.all();
