import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderStaffMagicLinkEmail(opts: { loginUrl: string }) {
  const appBase = getAppBaseUrl();
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
