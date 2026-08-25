"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAppBaseUrl, sendEmail, verifySmtpConnection } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";

export type MailActionState = {
  ok: boolean;
  message: string;
};

const testEmailSchema = z.object({
  recipient_email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte eine gültige E-Mail-Adresse eingeben"),
  subject: z.string().trim().max(200).optional(),
});

export async function sendTestEmailAction(
  _prev: MailActionState,
  formData: FormData,
): Promise<MailActionState> {
  const parsed = testEmailSchema.safeParse({
    recipient_email: formData.get("recipient_email"),
    subject: formData.get("subject"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, message: "Nicht angemeldet." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { ok: false, message: "Nur Plattform-Admins dürfen Test-E-Mails senden." };
  }

  const recipient = parsed.data.recipient_email;
  const subject = parsed.data.subject?.trim() || "SBKM Test-E-Mail";
  const sentAt = new Date().toISOString();
  const appBaseUrl = getAppBaseUrl();
  const text = [
    "Dies ist eine Test-E-Mail aus dem SBKM Dashboard.",
    "",
    `Gesendet am: ${sentAt}`,
    `App-URL: ${appBaseUrl}`,
    `Ausgelöst von: ${profile.email ?? user.id}`,
    "",
    "Wenn du diese Nachricht erhältst, ist die SMTP-Konfiguration grundsätzlich in Ordnung.",
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <p>Dies ist eine <strong>Test-E-Mail</strong> aus dem SBKM Dashboard.</p>
      <ul>
        <li><strong>Gesendet am:</strong> ${sentAt}</li>
        <li><strong>App-URL:</strong> ${appBaseUrl}</li>
        <li><strong>Ausgelöst von:</strong> ${profile.email ?? user.id}</li>
      </ul>
      <p>Wenn du diese Nachricht erhältst, ist die SMTP-Konfiguration grundsätzlich in Ordnung.</p>
    </div>
  `;

  try {
    const probe = await verifySmtpConnection();
    if (!probe.ok) {
      revalidatePath("/dashboard/admin/mails");
      return {
        ok: false,
        message: `SMTP-Login fehlgeschlagen: ${probe.reason}`,
      };
    }

    const result = await sendEmail({
      to: [recipient],
      subject,
      text,
      html,
      context: {
        kind: "test",
        metadata: { triggeredByEmail: profile.email ?? null },
        triggeredByUserId: user.id,
      },
    });

    revalidatePath("/dashboard/admin/mails");

    if (result.skipped) {
      return { ok: false, message: "Versand übersprungen (kein Empfänger)." };
    }

    return {
      ok: true,
      message: `Test-E-Mail wurde an ${recipient} gesendet.`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen";
    revalidatePath("/dashboard/admin/mails");
    return { ok: false, message: `Versand fehlgeschlagen: ${reason}` };
  }
}
