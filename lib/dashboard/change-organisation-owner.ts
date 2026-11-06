import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST has not picked up the new owner RPCs yet. */
export function isMissingOwnerRpc(message: string): boolean {
  const raw = message.toLowerCase();
  return (
    raw.includes("could not find the function") ||
    raw.includes("schema cache") ||
    (raw.includes("function") && raw.includes("does not exist"))
  );
}

export function describeOwnerChange(input: {
  email: string;
  createdAccount: boolean;
  removedPrevious: boolean;
}): string {
  const createdNote = input.createdAccount
    ? " Es gab noch kein Konto — wir haben eines angelegt."
    : "";
  const previousNote = input.removedPrevious
    ? " Die bisherige Adresse hat keinen Zugang mehr zu dieser Organisation."
    : " Der bisherige Inhaber bleibt als Admin im Team.";
  return `Inhaber ist jetzt ${input.email}.${createdNote}${previousNote}`;
}

export function describeOwnerRemoval(emails: string[]): string {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) {
    return "Inhaber entfernt. Die Organisation hat derzeit keinen Inhaber.";
  }
  if (unique.length === 1) {
    return `${unique[0]} ist nicht mehr Inhaber und hat keinen Zugang mehr über diese Rolle. Die Organisation hat derzeit keinen Inhaber.`;
  }
  return `Entfernt: ${unique.join(", ")}. Die Organisation hat derzeit keinen Inhaber.`;
}

type ServiceClient = SupabaseClient;

function revokedNow(): string {
  return new Date().toISOString();
}

async function emailsForUsers(service: ServiceClient, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await service.from("profiles").select("id,email").in("id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => (typeof row.email === "string" ? row.email.trim().toLowerCase() : ""))
    .filter(Boolean);
}

async function revokePendingInvites(
  service: ServiceClient,
  organisationId: string,
  options: { ownerRole: boolean; emails: string[] },
): Promise<void> {
  const stamp = { status: "revoked" as const, revoked_at: revokedNow() };
  if (options.ownerRole) {
    const { error } = await service
      .from("organisation_invites")
      .update(stamp)
      .eq("organisation_id", organisationId)
      .eq("status", "pending")
      .eq("org_role", "owner");
    if (error) throw new Error(error.message);
  }
  const emails = [...new Set(options.emails)];
  if (emails.length === 0) return;
  const { error } = await service
    .from("organisation_invites")
    .update(stamp)
    .eq("organisation_id", organisationId)
    .eq("status", "pending")
    .in("email", emails);
  if (error) throw new Error(error.message);
}

/**
 * Same writes as transfer_organisation_ownership, for databases that do not
 * have the new function signature yet. Caller must already have checked rights.
 */
export async function transferOrganisationOwnerWithService(
  service: ServiceClient,
  input: {
    organisationId: string;
    newOwnerUserId: string;
    actorUserId: string;
    removePrevious: boolean;
  },
): Promise<void> {
  const { data: previous, error: previousError } = await service
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", input.organisationId)
    .eq("org_role", "owner")
    .neq("user_id", input.newOwnerUserId);
  if (previousError) throw new Error(previousError.message);

  const previousIds = (previous ?? []).map((row) => row.user_id);
  const previousEmails = input.removePrevious
    ? await emailsForUsers(service, previousIds)
    : [];

  const inserted = await service.from("organisation_members").insert({
    organisation_id: input.organisationId,
    user_id: input.newOwnerUserId,
    org_role: "owner",
    created_by_user_id: input.actorUserId,
  });
  if (inserted.error) {
    const duplicate = /duplicate|unique/i.test(inserted.error.message);
    if (!duplicate) throw new Error(inserted.error.message);
    const updated = await service
      .from("organisation_members")
      .update({ org_role: "owner" })
      .eq("organisation_id", input.organisationId)
      .eq("user_id", input.newOwnerUserId);
    if (updated.error) throw new Error(updated.error.message);
  }

  if (previousIds.length > 0) {
    if (input.removePrevious) {
      const deleted = await service
        .from("organisation_members")
        .delete()
        .eq("organisation_id", input.organisationId)
        .in("user_id", previousIds);
      if (deleted.error) throw new Error(deleted.error.message);
    } else {
      const demoted = await service
        .from("organisation_members")
        .update({ org_role: "admin" })
        .eq("organisation_id", input.organisationId)
        .in("user_id", previousIds);
      if (demoted.error) throw new Error(demoted.error.message);
    }
  }

  await revokePendingInvites(service, input.organisationId, {
    ownerRole: true,
    emails: previousEmails,
  });

  const saved = await service
    .from("organisations")
    .update({ owner_user_id: input.newOwnerUserId })
    .eq("id", input.organisationId);
  if (saved.error) throw new Error(saved.error.message);
}

/** Owner member addresses plus pending owner-invite addresses. */
export async function listOrganisationOwnerEmails(
  service: ServiceClient,
  organisationId: string,
): Promise<string[]> {
  const [{ data: org, error: orgError }, { data: owners, error: ownersError }, { data: invites, error: invitesError }] =
    await Promise.all([
      service.from("organisations").select("owner_user_id").eq("id", organisationId).maybeSingle(),
      service
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", organisationId)
        .eq("org_role", "owner"),
      service
        .from("organisation_invites")
        .select("email")
        .eq("organisation_id", organisationId)
        .eq("status", "pending")
        .eq("org_role", "owner"),
    ]);
  if (orgError) throw new Error(orgError.message);
  if (ownersError) throw new Error(ownersError.message);
  if (invitesError) throw new Error(invitesError.message);

  const userIds = [
    ...new Set(
      [
        ...(owners ?? []).map((row) => row.user_id),
        org?.owner_user_id ?? null,
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const memberEmails = await emailsForUsers(service, userIds);
  const inviteEmails = (invites ?? [])
    .map((row) => (typeof row.email === "string" ? row.email.trim().toLowerCase() : ""))
    .filter(Boolean);
  return [...new Set([...memberEmails, ...inviteEmails])];
}

/**
 * Same writes as clear_organisation_owner. Caller must already be a platform admin.
 * Returns the addresses that were owner members or pending owner invites.
 */
export async function clearOrganisationOwnerWithService(
  service: ServiceClient,
  organisationId: string,
): Promise<string[]> {
  const removedEmails = await listOrganisationOwnerEmails(service, organisationId);
  const [{ data: org, error: orgError }, { data: owners, error: ownersError }] = await Promise.all([
    service.from("organisations").select("owner_user_id").eq("id", organisationId).maybeSingle(),
    service
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .eq("org_role", "owner"),
  ]);
  if (orgError) throw new Error(orgError.message);
  if (ownersError) throw new Error(ownersError.message);

  const userIds = [
    ...new Set(
      [
        ...(owners ?? []).map((row) => row.user_id),
        org?.owner_user_id ?? null,
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const memberEmails = await emailsForUsers(service, userIds);

  if (userIds.length > 0) {
    const deleted = await service
      .from("organisation_members")
      .delete()
      .eq("organisation_id", organisationId)
      .in("user_id", userIds);
    if (deleted.error) throw new Error(deleted.error.message);
  }

  await revokePendingInvites(service, organisationId, {
    ownerRole: true,
    emails: memberEmails,
  });

  const saved = await service
    .from("organisations")
    .update({ owner_user_id: null })
    .eq("id", organisationId);
  if (saved.error) throw new Error(saved.error.message);

  return removedEmails;
}
