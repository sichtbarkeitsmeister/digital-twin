import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DtSeoCrawlViewer } from "@/components/dt/seo/dt-seo-crawl-viewer";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { createClient } from "@/lib/supabase/server";

export default async function SeoCrawlViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const sp = await searchParams;
  const { organisations, canAccessSeo } = await loadDtSeoOrganisations(user.id);

  if (!canAccessSeo) {
    redirect("/dashboard");
  }

  const org =
    sp.org && organisations.some((o) => o.id === sp.org)
      ? organisations.find((o) => o.id === sp.org)!
      : organisations[0];

  if (!org) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
        Keine Organisation mit SEO-Zugang.
      </p>
    );
  }

  return (
    <Suspense
      fallback={
        <p className="text-sm text-sbkm-ink-600 dark:text-white/70">Crawl-Daten werden geladen …</p>
      }
    >
      <DtSeoCrawlViewer organisationId={org.id} organisationName={org.name} />
    </Suspense>
  );
}
