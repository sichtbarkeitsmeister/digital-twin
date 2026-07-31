import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type RevokeOrgInviteResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Deletes a pending organisation invite.
 * Uses service-role hard delete so it works even when the
 * revoke_organisation_invite RPC migration is not applied yet.
 */
export async function revokeOrganisationInvite(input: {
  inviteId: string;
  organisationId: string;
}): Promise<RevokeOrgInviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Nicht angemeldet." };
  }

  let service;
  try {
    service = createServiceClient();
  } catch (err) {
    return {
      ok: false,
      message: `Server-Konfiguration fehlt (${
        err instanceof Error ? err.message : "SUPABASE_SERVICE_ROLE_KEY"
      }).`,
    };
  }

  // Load via service role — avoids RLS edge cases during the mutation.
  const { data: invite, error: loadError } = await service
    .from("organisation_invites")
    .select("id, organisation_id, org_role, status, email")
    .eq("id", input.inviteId)
    .maybeSingle();

  if (loadError) {
    return { ok: false, message: `Einladung laden fehlgeschlagen: ${loadError.message}` };
  }
  if (!invite) {
    return { ok: false, message: "Einladung nicht gefunden." };
  }
  if (invite.organisation_id !== input.organisationId) {
    return { ok: false, message: "Einladung gehört nicht zu dieser Organisation." };
  }
  if (invite.status !== "pending") {
    return { ok: false, message: `Einladung ist nicht offen (Status: ${invite.status}).` };
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
    return {
      ok: false,
      message: `Keine Berechtigung (platformAdmin=${platformAdmin}, orgRole=${myRole ?? "—"}).`,
    };
  }

  // 1) Prefer RPC when migration is applied.
  const { error: rpcError } = await supabase.rpc("revoke_organisation_invite", {
    invite_id: input.inviteId,
  });
  if (!rpcError) {
    return { ok: true };
  }

  // 2) Hard-delete via service role (works without migration; frees re-invite slot).
  const { data: deleted, error: deleteError } = await service
    .from("organisation_invites")
    .delete()
    .eq("id", input.inviteId)
    .select("id");

  if (deleteError) {
    // 3) Last resort: mark revoked.
    const { data: updated, error: updateError } = await service
      .from("organisation_invites")
      .update({
        status: "revoked" as const,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", input.inviteId)
      .select("id");

    if (updateError) {
      return {
        ok: false,
        message:
          `Löschen fehlgeschlagen. RPC: ${rpcError.message}; ` +
          `Delete: ${deleteError.message}; Update: ${updateError.message}`,
      };
    }
    if (!updated?.length) {
      return {
        ok: false,
        message:
          `Löschen wirkungslos (0 Zeilen). RPC: ${rpcError.message}; Delete: ${deleteError.message}`,
      };
    }
    return { ok: true };
  }

  if (!deleted?.length) {
    return {
      ok: false,
      message: `Löschen wirkungslos (0 Zeilen). RPC: ${rpcError.message}`,
    };
  }

  return { ok: true };
}
