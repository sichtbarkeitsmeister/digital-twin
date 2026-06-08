import { createServiceClient } from "@/lib/supabase/service";

export type DtAdminOrgRow = {
  organisationId: string;
  name: string;
  slug: string | null;
  displayName: string | null;
  seoEnabled: boolean;
  twinProvisioned: boolean;
  agentCount: number;
  memberCount: number;
  lastReportAt: string | null;
};

export async function loadDtAdminOrgOverview(): Promise<DtAdminOrgRow[]> {
  const supabase = createServiceClient();

  const { data: orgs } = await supabase
    .from("organisations")
    .select("id,name,slug,created_at")
    .order("name", { ascending: true });

  if (!orgs?.length) return [];

  const orgIds = orgs.map((o) => o.id);

  const [{ data: configs }, { data: agents }, { data: members }, { data: reports }] =
    await Promise.all([
      supabase
        .from("dt_org_config")
        .select("organisation_id,display_name,seo_enabled,twin_provisioned")
        .in("organisation_id", orgIds),
      supabase.from("dt_agents").select("organisation_id").in("organisation_id", orgIds),
      supabase
        .from("organisation_members")
        .select("organisation_id")
        .in("organisation_id", orgIds),
      supabase
        .from("dt_seo_reports")
        .select("organisation_id,finished_at,created_at,state")
        .in("organisation_id", orgIds)
        .order("created_at", { ascending: false }),
    ]);

  const configByOrg = new Map(
    (configs ?? []).map((c) => [c.organisation_id, c]),
  );
  const agentCount = new Map<string, number>();
  for (const a of agents ?? []) {
    agentCount.set(a.organisation_id, (agentCount.get(a.organisation_id) ?? 0) + 1);
  }
  const memberCount = new Map<string, number>();
  for (const m of members ?? []) {
    memberCount.set(m.organisation_id, (memberCount.get(m.organisation_id) ?? 0) + 1);
  }
  const lastReport = new Map<string, string>();
  for (const r of reports ?? []) {
    if (lastReport.has(r.organisation_id)) continue;
    const at = r.finished_at ?? r.created_at;
    if (at) lastReport.set(r.organisation_id, at);
  }

  return orgs.map((org) => {
    const cfg = configByOrg.get(org.id);
    return {
      organisationId: org.id,
      name: org.name,
      slug: org.slug,
      displayName: cfg?.display_name ?? null,
      seoEnabled: cfg?.seo_enabled ?? false,
      twinProvisioned: cfg?.twin_provisioned ?? false,
      agentCount: agentCount.get(org.id) ?? 0,
      memberCount: memberCount.get(org.id) ?? 0,
      lastReportAt: lastReport.get(org.id) ?? null,
    };
  });
}
