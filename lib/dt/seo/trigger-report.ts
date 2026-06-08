export async function triggerDtSeoReportN8n(reportId: string, accessToken: string) {
  const webhook = process.env.N8N_DT_SEO_REPORT_WEBHOOK?.trim();
  if (!webhook) {
    throw new Error("N8N_DT_SEO_REPORT_WEBHOOK ist nicht konfiguriert.");
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ reportId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `n8n SEO-Report Webhook fehlgeschlagen (${res.status}).`);
  }
}
