import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderStaffMagicLinkEmail(opts: {
  loginUrl: string;
  forColleague?: string | null;
}) {
  const appBase = getAppBaseUrl();
  const colleague = opts.forColleague?.trim() || "";
  if (colleague) {
    return renderBrandedEmail({
      title: `Anmeldelink für ${colleague}`,
      eyebrow: "Anmeldung",
      preheader: `Anmeldelink für ${colleague} — bitte weiterleiten`,
      headline: `Anmeldelink für ${colleague}`,
      intro:
        `Hallo,\n\n${colleague} braucht diesen Link, um sich im DigitalTwin anzumelden. ` +
        "Bitte einmal weiterleiten (WhatsApp, Slack oder Mail), falls die eigene Mail nicht ankommt. " +
        "Alte Links aus früheren Versuchen funktionieren nicht.",
      details: [
        { label: "Konto", value: colleague },
        { label: "Portal", value: appBase },
        { label: "Art", value: "Magic Link" },
      ],
      actions: [{ label: "Link öffnen / prüfen", href: opts.loginUrl }],
      footerText:
        "Der Link gilt nur kurze Zeit und lässt sich einmal verwenden. " +
        "Unter Verwaltung → Plattform-Team kannst du jederzeit einen neuen erzeugen.",
    });
  }

  return renderBrandedEmail({
    title: "Anmeldelink für DigitalTwin",
    eyebrow: "Anmeldung",
    preheader: "Dein Anmeldelink für DigitalTwin",
    headline: "Hier geht’s zum DigitalTwin",
    intro:
      "Hallo,\n\ndu kannst dich mit dem Button unten direkt anmelden — ganz ohne Passwort. " +
      "Der Link gilt nur kurze Zeit und lässt sich einmal verwenden.",
    details: [
      { label: "Portal", value: appBase },
      { label: "Art", value: "Magic Link" },
    ],
    actions: [{ label: "Jetzt anmelden", href: opts.loginUrl }],
    footerText:
      "Das ist eine Anmelde-E-Mail zum DigitalTwin. " +
      "Falls der Link abgelaufen ist, fordere auf der Login-Seite einfach einen neuen an.",
  });
}
