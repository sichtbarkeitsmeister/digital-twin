import { getAppBaseUrl } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";

function formatRole(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "employee") return "Mitarbeiter";
  if (role === "owner") return "Inhaber";
  return role;
}

export function renderOrgMemberInviteEmail(opts: {
  organisationName: string;
  loginUrl: string;
  role: string;
  isNewAccount: boolean;
}) {
  const appBase = getAppBaseUrl();
  const roleLabel = formatRole(opts.role);
  const intro = opts.isNewAccount
    ? `Hallo,\n\ndu wurdest zu ${opts.organisationName} im DigitalTwin-Portal eingeladen (Rolle: ${roleLabel}). ` +
      "Wir haben dafür ein Konto für dich angelegt. " +
      "Mit dem Button unten nimmst du die Einladung an und landest im Portal — dort kannst du die Einladung bestätigen."
    : `Hallo,\n\ndu wurdest zu ${opts.organisationName} im DigitalTwin-Portal eingeladen (Rolle: ${roleLabel}). ` +
      "Mit dem Button unten meldest du dich an und kannst die Einladung im Posteingang annehmen.";

  return renderBrandedEmail({
    title: `Einladung zu ${opts.organisationName}`,
    eyebrow: "Einladung",
    preheader: `Einladung zu ${opts.organisationName} (DigitalTwin)`,
    headline: `Einladung zu ${opts.organisationName}`,
    intro,
    details: [
      { label: "Organisation", value: opts.organisationName },
      { label: "Rolle", value: roleLabel },
      { label: "Portal", value: appBase },
      { label: "Art", value: "Einladung / Magic Link" },
    ],
    actions: [{ label: "Einladung annehmen", href: opts.loginUrl }],
    footerText:
      "Das ist eine Einladungs-E-Mail zum DigitalTwin-Portal. " +
      "Der Anmeldelink ist zeitlich begrenzt. Falls er abgelaufen ist, fordere auf der Login-Seite einen neuen Link an. " +
      "Du erhältst diese E-Mail, weil jemand dich zu einer Organisation eingeladen hat.",
  });
}
