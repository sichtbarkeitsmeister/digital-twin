"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ActionState = {
  ok: boolean;
  message: string;
};

const adminCreateOrganisationSchema = z.object({
  org_name: z.string().trim().min(2, "Organisation name is required"),
  owner_email: z.string().trim().toLowerCase().email("Invalid owner email"),
  org_slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug can only contain a-z, 0-9 and hyphens")
    .min(2, "Slug is too short")
    .max(64, "Slug is too long")
    .optional()
    .or(z.literal("")),
});

export async function adminCreateOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adminCreateOrganisationSchema.safeParse({
    org_name: formData.get("org_name"),
    owner_email: formData.get("owner_email"),
    org_slug: formData.get("org_slug"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { org_name, owner_email, org_slug } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_organisation", {
    org_name,
    owner_email,
    org_slug: org_slug ? org_slug : null,
  });

  if (error) {
    return { ok: false, message: "Could not create organisation." };
  }

  revalidatePath("/dashboard");
  return { ok: true, message: "Organisation created." };
}

const inviteSchema = z.object({
  organisation_id: z.string().uuid(),
  invited_email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "employee"]),
});

export async function inviteToOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
    invited_email: formData.get("invited_email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_to_organisation", {
    org_id: parsed.data.organisation_id,
    invited_email: parsed.data.invited_email,
    role: parsed.data.role,
  });

  if (error) {
    return { ok: false, message: "Could not invite user." };
  }

  revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
  return { ok: true, message: "Invite sent." };
}

const kickSchema = z.object({
  organisation_id: z.string().uuid(),
  target_user_id: z.string().uuid(),
});

export async function kickFromOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = kickSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
    target_user_id: formData.get("target_user_id"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("kick_from_organisation", {
    org_id: parsed.data.organisation_id,
    target_user_id: parsed.data.target_user_id,
  });

  if (error) {
    return { ok: false, message: "Could not remove member." };
  }

  revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
  return { ok: true, message: "Member removed." };
}

const transferSchema = z.object({
  organisation_id: z.string().uuid(),
  new_owner_user_id: z.string().uuid(),
});

export async function transferOwnershipAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transferSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
    new_owner_user_id: formData.get("new_owner_user_id"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_organisation_ownership", {
    org_id: parsed.data.organisation_id,
    new_owner_user_id: parsed.data.new_owner_user_id,
  });

  if (error) {
    return { ok: false, message: "Could not transfer ownership." };
  }

  revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
  return { ok: true, message: "Ownership transferred." };
}

const acceptInviteSchema = z.object({
  invite_id: z.string().uuid(),
});

export async function acceptOrganisationInviteAction(formData: FormData) {
  const parsed = acceptInviteSchema.safeParse({
    invite_id: formData.get("invite_id"),
  });

  if (!parsed.success) {
    return;
  }

  const supabase = await createClient();
  await supabase.rpc("accept_organisation_invite", {
    invite_id: parsed.data.invite_id,
  });

  revalidatePath("/dashboard");
}

