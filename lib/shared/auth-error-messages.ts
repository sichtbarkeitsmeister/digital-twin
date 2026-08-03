/**
 * Supabase returns English, technical auth errors ("email rate limit exceeded").
 * Those end up unfiltered in front of the user, who then cannot tell whether
 * something is broken or whether they simply have to wait.
 */
const RULES: Array<{ match: RegExp; message: string }> = [
  {
    match: /email rate limit exceeded|over_email_send_rate_limit/i,
    message:
      "Zu viele Anmeldelinks in kurzer Zeit angefordert. Bitte in etwa einer Stunde erneut versuchen — der bereits verschickte Link funktioniert weiterhin.",
  },
  {
    match: /only request this after (\d+) seconds?/i,
    message:
      "Der letzte Anmeldelink ist gerade erst rausgegangen. Bitte kurz warten und es dann erneut versuchen.",
  },
  {
    match: /rate limit|too many requests/i,
    message: "Zu viele Versuche in kurzer Zeit. Bitte etwas warten und es erneut versuchen.",
  },
  {
    match: /signups not allowed|signup is disabled|user not found/i,
    message:
      "Für diese E-Mail gibt es noch keinen Zugang. Bitte zuerst über „Zugang anfordern“ starten.",
  },
  {
    match: /invalid email|unable to validate email/i,
    message: "Bitte eine gültige E-Mail-Adresse eingeben.",
  },
  {
    match: /email not confirmed/i,
    message: "Diese E-Mail ist noch nicht bestätigt. Bitte zuerst den Link aus der Einladung öffnen.",
  },
  {
    match: /failed to fetch|network|load failed/i,
    message: "Keine Verbindung zum Server. Bitte Internetverbindung prüfen und erneut versuchen.",
  },
];

/** Turns a Supabase auth error into a German message a user can act on. */
export function germanAuthErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!raw.trim()) return "Ein Fehler ist aufgetreten. Bitte erneut versuchen.";

  const seconds = raw.match(/only request this after (\d+) seconds?/i)?.[1];
  if (seconds) {
    return `Der letzte Anmeldelink ist gerade erst rausgegangen. Bitte noch ${seconds} Sekunden warten.`;
  }

  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.message;
  }

  return `Anmeldung fehlgeschlagen: ${raw}`;
}
