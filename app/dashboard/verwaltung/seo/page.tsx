import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DtSeoWorkspace } from "@/components/dt/seo/dt-seo-workspace";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { ensureSeoAdvisorAgent } from "@/lib/dt/seo/ensure-seo-agent";
import { createClient } from "@/lib/supabase/server";

export default async function VerwaltungSeoPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; chat?: string; tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const sp = await searchParams;
  const { organisations, isPlatformAdmin, canAccessSeo } = await loadDtSeoOrganisations(user.id);

  if (!canAccessSeo) {
    redirect("/dashboard");
  }

  if (organisations.length === 0) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
        SEO-Modus ist für Administratoren verfügbar. Aktiviere SEO unter Einstellungen für eine
        Organisation.
      </p>
    );
  }

  const initialOrgId =
    sp.org && organisations.some((o) => o.id === sp.org) ? sp.org : organisations[0]!.id;

  const initialOrg = organisations.find((o) => o.id === initialOrgId);
  if (initialOrg?.seoEnabled) {
    await ensureSeoAdvisorAgent(supabase, initialOrgId);
  }

  return (
    <Suspense
      fallback={
        <p className="text-sm text-sbkm-ink-600 dark:text-white/70">SEO wird geladen …</p>
      }
    >
      <DtSeoWorkspace
        organisations={organisations}
        initialOrgId={initialOrgId}
        initialChatId={sp.chat ?? null}
        currentUserId={user.id}
        isPlatformAdmin={isPlatformAdmin}
      />
    </Suspense>
  );
}
