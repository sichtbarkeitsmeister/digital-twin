import { isAlreadyRegisteredAuthError } from "@/lib/dashboard/auth-user-errors";
import { getAppBaseUrl } from "@/lib/email/mailer";
import { createServiceClient } from "@/lib/supabase/service";

export type GrantPlatformAdminResult = {
  ok: boolean;
  message: string;
  inviteLink?: string | null;
};

type AuthUserRef = { id: string; email?: string | null };

function confirmRedirectUrl() {
  return `${getAppBaseUrl()}/auth/confirm?next=/dashboard`;
}

async function findProfileByEmail(
  service: ReturnType<typeof createServiceClient>,
  email: string,
) {
  const { data, error } = await service
    .from("profiles")
    .select("id,email,role")
    .ilike("email", email.replace(/[%_]/g, "\\$&"))
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function findAuthUserIdByEmail(
  service: ReturnType<typeof createServiceClient>,
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

async function resolveAuthUserId(
  service: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<{ userId: string; created: boolean }> {
  const existingProfile = await findProfileByEmail(service, email);
  if (existingProfile?.id) {
    return { userId: existingProfile.id, created: false };
  }

  const existingAuthId = await findAuthUserIdByEmail(service, email);
  if (existingAuthId) {
    return { userId: existingAuthId, created: false };
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (data.user?.id && !error) {
    return { userId: data.user.id, created: true };
  }

  if (error && isAlreadyRegisteredAuthError(error.message)) {
    const id = await findAuthUserIdByEmail(service, email);
    if (id) return { userId: id, created: false };
  }

  throw new Error(
    error?.message?.trim() ||
      "Konto konnte nicht angelegt werden. Bitte die E-Mail prüfen und erneut versuchen.",
  );
}

async function maybeInviteLink(
  service: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<string | null> {
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

export async function grantPlatformAdminRole(input: {
  email: string;
  makeAdmin: boolean;
}): Promise<GrantPlatformAdminResult> {
  const email = input.email.trim().toLowerCase();
  const service = createServiceClient();

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
    return { ok: true, message: `${email} ist wieder ein normales Konto.` };
  }

  const { userId, created } = await resolveAuthUserId(service, email);

  const { error } = await service.from("profiles").upsert(
    { id: userId, email, role: "admin" },
    { onConflict: "id" },
  );
  if (error) {
    return { ok: false, message: `Rolle konnte nicht geändert werden: ${error.message}` };
  }

  const inviteLink = created ? await maybeInviteLink(service, email) : null;

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
    message: `${email} hat jetzt die Admin-Ansicht (Verwaltung, SEO Modus).`,
  };
}
