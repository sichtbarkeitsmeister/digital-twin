/**
 * Supabase reports auth problems in English and in developer wording. Customers
 * see these strings on the login page, so translate the ones we can recognise
 * and fall back to a neutral German sentence for everything else.
 */
const PATTERNS: Array<{ match: RegExp; message: string }> = [
  {
    match: /rate limit|too many requests/i,
    message:
      "Zu viele Anmeldeversuche in kurzer Zeit. Bitte warte ein paar Minuten und versuche es dann erneut.",
  },
  {
    match: /you can only request this after (\d+) seconds?/i,
    message:
      "Der letzte Anmeldelink wurde gerade erst verschickt. Bitte warte kurz und prüfe zunächst dein Postfach.",
  },
  {
    match: /signups? not allowed|signup is disabled|not authorized/i,
    message:
      "Für diese E-Mail-Adresse gibt es noch keinen Zugang. Bitte lass dich von deiner Organisation einladen.",
  },
  {
    match: /invalid|expired/i,
    message:
      "Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet. Fordere unten einfach einen neuen an.",
  },
  {
    match: /user not found/i,
    message:
      "Zu dieser E-Mail-Adresse finden wir keinen Zugang. Bitte prüfe die Schreibweise.",
  },
  {
    match: /email/i,
    message: "Bitte gib eine gültige E-Mail-Adresse ein.",
  },
];

export function translateAuthError(raw: string | null | undefined): string {
  const message = raw?.trim();
  if (!message) return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";

  for (const { match, message: translated } of PATTERNS) {
    if (match.test(message)) return translated;
  }

  return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";
}
