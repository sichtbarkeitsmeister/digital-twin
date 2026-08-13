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
import { resolveOrganisationSlug } from "@/lib/dt/org-slug";
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
  org_slug: z.preprocess(
    (v) => {
      if (v == null) return "";
      return String(v).trim().toLowerCase();
    },
    z.union([
      z.literal(""),
      z
        .string()
        .regex(/^[a-z0-9-]+$/, "Slug: nur a-z, 0-9 und Bindestriche")
        .min(2, "Slug ist zu kurz")
        .max(64, "Slug ist zu lang"),
    ]),
  ),
  send_welcome: checkboxOnSchema.default(true),
});

function mapAdminCreateOrganisationError(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}): string {
  const raw = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (raw.includes("forbidden") || raw.includes("not_authenticated")) {
    return "Keine Berechtigung: Organisation anlegen ist nur für Plattform-Admins möglich.";
  }
  if (raw.includes("invalid_email")) {
    return "Die E-Mail-Adresse des Inhabers ist ungültig.";
  }
  if (raw.includes("invalid_slug") || raw.includes("slug_collision")) {
    return "Der Slug ist ungültig oder bereits vergeben. Bitte einen anderen Slug wählen oder leer lassen.";
  }
  if (
    code === "23505" ||
    raw.includes("duplicate") ||
    raw.includes("unique") ||
    raw.includes("organisations_slug")
  ) {
    return "Dieser Organisations-Slug existiert bereits. Bitte einen anderen Slug wählen oder leer lassen.";
  }
  if (
    raw.includes("allocate_unique") ||
    raw.includes("slugify_organisation") ||
    (raw.includes("function") && raw.includes("does not exist")) ||
    raw.includes("could not find the function") ||
    raw.includes("schema cache")
  ) {
    return "Datenbank-Funktion für Organisation anlegen fehlt oder ist veraltet. Bitte Migration 20260813_fix_admin_create_organisation_rls.sql (bzw. 20260805_org_slug_autofill.sql) in Supabase ausführen.";
  }

  // Keep a short technical hint so ops can fix without digging into server logs.
  const short = [error.message, error.details, error.code]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" — ");
  if (short && short.length < 220 && !short.includes("\n")) {
    return `Organisation konnte nicht erstellt werden: ${short}`;
  }
  return "Organisation konnte nicht erstellt werden. Bitte später erneut versuchen.";
}

export async function adminCreateOrganisationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
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

    // Slug is required for SEO/n8n client routing — auto-fill from name when omitted.
    const resolvedSlug = resolveOrganisationSlug({ slug: org_slug, name: org_name });
    if (!resolvedSlug) {
      return {
        ok: false,
        message:
          "Slug konnte nicht aus dem Organisationsnamen erzeugt werden. Bitte Slug manuell setzen.",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      return { ok: false, message: "Nicht angemeldet." };
    }
    if (!(await isPlatformAdmin(supabase, user.id))) {
      return {
        ok: false,
        message:
          "Keine Berechtigung: Organisation anlegen ist nur für Plattform-Admins möglich.",
      };
    }

    // Create the organisation first. Welcome-mail setup must never block creation
    // (service-role / Auth-link failures previously aborted the whole action).
    const { data: createdOrgId, error } = await supabase.rpc(
      "admin_create_organisation",
      {
        org_name,
        owner_email,
        org_slug: resolvedSlug,
      },
    );

    if (error) {
      console.warn(
        "[admin] admin_create_organisation failed:",
        error.message,
        error.details,
        error.code,
        error.hint,
      );
      return { ok: false, message: mapAdminCreateOrganisationError(error) };
    }
    if (!createdOrgId) {
      return {
        ok: false,
        message:
          "Organisation konnte nicht erstellt werden (keine ID von der Datenbank).",
      };
    }

    let emailStatus: ReturnType<typeof formatOwnerWelcomeEmailStatus> = null;
    if (send_welcome) {
      try {
        let loginLink: Awaited<ReturnType<typeof ensureOwnerLoginLink>> = null;
        try {
          loginLink = await ensureOwnerLoginLink(owner_email);
        } catch (err) {
          console.warn(
            "[admin] ensureOwnerLoginLink failed after org create:",
            err instanceof Error ? err.message : err,
          );
        }

        if (loginLink) {
          const emailResult = await sendOrgOwnerWelcomeEmail({
            email: owner_email,
            organisationName: org_name,
            link: loginLink.link,
            isNewAccount: loginLink.isNewAccount,
            triggeredByUserId: user.id,
            organisationId: String(createdOrgId),
          });
          emailStatus = formatOwnerWelcomeEmailStatus(emailResult, send_welcome);
        } else {
          emailStatus = formatOwnerWelcomeEmailStatus(null, send_welcome);
        }
      } catch (err) {
        console.warn(
          "[admin] welcome email failed after org create:",
          err instanceof Error ? err.message : err,
        );
        emailStatus =
          "Organisation ist angelegt, Einladungs-E-Mail konnte nicht gesendet werden.";
      }
    }

    revalidatePath("/dashboard/admin/organisations");
    revalidatePath("/dashboard/admin/mails");
    revalidatePath("/dashboard/organisations");
    const baseMessage = "Organisation wurde angelegt.";
    return {
      ok: true,
      message: emailStatus ? `${baseMessage} ${emailStatus}` : baseMessage,
    };
  } catch (err) {
    console.warn(
      "[admin] adminCreateOrganisationAction crashed:",
      err instanceof Error ? err.message : err,
    );
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY") || msg.includes("NEXT_PUBLIC_SUPABASE_URL")) {
      return {
        ok: false,
        message:
          "Server-Konfiguration unvollständig (Supabase Service Role). Organisation konnte nicht vorbereitet werden.",
      };
    }
    return {
      ok: false,
      message: "Organisation konnte nicht erstellt werden. Bitte später erneut versuchen.",
    };
  }
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
    console.warn("[invite] invite_to_organisation failed:", error.message);
    return {
      ok: false,
      message:
        error.message === "forbidden"
          ? "Du darfst für diese Organisation niemanden einladen."
          : "Einladung konnte nicht erstellt werden. Bitte später erneut versuchen.",
    };
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
      console.warn("[invite] self-accept failed:", acceptError.message);
      return {
        ok: false,
        message:
          "Einladung erstellt, konnte aber nicht automatisch angenommen werden. " +
          "Bitte im Posteingang manuell annehmen.",
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

  const platformAdmin = user ? await isPlatformAdmin(supabase, user.id) : false;
  const mailStatus = formatMemberInviteEmailStatus(
    emailResult,
    login.ok ? null : login.reason,
    platformAdmin,
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
      message: platformAdmin
        ? `${prefix}${mailStatus} Ersatzweise wurde ein Anmeldelink über Supabase ` +
          `an ${invitedEmail} gesendet (Absender: noreply@mail.app.supabase.io).`
        : `${prefix}Einladung an ${invitedEmail} gesendet. ` +
          "Die E-Mail kann im Spam-Ordner landen.",
    };
  }

  // Invite row is saved even when mail fails — keep modal open with copyable link.
  return {
    ok: false,
    emailSent: false,
    inviteLink,
    message: platformAdmin
      ? `${prefix}${mailStatus} Auch der Ersatzversand schlug fehl ` +
        `(${fallback.reason}). Du kannst den Anmeldelink unten kopieren.`
      : `${prefix}${mailStatus} Du kannst den Anmeldelink unten kopieren und ` +
        "direkt weitergeben.",
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
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("kick_from_organisation", {
    org_id: parsed.data.organisation_id,
    target_user_id: parsed.data.target_user_id,
  });

  if (error) {
    return { ok: false, message: "Mitglied konnte nicht entfernt werden." };
  }

  revalidatePath("/dashboard/organisations");
  return { ok: true, message: "Mitglied entfernt." };
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
        console.warn(
          "[revoke invite] service-role fallback failed:",
          updateError?.message ?? "no row updated",
        );
        return {
          ok: false,
          message: "Einladung konnte nicht gelöscht werden. Bitte später erneut versuchen.",
        };
      }
    } catch (err) {
      console.warn(
        "[revoke invite] service-role fallback threw:",
        err instanceof Error ? err.message : rpcError.message,
      );
      return {
        ok: false,
        message: "Einladung konnte nicht gelöscht werden. Bitte später erneut versuchen.",
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

