export function verifyDtInternalWebhookSecret(req: Request): boolean {
  const expected = process.env.DT_INTERNAL_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const provided = req.headers.get("x-dt-webhook-secret")?.trim();
  return Boolean(provided && provided === expected);
}
