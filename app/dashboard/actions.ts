"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ensureMemberInviteLoginLink,
  formatMemberInviteEmailStatus,
  memberInviteEmailSucceeded,
  sendOrgMemberInviteEmail,
  sendSupabaseAuthInviteEmail,
} from "@/lib/email/member-invite";
import {
  ensureOwnerLoginLink,
  formatOwnerWelcomeEmailStatus,
  sendOrgOwnerWelcomeEmail,
} from "@/lib/email/owner-welcome";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionState = {
  ok: boolean;
  message: string;
  /** Set by member invite: true only when SMTP mail was actually sent. */
  emailSent?: boolean;
  /** Magic/invite link — shown when mail fails or for self-serve copy. */
  inviteLink?: string | null;
  /** True when the invited email is the current user and membership was added. */
  selfJoined?: boolean;
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

  const invitedEmail = parsed.data.invited_email;
  const selfInvite =
    Boolean(user?.email) && user!.email!.trim().toLowerCase() === invitedEmail;

  const { data: inviteIdRaw, error } = await supabase.rpc("invite_to_organisation", {
    org_id: parsed.data.organisation_id,
    invited_email: invitedEmail,
    role: parsed.data.role,
  });

  const resent = isDuplicateInviteError(error);
  if (error && !resent) {
    return { ok: false, message: `Einladung konnte nicht erstellt werden (${error.message}).` };
  }

  let inviteId =
    typeof inviteIdRaw === "string" && inviteIdRaw.trim() ? inviteIdRaw.trim() : null;

  if (!inviteId) {
    const { data: pending } = await supabase
      .from("organisation_invites")
      .select("id")
      .eq("organisation_id", parsed.data.organisation_id)
      .eq("email", invitedEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    inviteId = pending?.id ?? null;
  }

  // Self-invite: accept immediately — no email needed to join as yourself.
  if (selfInvite) {
    if (!inviteId) {
      return {
        ok: false,
        message:
          "Selbst-Einladung: Einladungs-ID fehlt. Bitte offene Einladung löschen und erneut versuchen.",
      };
    }
    const { error: acceptError } = await supabase.rpc("accept_organisation_invite", {
      invite_id: inviteId,
    });
    revalidatePath("/dashboard/organisations");
    revalidatePath(`/dashboard/organisations/${parsed.data.organisation_id}`);
    revalidatePath("/dashboard/inbox");
    if (acceptError) {
      return {
        ok: false,
        message:
          `Einladung erstellt, automatische Annahme fehlgeschlagen (${acceptError.message}). ` +
          "Bitte unter Posteingang manuell annehmen.",
      };
    }
    return {
      ok: true,
      emailSent: false,
      selfJoined: true,
      message:
        "Du hast dich selbst eingeladen — Mitgliedschaft ist aktiv. Keine E-Mail nötig.",
    };
  }

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", parsed.data.organisation_id)
    .maybeSingle();
  const organisationName = org?.name?.trim() || "euer DigitalTwin";

  const login = await ensureMemberInviteLoginLink(invitedEmail);
  const emailResult = login.ok
    ? await sendOrgMemberInviteEmail({
        email: invitedEmail,
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
  revalidatePath("/dashboard/admin/mails");

  const mailStatus = formatMemberInviteEmailStatus(
    emailResult,
    login.ok ? null : login.reason,
  );
  const prefix = resent ? "Offene Einladung erneut versendet. " : "";
  const brandedSent = memberInviteEmailSucceeded(emailResult);
  const inviteLink = login.ok ? login.link : null;

  if (brandedSent) {
    return {
      ok: true,
      emailSent: true,
      inviteLink,
      message: `${prefix}${mailStatus}`,
    };
  }

  // Own SMTP refused the branded mail — let Supabase's mailer deliver a plain
  // login link so the invitee is not blocked by our relay.
  const fallback = await sendSupabaseAuthInviteEmail({
    email: invitedEmail,
    organisationId: parsed.data.organisation_id,
    organisationName,
    role: parsed.data.role,
    isNewAccount: login.ok ? login.isNewAccount : true,
    triggeredByUserId: user?.id ?? null,
  });

  revalidatePath("/dashboard/admin/mails");

  if (fallback.ok) {
    return {
      ok: true,
      emailSent: true,
      inviteLink,
      message:
        `${prefix}${mailStatus} Ersatzweise wurde ein Anmeldelink über Supabase ` +
        `an ${invitedEmail} gesendet (Absender: noreply@mail.app.supabase.io).`,
    };
  }

  // Invite row is saved even when mail fails — keep modal open with copyable link.
  return {
    ok: false,
    emailSent: false,
    inviteLink,
    message:
      `${prefix}${mailStatus} Auch der Supabase-Versand schlug fehl ` +
      `(${fallback.reason}). Du kannst den Anmeldelink unten kopieren.`,
  };
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Nicht angemeldet." };
  }

  const { data: invite, error: inviteLoadError } = await supabase
    .from("organisation_invites")
    .select("id, organisation_id, org_role, status")
    .eq("id", parsed.data.invite_id)
    .maybeSingle();

  if (inviteLoadError || !invite) {
    return { ok: false, message: "Einladung nicht gefunden." };
  }
  if (invite.organisation_id !== parsed.data.organisation_id) {
    return { ok: false, message: "Einladung gehört nicht zu dieser Organisation." };
  }
  if (invite.status !== "pending") {
    return { ok: false, message: "Einladung ist nicht mehr offen." };
  }

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  const { data: roleData } = await supabase.rpc("my_org_role", {
    org_id: invite.organisation_id,
  });
  const myRole = typeof roleData === "string" ? roleData : null;
  const allowed =
    platformAdmin ||
    myRole === "owner" ||
    (myRole === "admin" && invite.org_role === "employee");
  if (!allowed) {
    return { ok: false, message: "Keine Berechtigung zum Löschen dieser Einladung." };
  }

  // Preferred path: DB RPC (migration 20260731_revoke_organisation_invite.sql).
  const { error: rpcError } = await supabase.rpc("revoke_organisation_invite", {
    invite_id: parsed.data.invite_id,
  });

  if (rpcError) {
    // Fallback if migration is not applied yet on Supabase (common cause of delete failures).
    console.warn("[revoke invite] RPC failed, service-role fallback:", rpcError.message);
    try {
      const service = createServiceClient();
      const { data: updated, error: updateError } = await service
        .from("organisation_invites")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
        })
        .eq("id", parsed.data.invite_id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError || !updated) {
        return {
          ok: false,
          message:
            "Einladung konnte nicht gelöscht werden. Bitte SQL-Migration " +
            "`revoke_organisation_invite` in Supabase ausführen.",
        };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : rpcError.message;
      return {
        ok: false,
        message: `Einladung konnte nicht gelöscht werden (${reason}).`,
      };
    }
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

