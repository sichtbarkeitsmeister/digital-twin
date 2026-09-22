export function shouldNotifyPassflowLink(input: {
  previousUrl: string;
  nextUrl: string;
  alreadyNotified: boolean;
}): boolean {
  const next = input.nextUrl.trim();
  if (!next) return false;
  if (next !== input.previousUrl.trim()) return true;
  return !input.alreadyNotified;
}

export function buildPassflowNotifyEmail(input: {
  orgName: string;
  dashboardUrl: string;
}): { subject: string; text: string; html: string } {
  const orgName = input.orgName.trim() || "Organisation";
  const dashboardUrl = input.dashboardUrl.trim();
  return {
    subject: `Passflow-Link hinterlegt — ${orgName}`,
    text:
      `Für ${orgName} wurde ein Passflow-Link im Onboarding hinterlegt.\n\n` +
      `Bitte den Link zeitnah auf der Onboarding-Seite öffnen und die Zugänge übernehmen, ` +
      `bevor der Link abläuft.\n\n` +
      `Onboarding: ${dashboardUrl}\n\n` +
      `Der Passflow-Link selbst steht nicht in dieser E-Mail.\n`,
    html:
      `<p>Für <strong>${escapeHtml(orgName)}</strong> wurde ein Passflow-Link im Onboarding hinterlegt.</p>` +
      `<p>Bitte den Link zeitnah auf der Onboarding-Seite öffnen und die Zugänge übernehmen, bevor der Link abläuft.</p>` +
      `<p><a href="${escapeHtml(dashboardUrl)}">Onboarding öffnen</a></p>` +
      `<p>Der Passflow-Link selbst steht nicht in dieser E-Mail.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
