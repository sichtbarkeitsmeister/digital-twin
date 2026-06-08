/**
 * n8n Code node — error callback (replaces "SEO Cache: Status Error").
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

let reportId = null;
try {
  reportId = $('Parameter verarbeiten').first().json.reportId;
} catch {
  reportId = $('HTTP Request1').first().json?.reportId ?? null;
}

const message =
  $json.error?.message ??
  $json.message ??
  ($json.execution?.error?.message || 'Unbekannter Fehler im SEO-Report-Workflow');

if (reportId) {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${appBase}/api/dt/seo/reports/${reportId}/complete`,
    headers: {
      'Content-Type': 'application/json',
      'X-DT-Webhook-Secret': secret,
    },
    body: { state: 'error', stateMessage: String(message).slice(0, 2000) },
    json: true,
  });
}

return [{ json: { ok: false, reportId, message } }];
