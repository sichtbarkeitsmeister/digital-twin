import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderOrgOwnerWelcomeEmail(opts: {
  organisationName: string;
  loginUrl: string;
  isNewAccount: boolean;
}) {
  const appBase = getAppBaseUrl();
  const intro = opts.isNewAccount
    ? `Hallo,\n\ndu wurdest als Inhaber von ${opts.organisationName} eingeladen. ` +
      "Wir haben dafür ein Konto für dich angelegt. " +
      "Mit dem Button unten nimmst du die Einladung an und landest direkt im DigitalTwin-Portal."
    : `Hallo,\n\ndu wurdest als Inhaber von ${opts.organisationName} eingeladen. ` +
      "Mit dem Button unten nimmst du die Einladung an und öffnest das DigitalTwin-Portal.";

  return renderBrandedEmail({
    title: `Einladung: Inhaber von ${opts.organisationName}`,
    eyebrow: "Einladung",
    preheader: `Einladung als Inhaber von ${opts.organisationName}`,
    headline: `Einladung: Inhaber von ${opts.organisationName}`,
    intro,
    details: [
      { label: "Organisation", value: opts.organisationName },
      { label: "Rolle", value: "Inhaber" },
      { label: "Portal", value: appBase },
      { label: "Art", value: "Einladung / Magic Link" },
    ],
    actions: [{ label: "Einladung annehmen", href: opts.loginUrl }],
    footerText:
      "Das ist eine Einladungs-E-Mail. Der Anmeldelink ist zeitlich begrenzt. " +
      "Falls er abgelaufen ist, fordere auf der Login-Seite einen neuen Link an. " +
      "Du erhältst diese E-Mail, weil du als Inhaber einer Organisation eingetragen wurdest.",
  });
}
