import { Suspense } from "react";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/app/dashboard/onboarding/_components/onboarding-form";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { loadDtFragebogenOrganisations } from "@/lib/dt/load-manage-organisations";
import { getAppBaseUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage({
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

  const { organisations } = await loadDtFragebogenOrganisations(user.id);
  const organisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : organisations[0]?.id ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((o) => o.id)}
        />
      </Suspense>
      <OnboardingForm
        organisationId={organisationId}
        organisations={organisations}
        appBaseUrl={getAppBaseUrl()}
      />
    </>
  );
}
