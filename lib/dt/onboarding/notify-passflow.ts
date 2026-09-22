import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl } from "@/lib/app-url";
import {
  DT_ONBOARDING_SUPPORT_EMAIL,
  onboardingDashboardPath,
} from "@/lib/dt/onboarding/copy";
import { buildPassflowNotifyEmail } from "@/lib/dt/onboarding/passflow";
import { sendEmail } from "@/lib/email/mailer";

async function resolveOrgName(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<string> {
  const { data: cfg } = await supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  const fromConfig = cfg?.display_name?.trim();
  if (fromConfig) return fromConfig;

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", organisationId)
    .maybeSingle();
  return org?.name?.trim() || "Organisation";
}

/** Best-effort: a mail failure must never block saving the onboarding record. */
export async function notifyPassflowLinkDeposited(input: {
  supabase: SupabaseClient;
  organisationId: string;
  userId?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const orgName = await resolveOrgName(input.supabase, input.organisationId);
  const dashboardUrl = `${getAppBaseUrl()}${onboardingDashboardPath(input.organisationId)}`;
  const mail = buildPassflowNotifyEmail({ orgName, dashboardUrl });

  try {
    await sendEmail({
      to: [DT_ONBOARDING_SUPPORT_EMAIL],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      context: {
        kind: "dt_onboarding_passflow",
        organisationId: input.organisationId,
        triggeredByUserId: input.userId ?? null,
        metadata: { orgName },
      },
    });
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen.";
    console.error("[onboarding] passflow notify:", reason);
    return { sent: false, reason };
  }
}
