"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ensureMemberInviteLoginLink,
  formatMemberInviteEmailStatus,
  sendOrgMemberInviteEmail,
} from "@/lib/email/member-invite";
import {
  ensureOwnerLoginLink,
  formatOwnerWelcomeEmailStatus,
  sendOrgOwnerWelcomeEmail,
} from "@/lib/email/owner-welcome";
import { revokeOrganisationInvite } from "@/lib/dashboard/revoke-org-invite";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionState = {
  ok: boolean;
  message: string;
};

const checkboxOnSchema = z.preprocess(
  (v) => v === "on" || v === "true" || v === true,
  z.boolean(),
);

const adminCreateOrganisationSchema = z.object({
  org_name: z.string().trim().min(2, "Organisationsname ist erforderlich"),
  owner_email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte eine gültige E-Mail-Adresse eingeben"),
  org_slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug: nur a-z, 0-9 und Bindestriche")
    .min(2, "Slug ist zu kurz")
    .max(64, "Slug ist zu lang")
    .optional()
    .or(z.literal("")),
  send_welcome: checkboxOnSchema.default(true),
});

export async function adminCreateOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adminCreateOrganisationSchema.safeParse({
    org_name: formData.get("org_name"),
    owner_email: formData.get("owner_email"),
    org_slug: formData.get("org_slug"),
    send_welcome: formData.get("send_welcome"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const { org_name, owner_email, org_slug, send_welcome } = parsed.data;

  let loginLink: Awaited<ReturnType<typeof ensureOwnerLoginLink>> = null;
  if (send_welcome) {
    loginLink = await ensureOwnerLoginLink(owner_email);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.rpc("admin_create_organisation", {
    org_name,
    owner_email,
    org_slug: org_slug ? org_slug : null,
  });

  if (error) {
    return { ok: false, message: "Organisation konnte nicht erstellt werden." };
  }

  let emailStatus: ReturnType<typeof formatOwnerWelcomeEmailStatus> = null;
  if (send_welcome && loginLink) {
    const emailResult = await sendOrgOwnerWelcomeEmail({
      email: owner_email,
      organisationName: org_name,
      link: loginLink.link,
      isNewAccount: loginLink.isNewAccount,
      triggeredByUserId: user?.id ?? null,
    });
    emailStatus = formatOwnerWelcomeEmailStatus(emailResult, send_welcome);
  } else if (send_welcome) {
    emailStatus = formatOwnerWelcomeEmailStatus(null, send_welcome);
  }

  revalidatePath("/dashboard/admin/organisations");
  revalidatePath("/dashboard/admin/mails");
  revalidatePath("/dashboard/organisations");
  const baseMessage = "Organisation wurde angelegt.";
  return {
    ok: true,
    message: emailStatus ? `${baseMessage} ${emailStatus}` : baseMessage,
  };
}

const inviteSchema = z.object({
  organisation_id: z.string().uuid(),
  invited_email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "employee"]),
});

function isDuplicateInviteError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  const code = error.code ?? "";
  return (
    code === "23505" ||
    msg.includes("duplicate") ||
    msg.includes("unique") ||
    msg.includes("organisation_invites_pending_unique")
  );
}

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
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.rpc("invite_to_organisation", {
    org_id: parsed.data.organisation_id,
    invited_email: parsed.data.invited_email,
    role: parsed.data.role,
  });

  const resent = isDuplicateInviteError(error);
  if (error && !resent) {
    return { ok: false, message: "Einladung konnte nicht erstellt werden." };
  }

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", parsed.data.organisation_id)
    .maybeSingle();
  const organisationName = org?.name?.trim() || "euer DigitalTwin";

  const login = await ensureMemberInviteLoginLink(parsed.data.invited_email);
  const emailResult = login
    ? await sendOrgMemberInviteEmail({
        email: parsed.data.invited_email,
        organisationName,
        organisationId: parsed.data.organisation_id,
        role: parsed.data.role,
        link: login.link,
        isNewAccount: login.isNewAccount,
        triggeredByUserId: user?.id ?? null,
      })
    : null;

  revalidatePath("/dashboard/organisations");
  revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
  revalidatePath("/dashboard/inbox");

  const mailStatus = formatMemberInviteEmailStatus(emailResult);
  const prefix = resent ? "Offene Einladung erneut versendet. " : "";
  return { ok: true, message: `${prefix}${mailStatus}` };
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

  revalidatePath("/dashboard/organisations");
  return { ok: true, message: "Member removed." };
}

const revokeInviteSchema = z.object({
  invite_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
});

export async function revokeOrganisationInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = revokeInviteSchema.safeParse({
    invite_id: formData.get("invite_id"),
    organisation_id: formData.get("organisation_id"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe",
    };
  }

  const result = await revokeOrganisationInvite({
    inviteId: parsed.data.invite_id,
    organisationId: parsed.data.organisation_id,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/organisations");
  revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
  revalidatePath("/dashboard/inbox");
  return { ok: true, message: "Einladung gelöscht. Du kannst die Person erneut einladen." };
}

const transferSchema = z.object({
  organisation_id: z.string().uuid(),
  new_owner_email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte eine gültige E-Mail-Adresse eingeben."),
  send_welcome: checkboxOnSchema.default(true),
});

export async function transferOwnershipAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transferSchema.safeParse({
    organisation_id: formData.get("organisation_id"),
    new_owner_email: formData.get("new_owner_email"),
    send_welcome: formData.get("send_welcome"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, message: "Nicht angemeldet." };
  }

  const service = createServiceClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, email")
    .eq("email", parsed.data.new_owner_email)
    .maybeSingle();

  if (profileError) {
    return { ok: false, message: "E-Mail konnte nicht geprüft werden." };
  }

  if (!profile?.id) {
    return {
      ok: false,
      message:
        "Kein Konto mit dieser E-Mail gefunden. Die Person muss sich zuerst registrieren.",
    };
  }

  if (profile.id === user.id) {
    return { ok: false, message: "Du bist bereits Inhaber dieser Organisation." };
  }

  const { error } = await supabase.rpc("transfer_organisation_ownership", {
    org_id: parsed.data.organisation_id,
    new_owner_user_id: profile.id,
  });

  if (error) {
    return { ok: false, message: "Ownership konnte nicht übertragen werden." };
  }

  const { data: orgRow } = await service
    .from("organisations")
    .select("name")
    .eq("id", parsed.data.organisation_id)
    .maybeSingle();

  const organisationName = orgRow?.name?.trim() || "deine Organisation";
  const send_welcome = parsed.data.send_welcome;

  let emailStatus: ReturnType<typeof formatOwnerWelcomeEmailStatus> = null;
  if (send_welcome) {
    const loginLink = await ensureOwnerLoginLink(parsed.data.new_owner_email);
    if (loginLink) {
      const emailResult = await sendOrgOwnerWelcomeEmail({
        email: parsed.data.new_owner_email,
        organisationName,
        link: loginLink.link,
        isNewAccount: loginLink.isNewAccount,
        triggeredByUserId: user.id,
        organisationId: parsed.data.organisation_id,
      });
      emailStatus = formatOwnerWelcomeEmailStatus(emailResult, send_welcome);
    } else {
      emailStatus = formatOwnerWelcomeEmailStatus(null, send_welcome);
    }
  }

  revalidatePath("/dashboard/organisations");
  revalidatePath("/dashboard/admin/mails");
  const baseMessage = `Ownership wurde an ${profile.email ?? parsed.data.new_owner_email} übertragen.`;
  return {
    ok: true,
    message: emailStatus ? `${baseMessage} ${emailStatus}` : baseMessage,
  };
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

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/organisations");
}

