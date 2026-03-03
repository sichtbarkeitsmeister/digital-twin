export type EmailDetailRow = { label: string; value: string };
export type EmailAction = { label: string; href: string };

export function escapeHtml(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderBrandedEmail(opts: {
  title: string;
  headline: string;
  intro?: string;
  details?: EmailDetailRow[];
  actions?: EmailAction[];
  footerText?: string;
  preheader?: string;
}) {
  const preheader = (opts.preheader ?? "").trim();
  const intro = (opts.intro ?? "").trim();
  const details = (opts.details ?? []).filter((r) => r.label.trim() && r.value.trim());
  const actions = (opts.actions ?? []).filter((a) => a.label.trim() && a.href.trim());
  const footerText =
    (opts.footerText ?? "Du erhältst diese Nachricht, weil du als Empfänger für Benachrichtigungen hinterlegt bist.")
      .trim();

  // DESIGN_GUIDE.md colors
  const deepIndigo = "#2E2E50";
  const mint = "#64FDC2";

  const cardBg = "#34345b";
  const textPrimary = "#F5F6FF";
  const textSecondary = "#C7C9E4";
  const borderSubtle = "rgba(255,255,255,0.10)";

  const radiusCard = "18px";
  const radiusButton = "14px";

  const html = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${deepIndigo};">
    ${
      preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
        : ""
    }
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${deepIndigo};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;">
            <tr>
              <td style="padding:0 0 14px 0;">
                <div style="font-family:Poppins,Arial,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${textSecondary};font-weight:600;">
                  Benachrichtigung
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:${cardBg};border:1px solid ${borderSubtle};border-radius:${radiusCard};padding:22px;">
                <div style="font-family:Poppins,Arial,sans-serif;color:${textPrimary};">
                  <div style="font-size:22px;line-height:1.25;font-weight:700;margin:0 0 10px 0;">
                    ${escapeHtml(opts.headline)}
                  </div>
                  ${
                    intro
                      ? `<div style="font-size:14px;line-height:1.5;color:${textSecondary};margin:0 0 16px 0;">
                          ${escapeHtml(intro)}
                        </div>`
                      : ""
                  }

                  ${
                    details.length
                      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px 0;">
                          ${details
                            .map(
                              (row) => `
                            <tr>
                              <td style="padding:10px 0;border-top:1px solid ${borderSubtle};">
                                <div style="font-size:12px;color:${textSecondary};font-weight:600;margin:0 0 4px 0;">
                                  ${escapeHtml(row.label)}
                                </div>
                                <div style="font-size:14px;color:${textPrimary};line-height:1.45;">
                                  ${escapeHtml(row.value)}
                                </div>
                              </td>
                            </tr>`,
                            )
                            .join("")}
                        </table>`
                      : ""
                  }

                  ${
                    actions.length
                      ? `<div style="margin:0 0 6px 0;">
                          ${actions
                            .map(
                              (a) => `
                            <a href="${escapeHtml(a.href)}"
                               style="display:inline-block;background:${mint};color:${deepIndigo};text-decoration:none;font-family:Poppins,Arial,sans-serif;font-weight:700;font-size:14px;line-height:1;padding:12px 14px;border-radius:${radiusButton};margin:0 10px 10px 0;">
                              ${escapeHtml(a.label)}
                            </a>`,
                            )
                            .join("")}
                        </div>`
                      : ""
                  }

                  <div style="font-size:12px;line-height:1.5;color:${textSecondary};margin-top:10px;">
                    ${escapeHtml(footerText)}
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 2px 0 2px;">
                <div style="font-family:Poppins,Arial,sans-serif;font-size:11px;line-height:1.5;color:${textSecondary};opacity:0.9;">
                  Tipp: Falls ein Button nicht klickbar ist, kopiere den Link aus der Nachricht in deinen Browser.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return html;
}

