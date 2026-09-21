import { isForeignKeyRestrictError } from "@/lib/dashboard/auth-user-errors";
import {
  createConfirmedUser,
  ensureAdminProfile,
  findAuthUserIdByEmail,
  findProfileByEmail,
  unbanAndConfirmUser,
} from "@/lib/auth/ensure-auth-user";
import { loginUrlFromGenerateLink } from "@/lib/auth/login-link";
import { getAppBaseUrl } from "@/lib/email/mailer";
import { createServiceClient } from "@/lib/supabase/service";

export type GrantPlatformAdminResult = {
  ok: boolean;
  message: string;
  inviteLink?: string | null;
};

type ServiceClient = ReturnType<typeof createServiceClient>;

async function generateLoginLink(service: ServiceClient, email: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    console.warn("[admin] magiclink after grant failed:", error.message);
    return null;
  }
  return loginUrlFromGenerateLink(getAppBaseUrl(), data.properties, {
    type: "magiclink",
    next: "/dashboard",
  });
}

async function reassignCreatedBy(service: ServiceClient, fromUserId: string, toUserId: string) {
  const updates: Array<PromiseLike<unknown>> = [
    service.from("organisations").update({ created_by_user_id: toUserId }).eq("created_by_user_id", fromUserId),
    service.from("organisation_members").update({ created_by_user_id: toUserId }).eq("created_by_user_id", fromUserId),
    service.from("organisation_invites").update({ invited_by_user_id: toUserId }).eq("invited_by_user_id", fromUserId),
    service.from("survey_folders").update({ created_by_user_id: toUserId }).eq("created_by_user_id", fromUserId),
    service.from("surveys").update({ created_by_user_id: toUserId }).eq("created_by_user_id", fromUserId),
  ];
  await Promise.all(updates);
}

async function deleteAuthUserCompletely(
  service: ServiceClient,
  userId: string,
  actorUserId: string,
): Promise<{ deleted: boolean; warning?: string }> {
  await reassignCreatedBy(service, userId, actorUserId);

  const { error } = await service.auth.admin.deleteUser(userId, false);
  if (!error) return { deleted: true };

  if (isForeignKeyRestrictError(error.message)) {
    return {
      deleted: false,
      warning: `Konto konnte nicht gelöscht werden (${error.message}). Admin-Rolle und Anmeldelink werden trotzdem gesetzt.`,
    };
  }

  throw new Error(`Konto konnte nicht gelöscht werden: ${error.message}`);
}

export async function grantPlatformAdminRole(input: {
  email: string;
  makeAdmin: boolean;
  actorUserId: string;
  reinvite?: boolean;
}): Promise<GrantPlatformAdminResult> {
  const email = input.email.trim().toLowerCase();
  const service = createServiceClient();

  if (input.reinvite) {
    if (!input.makeAdmin) {
      return { ok: false, message: "Neu einladen setzt immer die Admin-Ansicht." };
    }

    const existingId =
      (await findProfileByEmail(service, email))?.id ?? (await findAuthUserIdByEmail(service, email));

    if (existingId && existingId === input.actorUserId) {
      return { ok: false, message: "Du kannst dein eigenes Konto nicht löschen und neu einladen." };
    }

    let deleted = false;
    let warning: string | undefined;
    if (existingId) {
      const result = await deleteAuthUserCompletely(service, existingId, input.actorUserId);
      deleted = result.deleted;
      warning = result.warning;
    }

    const userId = deleted || !existingId ? await createConfirmedUser(service, email) : existingId;
    if (!deleted && existingId) {
      await unbanAndConfirmUser(service, existingId);
    }

    await ensureAdminProfile(service, userId, email);
    const inviteLink = await generateLoginLink(service, email);

    return {
      ok: true,
      inviteLink,
      message: [
        `${email} ist neu eingeladen und hat die Admin-Ansicht.`,
        warning,
        inviteLink
          ? "Bitte den Anmeldelink weitergeben — ohne diesen Link kommt sie oder er nicht rein."
          : "Anmeldelink konnte nicht erzeugt werden. Login über die normale Anmeldeseite.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  if (!input.makeAdmin) {
    const profile = await findProfileByEmail(service, email);
    if (!profile) {
      return {
        ok: false,
        message: "Kein Konto mit dieser E-Mail gefunden.",
      };
    }
    if (profile.role !== "admin") {
      return { ok: true, message: `${email} ist bereits ein normales Konto.` };
    }

    const { count, error: countError } = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) {
      return { ok: false, message: `Rolle konnte nicht geändert werden: ${countError.message}` };
    }
    if ((count ?? 0) <= 1) {
      return { ok: false, message: "Der letzte Plattform-Admin kann nicht entfernt werden." };
    }

    const { error } = await service.from("profiles").update({ role: "customer" }).eq("id", profile.id);
    if (error) {
      return { ok: false, message: `Rolle konnte nicht geändert werden: ${error.message}` };
    }
    if (profile.id === input.actorUserId) {
      return {
        ok: true,
        message: `${email} hat jetzt die Kundenansicht. Bitte die Seite einmal neu laden.`,
      };
    }
    return { ok: true, message: `${email} ist wieder ein normales Konto.` };
  }

  const existingProfile = await findProfileByEmail(service, email);
  const existingAuthId = existingProfile?.id ?? (await findAuthUserIdByEmail(service, email));
  const userId = existingAuthId ?? (await createConfirmedUser(service, email));
  const created = !existingAuthId;

  if (existingAuthId) {
    await unbanAndConfirmUser(service, existingAuthId);
  }

  await ensureAdminProfile(service, userId, email);
  const inviteLink = await generateLoginLink(service, email);

  if (created) {
    return {
      ok: true,
      inviteLink,
      message: inviteLink
        ? `${email} hat jetzt die Admin-Ansicht. Es gab noch kein Konto — bitte den Anmeldelink weitergeben.`
        : `${email} hat jetzt die Admin-Ansicht. Es gab noch kein Konto; Login über die normale Anmeldeseite.`,
    };
  }

  return {
    ok: true,
    inviteLink,
    message: inviteLink
      ? `${email} hat die Admin-Ansicht. Bitte den Anmeldelink weitergeben, damit sie oder er sich einloggen kann.`
      : `${email} hat jetzt die Admin-Ansicht (Verwaltung, SEO Modus).`,
  };
}
