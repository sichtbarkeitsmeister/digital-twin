import { isAlreadyRegisteredAuthError } from "@/lib/dashboard/auth-user-errors";
import { createServiceClient } from "@/lib/supabase/service";

type AuthUserRef = { id: string; email?: string | null };
export type ServiceClient = ReturnType<typeof createServiceClient>;

function escapeIlike(email: string) {
  return email.replace(/[%_]/g, "\\$&");
}

export async function findProfileByEmail(service: ServiceClient, email: string) {
  const { data, error } = await service
    .from("profiles")
    .select("id,email,role")
    .ilike("email", escapeIlike(email))
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function findAuthUserIdByEmail(
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

export async function createConfirmedUser(service: ServiceClient, email: string): Promise<string> {
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

export async function unbanAndConfirmUser(service: ServiceClient, userId: string) {
  try {
    await service.auth.admin.updateUserById(userId, {
      email_confirm: true,
      ban_duration: "none",
    });
  } catch (err) {
    console.warn(
      "[auth] could not unban/confirm existing user:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function ensureAdminProfile(service: ServiceClient, userId: string, email: string) {
  const { error } = await service.from("profiles").upsert(
    { id: userId, email, role: "admin" },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`Rolle konnte nicht gesetzt werden: ${error.message}`);
  }
}

export async function ensureConfirmedAuthUser(
  service: ServiceClient,
  email: string,
): Promise<{ userId: string; created: boolean }> {
  const existingProfile = await findProfileByEmail(service, email);
  const existingAuthId = existingProfile?.id ?? (await findAuthUserIdByEmail(service, email));
  if (existingAuthId) {
    await unbanAndConfirmUser(service, existingAuthId);
    return { userId: existingAuthId, created: false };
  }
  const userId = await createConfirmedUser(service, email);
  return { userId, created: true };
}
