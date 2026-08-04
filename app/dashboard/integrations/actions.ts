"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/dashboard/org-context";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import {
  buildLeadinfoWebhookUrl,
  generateWebhookToken,
  LEADINFO_PROVIDER,
} from "@/lib/integrations/leadinfo";

export type IntegrationActionState = {
  ok: boolean;
  message: string;
  webhookUrl?: string;
};

const organisationIdSchema = z.object({
  organisation_id: z.string().uuid(),
});

const statusSchema = z.object({
  organisation_id: z.string().uuid(),
  status: z.enum(["enabled", "disabled"]),
});

async function requirePlatformAdmin() {
  const { supabase, userId } = await getAuthenticatedUserId();
  const allowed = await isPlatformAdmin(supabase, userId);
  if (!allowed) {
    return { ok: false as const, message: "Keine Berechtigung für Integrationen." };
  }
  return { ok: true as const, supabase, userId };
}

export async function generateLeadinfoIntegrationAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const parsed = organisationIdSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const access = await requirePlatformAdmin();
  if (!access.ok) {
    return { ok: false, message: access.message };
  }

  const { supabase, userId } = access;
  const token = generateWebhookToken();

  const { data, error } = await supabase
    .from("org_integrations")
    .upsert(
      {
        organisation_id: parsed.data.organisation_id,
        provider: LEADINFO_PROVIDER,
        status: "enabled",
        webhook_token: token,
        created_by_user_id: userId,
      },
      { onConflict: "organisation_id,provider" },
    )
    .select("webhook_token")
    .single();

  if (error || !data?.webhook_token) {
    return { ok: false, message: "Could not create Leadinfo integration." };
  }

  revalidateIntegrationPaths(parsed.data.organisation_id);
  return {
    ok: true,
    message: "Leadinfo webhook URL generated.",
    webhookUrl: buildLeadinfoWebhookUrl(data.webhook_token),
  };
}

export async function rotateLeadinfoTokenAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const parsed = organisationIdSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const access = await requirePlatformAdmin();
  if (!access.ok) {
    return { ok: false, message: access.message };
  }

  const { supabase } = access;
  const token = generateWebhookToken();

  const { data, error } = await supabase
    .from("org_integrations")
    .update({ webhook_token: token })
    .eq("organisation_id", parsed.data.organisation_id)
    .eq("provider", LEADINFO_PROVIDER)
    .select("webhook_token")
    .single();

  if (error || !data?.webhook_token) {
    return { ok: false, message: "Could not rotate webhook token." };
  }

  revalidateIntegrationPaths(parsed.data.organisation_id);
  return {
    ok: true,
    message: "Webhook token rotated. Update the URL in Leadinfo.",
    webhookUrl: buildLeadinfoWebhookUrl(data.webhook_token),
  };
}

export async function setLeadinfoStatusAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const parsed = statusSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const access = await requirePlatformAdmin();
  if (!access.ok) {
    return { ok: false, message: access.message };
  }

  const { supabase } = access;
  const { data, error } = await supabase
    .from("org_integrations")
    .update({ status: parsed.data.status })
    .eq("organisation_id", parsed.data.organisation_id)
    .eq("provider", LEADINFO_PROVIDER)
    .select("webhook_token, status")
    .single();

  if (error || !data) {
    return { ok: false, message: "Could not update integration status." };
  }

  revalidateIntegrationPaths(parsed.data.organisation_id);
  return {
    ok: true,
    message:
      parsed.data.status === "enabled"
        ? "Leadinfo integration enabled."
        : "Leadinfo integration disabled.",
    webhookUrl: data.webhook_token ? buildLeadinfoWebhookUrl(data.webhook_token) : undefined,
  };
}

function revalidateIntegrationPaths(organisationId: string) {
  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/integrations/leadinfo");
  revalidatePath("/dashboard/integrations/leadinfo/events");
  revalidatePath(`/dashboard/integrations/leadinfo?org=${organisationId}`);
  revalidatePath(`/dashboard/integrations/leadinfo/events?org=${organisationId}`);
}
