/**
 * n8n Code node — mark dt_seo_report as running (insert after Load Report Context).
 */
const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

const ctx = $('HTTP Request1').first().json;
const reportId = ctx.reportId;
if (!reportId) {
  throw new Error('reportId fehlt in Report-Kontext');
}

await this.helpers.httpRequest({
  method: 'POST',
  url: `${appBase}/api/dt/seo/reports/${reportId}/complete`,
  headers: {
    'Content-Type': 'application/json',
    'X-DT-Webhook-Secret': secret,
  },
  body: { state: 'running' },
  json: true,
});

return [{ json: ctx }];
