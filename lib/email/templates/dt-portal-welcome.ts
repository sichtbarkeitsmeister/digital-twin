import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderDtPortalWelcomeEmail(opts: {
  organisationName: string;
  loginUrl: string;
}) {
  const appBase = getAppBaseUrl();
  return renderBrandedEmail({
    title: "Dein DigitalTwin-Portal ist umgezogen",
    preheader: "Anmeldung zum neuen DigitalTwin-Portal",
    headline: "Dein DigitalTwin-Portal ist umgezogen",
    intro:
      `Hallo,\n\nfür ${opts.organisationName} ist das DigitalTwin-Portal jetzt unter digital-twin-sbkm.de erreichbar. ` +
      "Deine bisherigen Chats und SEO-Daten werden migriert — melde dich einmal mit dem Button unten an.",
    details: [
      { label: "Organisation", value: opts.organisationName },
      { label: "Portal", value: appBase },
    ],
    actions: [
      { label: "Zum Portal anmelden", href: opts.loginUrl },
      { label: "DigitalTwin öffnen", href: appBase },
    ],
    footerText:
      "Du erhältst diese E-Mail, weil deine Adresse für das DigitalTwin-Portal hinterlegt ist.",
  });
}
