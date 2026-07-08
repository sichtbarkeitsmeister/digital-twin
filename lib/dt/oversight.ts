import { loadDtAuthorLabels } from "@/lib/dt/author-labels";
import { formatPersonDisplayName } from "@/lib/dt/display-name";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type DtOversightMember = {
  id: string;
  label: string;
  email: string | null;
  role: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Inhaber",
  admin: "Admin",
  member: "Mitglied",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Mitglied";
}

export type DtChatParticipant = {
  id: string;
  label: string;
  email: string | null;
  messageCount: number;
};

export async function loadOrgMembersForOversight(
  organisationId: string,
): Promise<DtOversightMember[]> {
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organisations")
    .select("owner_user_id")
    .eq("id", organisationId)
    .maybeSingle();

  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("user_id, org_role")
    .eq("organisation_id", organisationId);

  const userIds = new Set<string>();
  const roleByUser = new Map<string, string>();

  if (org?.owner_user_id) {
    userIds.add(org.owner_user_id);
    roleByUser.set(org.owner_user_id, "owner");
  }

  for (const row of memberships ?? []) {
    if (!row.user_id) continue;
    userIds.add(row.user_id);
    if (!roleByUser.has(row.user_id)) {
      roleByUser.set(row.user_id, row.org_role ?? "member");
    }
  }

  const ids = [...userIds];
  const service = createServiceClient();

  const nameById = new Map<string, string>();
  const emailById = new Map<string, string>();

  const { data: profiles } = await service
    .from("profiles")
    .select("id,email")
    .in("id", ids);

  for (const row of profiles ?? []) {
    const email = row.email?.trim();
    if (email) emailById.set(row.id, email);
  }

  // For anyone still missing an email (no profile row), look up the auth record.
  await Promise.all(
    ids
      .filter((id) => !emailById.has(id) && !nameById.has(id))
      .map(async (id) => {
        try {
          const { data } = await service.auth.admin.getUserById(id);
          const email = data.user?.email?.trim();
          if (email) emailById.set(id, email);
          const fullName =
            (data.user?.user_metadata?.full_name as string | undefined)?.trim() ||
            (data.user?.user_metadata?.name as string | undefined)?.trim();
          if (fullName) nameById.set(id, fullName);
        } catch {
          // ignore – fall back to role label below
        }
      }),
  );

  // Disambiguate role-only fallbacks ("Mitglied 1", "Mitglied 2", …).
  const roleCounter = new Map<string, number>();

  return ids
    .map((id) => {
      const role = roleByUser.get(id) ?? "member";
      const name = nameById.get(id);
      const email = emailById.get(id) ?? null;
      let label: string;
      if (name) {
        label = name;
      } else if (email) {
        const local = email.includes("@") ? email.split("@")[0]! : email;
        label = formatPersonDisplayName(local);
      } else {
        const base = roleLabel(role);
        const n = (roleCounter.get(base) ?? 0) + 1;
        roleCounter.set(base, n);
        label = n > 1 ? `${base} ${n}` : base;
      }
      return { id, label, email, role };
    })
    .sort((a, b) => {
      const roleOrder = (r: string) =>
        r === "owner" ? 0 : r === "admin" ? 1 : 2;
      const diff = roleOrder(a.role) - roleOrder(b.role);
      if (diff !== 0) return diff;
      return a.label.localeCompare(b.label, "de");
    });
}

export function buildChatParticipants(
  messages: Array<{ author_user_id: string | null; role: string }>,
  authorLabels: Record<string, string>,
  authorEmails: Record<string, string | null> = {},
): DtChatParticipant[] {
  const counts = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role !== "user" || !msg.author_user_id) continue;
    counts.set(msg.author_user_id, (counts.get(msg.author_user_id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, messageCount]) => ({
      id,
      label: authorLabels[id] ?? "Nutzer",
      email: authorEmails[id] ?? null,
      messageCount,
    }))
    .sort((a, b) => b.messageCount - a.messageCount);
}

export async function loadDtChatOwnerLabels(
  ownerIds: string[],
): Promise<Record<string, string>> {
  return loadDtAuthorLabels(ownerIds);
}
