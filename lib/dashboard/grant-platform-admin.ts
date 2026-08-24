import { isAlreadyRegisteredAuthError, isForeignKeyRestrictError } from "@/lib/dashboard/auth-user-errors";
import { getAppBaseUrl } from "@/lib/email/mailer";
import { createServiceClient } from "@/lib/supabase/service";

export type GrantPlatformAdminResult = {
  ok: boolean;
  message: string;
  inviteLink?: string | null;
};

type AuthUserRef = { id: string; email?: string | null };
type ServiceClient = ReturnType<typeof createServiceClient>;

function confirmRedirectUrl() {
  return `${getAppBaseUrl()}/auth/confirm?next=/dashboard`;
}

function escapeIlike(email: string) {
  return email.replace(/[%_]/g, "\\$&");
}

async function findProfileByEmail(service: ServiceClient, email: string) {
  const { data, error } = await service
    .from("profiles")
    .select("id,email,role")
    .ilike("email", escapeIlike(email))
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function findAuthUserIdByEmail(
  service: ServiceClient,
  email: string,
): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const res = await fetch(`${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        id?: string;
        email?: string;
        users?: AuthUserRef[];
      };
      if (json.id && json.email?.toLowerCase() === email) return json.id;
      const match = json.users?.find((u) => u.email?.toLowerCase() === email);
      if (match?.id) return match.id;
    }
  }

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match?.id) return match.id;
    if (data.users.length < 200) break;
  }

  return null;
}

async function createConfirmedUser(service: ServiceClient, email: string): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (data.user?.id && !error) return data.user.id;

  if (error && isAlreadyRegisteredAuthError(error.message)) {
    const id = await findAuthUserIdByEmail(service, email);
    if (id) return id;
  }

  throw new Error(
    error?.message?.trim() ||
      "Konto konnte nicht angelegt werden. Bitte die E-Mail prüfen und erneut versuchen.",
  );
}

async function ensureAdminProfile(service: ServiceClient, userId: string, email: string) {
  const { error } = await service.from("profiles").upsert(
    { id: userId, email, role: "admin" },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`Rolle konnte nicht gesetzt werden: ${error.message}`);
  }
}

async function generateLoginLink(service: ServiceClient, email: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: confirmRedirectUrl() },
  });
  if (error) {
    console.warn("[admin] magiclink after grant failed:", error.message);
    return null;
  }
  return data.properties?.action_link?.trim() || null;
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
      try {
        await service.auth.admin.updateUserById(existingId, {
          email_confirm: true,
          ban_duration: "none",
        });
      } catch (err) {
        console.warn(
          "[admin] could not unban/confirm existing user:",
          err instanceof Error ? err.message : err,
        );
      }
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
          ? "Bitte den Anmeldelink an Vanessa weitergeben — ohne diesen Link kommt sie nicht rein."
          : "Anmeldelink konnte nicht erzeugt werden. Sie kann sich über die normale Login-Seite anmelden.",
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
    if (profile.id === input.actorUserId) {
      return { ok: false, message: "Du kannst dir die Admin-Ansicht nicht selbst entziehen." };
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
    return { ok: true, message: `${email} ist wieder ein normales Konto.` };
  }

  const existingProfile = await findProfileByEmail(service, email);
  const existingAuthId = existingProfile?.id ?? (await findAuthUserIdByEmail(service, email));
  const userId = existingAuthId ?? (await createConfirmedUser(service, email));
  const created = !existingAuthId;

  if (existingAuthId) {
    try {
      await service.auth.admin.updateUserById(existingAuthId, {
        email_confirm: true,
        ban_duration: "none",
      });
    } catch (err) {
      console.warn(
        "[admin] could not unban/confirm existing user:",
        err instanceof Error ? err.message : err,
      );
    }
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
      ? `${email} hat die Admin-Ansicht. Bitte den Anmeldelink weitergeben, damit sie sich einloggen kann.`
      : `${email} hat jetzt die Admin-Ansicht (Verwaltung, SEO Modus).`,
  };
}
