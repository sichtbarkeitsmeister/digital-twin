/**
 * Supabase reports auth problems in English and in developer wording. Customers
 * see these strings on the login page, so translate the ones we can recognise
 * and fall back to a neutral German sentence for everything else.
 */
const PATTERNS: Array<{ match: RegExp; message: (m: RegExpMatchArray) => string }> = [
  {
    match: /you can only request this after (\d+) seconds?/i,
    message: (m) =>
      `Der letzte Anmeldelink wurde gerade erst verschickt. Bitte noch ${m[1]} Sekunden warten — ` +
      "der bereits verschickte Link funktioniert weiterhin.",
  },
  {
    match: /rate limit|too many requests/i,
    message: () =>
      "Es wurden zu viele Anmeldelinks in kurzer Zeit angefordert. Bitte in etwa einer Stunde " +
      "erneut versuchen — ein bereits verschickter Link funktioniert weiterhin.",
  },
  {
    match: /signups? not allowed|signup is disabled|not authorized/i,
    message: () =>
      "Für diese E-Mail-Adresse gibt es noch keinen Zugang. Bitte lass dich von deiner Organisation einladen.",
  },
  {
    match: /failed to fetch|network|offline/i,
    message: () =>
      "Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung und versuche es erneut.",
  },
  {
    match: /invalid|expired/i,
    message: () =>
      "Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet. Fordere unten einfach einen neuen an.",
  },
  {
    match: /user not found/i,
    message: () =>
      "Zu dieser E-Mail-Adresse finden wir keinen Zugang. Bitte prüfe die Schreibweise.",
  },
  {
    match: /email/i,
    message: () => "Bitte gib eine gültige E-Mail-Adresse ein.",
  },
];

export function translateAuthError(raw: string | null | undefined): string {
  const message = raw?.trim();
  if (!message) return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";

  for (const { match, message: translate } of PATTERNS) {
    const hit = message.match(match);
    if (hit) return translate(hit);
  }

  // Keep the original wording out of the customer's face, but not out of reach.
  console.warn("[auth] untranslated error:", message);
  return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";
}
