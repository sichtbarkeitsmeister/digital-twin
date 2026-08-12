/**
 * Fire the n8n SEO report webhook.
 * User Bearer token is optional (legacy); webhook secret is preferred for system runs.
 */
export async function triggerDtSeoReportN8n(
  reportId: string,
  accessToken?: string | null,
) {
  const webhook = process.env.N8N_DT_SEO_REPORT_WEBHOOK?.trim();
  if (!webhook) {
    throw new Error("N8N_DT_SEO_REPORT_WEBHOOK ist nicht konfiguriert.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const secret = process.env.DT_INTERNAL_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers["X-DT-Webhook-Secret"] = secret;
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers,
    body: JSON.stringify({ reportId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `n8n SEO-Report Webhook fehlgeschlagen (${res.status}).`);
  }
}
