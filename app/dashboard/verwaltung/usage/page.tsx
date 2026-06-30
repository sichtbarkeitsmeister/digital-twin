import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { DtUsageDashboard } from "@/components/dt/usage/dt-usage-dashboard";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { userCanViewAnyDtUsage } from "@/lib/dt/usage/access";

export default async function DtUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const canView = await userCanViewAnyDtUsage(user.id);
  if (!canView) redirect("/dashboard");

  const { organisations, isPlatformAdmin } = await loadDtManageOrganisations(user.id);
  const params = await searchParams;
  const initialOrgId =
    params.org && organisations.some((o) => o.id === params.org)
      ? params.org
      : organisations[0]?.id ?? "";

  return (
    <DtUsageDashboard
      organisations={organisations}
      initialOrgId={initialOrgId}
      isPlatformAdmin={isPlatformAdmin}
    />
  );
}
