import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ErstgespraechForm } from "@/app/dashboard/erstgespraech/_components/erstgespraech-form";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

export default async function ErstgespraechPage({
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
    redirect("/dashboard");
  }

  const { organisations } = await loadDtManageOrganisations(user.id);
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
      <ErstgespraechForm
        organisationId={organisationId}
        organisations={organisations}
      />
    </>
  );
}
