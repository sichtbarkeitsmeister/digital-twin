import { getAppBaseUrl } from "@/lib/email/mailer";
import { createServiceClient } from "@/lib/supabase/service";

export type GrantPlatformAdminResult = {
  ok: boolean;
  message: string;
  inviteLink?: string | null;
};

function loginRedirectUrl() {
  return `${getAppBaseUrl()}/dashboard/inbox`;
}

async function findProfileByEmail(
  service: ReturnType<typeof createServiceClient>,
  email: string,
) {
  const { data, error } = await service
    .from("profiles")
    .select("id,email,role")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function resolveAuthUserId(
  service: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<{ userId: string; created: boolean; inviteLink: string | null }> {
  const existing = await findProfileByEmail(service, email);
  if (existing?.id) {
    return { userId: existing.id, created: false, inviteLink: null };
  }

  const redirectTo = loginRedirectUrl();
  let created = true;
  let { data, error } = await service.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (error) {
    created = false;
    ({ data, error } = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    }));
  }

  const userId = data?.user?.id;
  if (error || !userId) {
    throw new Error(
      error?.message?.trim() ||
        "Kein Konto mit dieser E-Mail gefunden. Die Person muss sich zuerst anmelden.",
    );
  }

  return {
    userId,
    created,
    inviteLink: data.properties?.action_link?.trim() || null,
  };
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
        message: "Kein Konto mit dieser E-Mail gefunden. Die Person muss sich zuerst anmelden.",
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

  const { userId, created, inviteLink } = await resolveAuthUserId(service, email);

  const { error } = await service.from("profiles").upsert(
    { id: userId, email, role: "admin" },
    { onConflict: "id" },
  );
  if (error) {
    return { ok: false, message: `Rolle konnte nicht geändert werden: ${error.message}` };
  }

  if (created) {
    return {
      ok: true,
      inviteLink,
      message: inviteLink
        ? `${email} hat jetzt die Admin-Ansicht. Es gab noch kein Konto — bitte den Anmeldelink weitergeben.`
        : `${email} hat jetzt die Admin-Ansicht. Es gab noch kein Konto; sie kann sich über den üblichen Login anmelden.`,
    };
  }

  return {
    ok: true,
    message: `${email} hat jetzt die Admin-Ansicht (Verwaltung, SEO Modus).`,
  };
}
