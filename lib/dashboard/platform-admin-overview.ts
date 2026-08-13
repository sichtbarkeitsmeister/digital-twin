import { createServiceClient } from "@/lib/supabase/service";

export type PlatformAdminOrgRow = {
  id: string;
  name: string;
  slug: string | null;
  displayName: string | null;
  createdAt: string;
  memberCount: number;
  pendingInviteCount: number;
  ownerEmail: string | null;
  twinProvisioned: boolean;
  seoEnabled: boolean;
  agentCount: number;
  lastReportAt: string | null;
};

export type PlatformAdminStats = {
  totalOrgs: number;
  twinActive: number;
  seoActive: number;
  totalMembers: number;
  pendingInvites: number;
  newOrgs30d: number;
  withoutOwner: number;
};

export type PlatformAdminOverview = {
  organisations: PlatformAdminOrgRow[];
  stats: PlatformAdminStats;
};

export async function loadPlatformAdminOverview(): Promise<PlatformAdminOverview> {
  const supabase = createServiceClient();

  const [
    { data: orgs },
    { data: members },
    { data: invites },
    { data: configs },
    { data: agents },
    { data: reports },
  ] = await Promise.all([
    supabase
      .from("organisations")
      .select("id,name,slug,created_at,owner_user_id")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("organisation_members").select("organisation_id"),
    supabase
      .from("organisation_invites")
      .select("organisation_id")
      .eq("status", "pending"),
    supabase
      .from("dt_org_config")
      .select("organisation_id,display_name,seo_enabled,twin_provisioned"),
    supabase.from("dt_agents").select("organisation_id"),
    supabase
      .from("dt_seo_reports")
      .select("organisation_id,finished_at,created_at")
      .order("created_at", { ascending: false }),
  ]);

  const allOrgs = orgs ?? [];
  const orgIds = new Set(allOrgs.map((o) => o.id));

  const memberCountByOrg = new Map<string, number>();
  for (const row of members ?? []) {
    if (!orgIds.has(row.organisation_id)) continue;
    memberCountByOrg.set(
      row.organisation_id,
      (memberCountByOrg.get(row.organisation_id) ?? 0) + 1,
    );
  }

  const pendingInviteByOrg = new Map<string, number>();
  for (const row of invites ?? []) {
    if (!orgIds.has(row.organisation_id)) continue;
    pendingInviteByOrg.set(
      row.organisation_id,
      (pendingInviteByOrg.get(row.organisation_id) ?? 0) + 1,
    );
  }

  const configByOrg = new Map(
    (configs ?? []).map((c) => [c.organisation_id, c]),
  );

  const agentCountByOrg = new Map<string, number>();
  for (const row of agents ?? []) {
    if (!orgIds.has(row.organisation_id)) continue;
    agentCountByOrg.set(
      row.organisation_id,
      (agentCountByOrg.get(row.organisation_id) ?? 0) + 1,
    );
  }

  const lastReportByOrg = new Map<string, string>();
  for (const row of reports ?? []) {
    if (!orgIds.has(row.organisation_id)) continue;
    if (lastReportByOrg.has(row.organisation_id)) continue;
    const at = row.finished_at ?? row.created_at;
    if (at) lastReportByOrg.set(row.organisation_id, at);
  }

  const ownerIds = [
    ...new Set(
      allOrgs
        .map((org) => org.owner_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const ownerEmailById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: ownerProfiles } = await supabase
      .from("profiles")
      .select("id,email")
      .in("id", ownerIds);

    for (const owner of ownerProfiles ?? []) {
      if (owner.email) ownerEmailById.set(owner.id, owner.email);
    }
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const organisations: PlatformAdminOrgRow[] = allOrgs.map((org) => {
    const cfg = configByOrg.get(org.id);
    const ownerEmail = org.owner_user_id
      ? (ownerEmailById.get(org.owner_user_id) ?? null)
      : null;

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: cfg?.display_name ?? null,
      createdAt: org.created_at,
      memberCount: memberCountByOrg.get(org.id) ?? 0,
      pendingInviteCount: pendingInviteByOrg.get(org.id) ?? 0,
      ownerEmail,
      twinProvisioned: cfg?.twin_provisioned ?? false,
      seoEnabled: cfg?.seo_enabled ?? false,
      agentCount: agentCountByOrg.get(org.id) ?? 0,
      lastReportAt: lastReportByOrg.get(org.id) ?? null,
    };
  });

  const stats: PlatformAdminStats = {
    totalOrgs: organisations.length,
    twinActive: organisations.filter((o) => o.twinProvisioned).length,
    seoActive: organisations.filter((o) => o.seoEnabled).length,
    totalMembers: [...memberCountByOrg.values()].reduce((sum, n) => sum + n, 0),
    pendingInvites: invites?.length ?? 0,
    newOrgs30d: organisations.filter(
      (o) => new Date(o.createdAt).getTime() >= thirtyDaysAgo,
    ).length,
    withoutOwner: organisations.filter((o) => !o.ownerEmail).length,
  };

  return { organisations, stats };
}
