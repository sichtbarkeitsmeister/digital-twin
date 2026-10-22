import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DtCompanyProfilePage } from "@/components/dt/company-profile/dt-company-profile-page";
import { loadCompanyProfile } from "@/lib/dt/company-profile";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { loadDtUserOrganisations } from "@/lib/dt/load-user-organisations";
import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

async function FirmenprofilContent({ searchParams }: { searchParams: { org?: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const platformAdmin = await isPlatformAdmin(supabase, user.id);
  const organisations = platformAdmin
    ? (await loadDtManageOrganisations(user.id)).organisations
    : (await loadDtUserOrganisations(user.id)).organisations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
      }));

  if (organisations.length === 0) redirect("/dashboard");

  const initialOrgId =
    searchParams.org && organisations.some((org) => org.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;

  const canEdit = await canManageDtAgents(supabase, user.id, initialOrgId);
  const initialProfile = await loadCompanyProfile(supabase, initialOrgId, canEdit);

  return (
    <DtCompanyProfilePage
      organisations={organisations}
      initialOrgId={initialOrgId}
      initialProfile={initialProfile}
    />
  );
}

export default async function FirmenprofilPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  return (
    <Suspense
      fallback={<p className="text-sm text-sbkm-ink-600 dark:text-white/70">Firmenprofil wird geladen …</p>}
    >
      <FirmenprofilContent searchParams={sp} />
    </Suspense>
  );
}
