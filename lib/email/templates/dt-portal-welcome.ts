import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderDtPortalWelcomeEmail(opts: {
  organisationName: string;
  loginUrl: string;
}) {
  const appBase = getAppBaseUrl();
  return renderBrandedEmail({
    title: `Einladung: DigitalTwin-Portal für ${opts.organisationName}`,
    eyebrow: "Einladung",
    preheader: `Einladung zum DigitalTwin-Portal für ${opts.organisationName}`,
    headline: `Einladung zum DigitalTwin-Portal`,
    intro:
      `Hallo,\n\ndu wurdest zum DigitalTwin-Portal für ${opts.organisationName} eingeladen. ` +
      "Das Portal ist unter digital-twin-sbkm.de erreichbar. " +
      "Mit dem Button unten nimmst du die Einladung an und meldest dich direkt an.",
    details: [
      { label: "Organisation", value: opts.organisationName },
      { label: "Portal", value: appBase },
      { label: "Art", value: "Einladung / Magic Link" },
    ],
    actions: [
      { label: "Einladung annehmen", href: opts.loginUrl },
      { label: "Portal öffnen", href: appBase },
    ],
    footerText:
      "Das ist eine Einladungs-E-Mail zum DigitalTwin-Portal. " +
      "Du erhältst sie, weil deine Adresse für diese Organisation hinterlegt wurde. " +
      "Der Link ist zeitlich begrenzt — bei Bedarf kannst du auf der Login-Seite einen neuen anfordern.",
  });
}
