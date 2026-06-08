/**
 * n8n Code node — DT v2 SEO Report (minimal pipeline; extend with GA4/GSC/Sistrix later).
 */
const reportId = $json.body?.reportId ?? $json.reportId;
if (!reportId) {
  throw new Error('reportId fehlt');
}

const appBase = '__DT_APP_BASE_URL__';
const secret = '__DT_INTERNAL_WEBHOOK_SECRET__';

async function complete(body) {
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: `${appBase}/api/dt/seo/reports/${reportId}/complete`,
    headers: {
      'Content-Type': 'application/json',
      'X-DT-Webhook-Secret': secret,
    },
    body,
    json: true,
  });
  return res;
}

try {
  await complete({ state: 'running' });

  const recommendations = [
    { title: 'Meta-Titel der Startseite prüfen', action: 'Titel auf Fokus-Keyword ausrichten' },
    { title: 'Interne Verlinkung verbessern', action: 'Wichtige Unterseiten von der Startseite verlinken' },
  ];

  await complete({
    state: 'done',
    payload: {
      generatedAt: new Date().toISOString(),
      summary: 'SEO-Report (Platzhalter) — GA4/GSC/Sistrix-Knoten in n8n ergänzen.',
      recommendations,
    },
    pdfPath: null,
  });

  return [{ json: { ok: true, reportId } }];
} catch (err) {
  await complete({
    state: 'error',
    stateMessage: err.message || String(err),
  });
  throw err;
}
