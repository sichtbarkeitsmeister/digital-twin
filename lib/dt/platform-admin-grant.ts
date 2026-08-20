import type { SupabaseClient } from "@supabase/supabase-js";

import { isPlatformAdmin } from "@/lib/dt/org-access";
import { ensureMemberInviteLoginLink } from "@/lib/email/member-invite";
import { createServiceClient } from "@/lib/supabase/service";

export const GRANT_PLATFORM_ADMIN_SUCCESS =
  "Verwaltungszugang erteilt. Nach einem Reload (oder neu anmelden) sieht sie Organisationen anlegen, Fragebögen und Alle Umfragen.";

export const REVOKE_PLATFORM_ADMIN_SUCCESS = "Verwaltungszugang entzogen.";

export const ALREADY_PLATFORM_ADMIN =
  "Diese Person ist bereits Plattform-Admin. Bitte einmal neu laden oder neu anmelden.";

function isMissingRpc(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

export function mapSetPlatformAdminError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes("not_authenticated")) return "Nicht angemeldet.";
  if (msg.includes("forbidden")) {
    return "Nur Plattform-Admins dürfen den Verwaltungszugang ändern.";
  }
  if (msg.includes("user_not_found") || msg.includes("invalid_user")) {
    return "Kein Konto zu dieser E-Mail gefunden.";
  }
  if (msg.includes("cannot_demote_self")) {
    return "Du kannst dir den Verwaltungszugang nicht selbst entziehen.";
  }
  if (msg.includes("last_admin")) {
    return "Der letzte Plattform-Admin kann nicht entfernt werden.";
  }
  if (isMissingRpc(raw)) {
    return "Datenbank-Funktion fehlt. Bitte Migration 20260818_set_platform_admin.sql in Supabase ausführen.";
  }
  const short = raw.trim();
  if (short && short.length < 180 && !short.includes("\n")) {
    return `Verwaltungszugang konnte nicht geändert werden: ${short}`;
  }
  return "Verwaltungszugang konnte nicht geändert werden. Bitte später erneut versuchen.";
}

type ProfileRoleRow = { id: string; role: string | null; email: string | null };

export function escapeIlikeExact(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function lookupProfileByEmail(email: string): Promise<ProfileRoleRow | null> {
  const service = createServiceClient();
  const { data: exact } = await service
    .from("profiles")
    .select("id, role, email")
    .eq("email", email)
    .maybeSingle();
  if (exact?.id) return exact;

  const { data: rows } = await service
    .from("profiles")
    .select("id, role, email")
    .ilike("email", escapeIlikeExact(email))
    .limit(2);
  return rows?.[0]?.id ? rows[0] : null;
}

async function applyViaServiceRole(opts: {
  targetUserId: string;
  makeAdmin: boolean;
  actorUserId: string;
}): Promise<{ ok: boolean; message: string }> {
  const service = createServiceClient();

  if (!opts.makeAdmin) {
    if (opts.targetUserId === opts.actorUserId) {
      return {
        ok: false,
        message: "Du kannst dir den Verwaltungszugang nicht selbst entziehen.",
      };
    }
    const { count } = await service
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message: "Der letzte Plattform-Admin kann nicht entfernt werden.",
      };
    }
  }

  const { error } = await service
    .from("profiles")
    .update({ role: opts.makeAdmin ? "admin" : "customer" })
    .eq("id", opts.targetUserId);

  if (error) {
    console.warn("[admin] set platform admin via service role failed:", error.message);
    return { ok: false, message: mapSetPlatformAdminError(error.message) };
  }

  return {
    ok: true,
    message: opts.makeAdmin ? GRANT_PLATFORM_ADMIN_SUCCESS : REVOKE_PLATFORM_ADMIN_SUCCESS,
  };
}

export async function applyPlatformAdminRole(opts: {
  supabase: SupabaseClient;
  actorUserId: string;
  targetUserId: string;
  makeAdmin: boolean;
}): Promise<{ ok: boolean; message: string }> {
  if (!(await isPlatformAdmin(opts.supabase, opts.actorUserId))) {
    return {
      ok: false,
      message: "Nur Plattform-Admins dürfen den Verwaltungszugang ändern.",
    };
  }
  if (!opts.makeAdmin && opts.targetUserId === opts.actorUserId) {
    return {
      ok: false,
      message: "Du kannst dir den Verwaltungszugang nicht selbst entziehen.",
    };
  }

  const { error } = await opts.supabase.rpc("set_platform_admin", {
    target_user_id: opts.targetUserId,
    make_admin: opts.makeAdmin,
  });

  if (!error) {
    return {
      ok: true,
      message: opts.makeAdmin ? GRANT_PLATFORM_ADMIN_SUCCESS : REVOKE_PLATFORM_ADMIN_SUCCESS,
    };
  }

  console.warn("[admin] set_platform_admin rpc failed:", error.message);
  if (!isMissingRpc(error.message)) {
    return { ok: false, message: mapSetPlatformAdminError(error.message) };
  }

  // App works before the SQL migration is applied (service role bypasses RLS).
  try {
    return await applyViaServiceRole({
      targetUserId: opts.targetUserId,
      makeAdmin: opts.makeAdmin,
      actorUserId: opts.actorUserId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY") || msg.includes("NEXT_PUBLIC_SUPABASE_URL")) {
      return { ok: false, message: mapSetPlatformAdminError(error.message) };
    }
    return {
      ok: false,
      message: mapSetPlatformAdminError(err instanceof Error ? err.message : error.message),
    };
  }
}

export async function grantPlatformAdminByEmail(opts: {
  supabase: SupabaseClient;
  actorUserId: string;
  email: string;
}): Promise<{ ok: boolean; message: string; alreadyAdmin?: boolean }> {
  const email = opts.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, message: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }
  if (!(await isPlatformAdmin(opts.supabase, opts.actorUserId))) {
    return {
      ok: false,
      message: "Nur Plattform-Admins dürfen den Verwaltungszugang ändern.",
    };
  }

  let profile: ProfileRoleRow | null = null;
  try {
    profile = await lookupProfileByEmail(email);
  } catch (err) {
    console.warn(
      "[admin] profile lookup for grant failed:",
      err instanceof Error ? err.message : err,
    );
  }

  if (!profile) {
    const login = await ensureMemberInviteLoginLink(email);
    if (!login.ok) {
      const reason = login.reason.toLowerCase();
      if (reason.includes("service-role") || reason.includes("service_role")) {
        return {
          ok: false,
          message:
            "Server-Konfiguration unvollständig (Supabase Service Role). Verwaltungszugang konnte nicht gesetzt werden.",
        };
      }
      return {
        ok: false,
        message:
          "Kein Konto zu dieser E-Mail. Bitte zuerst als Mitglied einladen und einmal anmelden lassen.",
      };
    }
    try {
      profile = await lookupProfileByEmail(email);
    } catch (err) {
      console.warn(
        "[admin] profile lookup after invite link failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!profile?.id) {
    return {
      ok: false,
      message:
        "Kein Konto zu dieser E-Mail. Bitte zuerst als Mitglied einladen und einmal anmelden lassen.",
    };
  }

  if (profile.role === "admin") {
    return { ok: true, alreadyAdmin: true, message: ALREADY_PLATFORM_ADMIN };
  }

  return applyPlatformAdminRole({
    supabase: opts.supabase,
    actorUserId: opts.actorUserId,
    targetUserId: profile.id,
    makeAdmin: true,
  });
}
