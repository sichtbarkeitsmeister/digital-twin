import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

export function renderOrgOwnerWelcomeEmail(opts: {
  organisationName: string;
  loginUrl: string;
  isNewAccount: boolean;
}) {
  const appBase = getAppBaseUrl();
  const intro = opts.isNewAccount
    ? `Hallo,\n\nwir haben ein Konto für dich angelegt und dich als Inhaber von ${opts.organisationName} eingetragen. ` +
      "Mit dem Button unten meldest du dich in einem Schritt an und landest direkt im DigitalTwin-Portal."
    : `Hallo,\n\ndu wurdest als Inhaber von ${opts.organisationName} eingetragen. ` +
      "Melde dich mit einem Klick an, um das DigitalTwin-Portal zu öffnen.";

  return renderBrandedEmail({
    title: `Inhaber von ${opts.organisationName}`,
    preheader: "Ein-Klick-Anmeldung zum DigitalTwin-Portal",
    headline: `Du bist jetzt Inhaber von ${opts.organisationName}`,
    intro,
    details: [
      { label: "Organisation", value: opts.organisationName },
      { label: "Rolle", value: "Inhaber" },
      { label: "Portal", value: appBase },
    ],
    actions: [{ label: "Jetzt anmelden", href: opts.loginUrl }],
    footerText:
      "Der Anmeldelink ist zeitlich begrenzt. Falls er abgelaufen ist, fordere auf der Login-Seite einen neuen Link an. " +
      "Du erhältst diese E-Mail, weil du als Inhaber einer Organisation hinterlegt wurdest.",
  });
}
