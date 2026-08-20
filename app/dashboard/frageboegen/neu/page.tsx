import { Suspense } from "react";
import { redirect } from "next/navigation";

import { FragebogenFromOrgWizard } from "@/app/dashboard/frageboegen/_components/fragebogen-from-org-wizard";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

/** Preview crawls + fills via Haiku; allow enough time without failing the page. */
export const maxDuration = 120;

export default async function NeueFragebogenPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) redirect("/auth/login");

  if (!(await isPlatformAdmin(supabase, user.id))) {
    redirect("/dashboard/frageboegen");
  }

  const { organisations } = await loadDtManageOrganisations(user.id);

  // Explicit ?org= wins; otherwise only auto-select when there is exactly one org.
  const organisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : organisations.length === 1
        ? organisations[0]!.id
        : null;

  return (
    <>
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((o) => o.id)}
        />
      </Suspense>
      <FragebogenFromOrgWizard
        organisationId={organisationId}
        organisations={organisations}
      />
    </>
  );
}
