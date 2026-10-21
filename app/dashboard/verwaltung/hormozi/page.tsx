import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtHormoziTool } from "@/components/dt/text-tools/dt-hormozi-tool";
import { anbieterSummary, loadContentAnbieterSources, loadContentAvatarOptions } from "@/lib/dt/content/load-sources";
import { describeAnbieterSources } from "@/lib/dt/content/route-helpers";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { createClient } from "@/lib/supabase/server";

function HormoziFallback() {
  return (
    <OrganisationPageShell>
      <div className="grid gap-3">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
      </div>
    </OrganisationPageShell>
  );
}

/** Platform admins, `?org=` picks the organisation whose Anbieterfakten and avatars are used. */
async function HormoziPageContent({ searchParams }: { searchParams: { org?: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { organisations, canAccessSeo } = await loadDtSeoOrganisations(user.id);
  if (!canAccessSeo) redirect("/dashboard");

  if (organisations.length === 0) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/70">
        Hormozi ist für Administratoren verfügbar. Es gibt noch keine Organisation mit DigitalTwin-Konfiguration.
      </p>
    );
  }

  const organisationId =
    searchParams.org && organisations.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;
  const organisation = organisations.find((o) => o.id === organisationId)!;

  const [anbieter, avatars] = await Promise.all([
    loadContentAnbieterSources(supabase, organisationId),
    loadContentAvatarOptions(supabase, organisationId),
  ]);

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">Hormozi</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Einen fertigen Text für <span className="font-semibold">{organisation.name}</span> überzeugender machen:
            Hero-Satz, Value Equation und Handlungsaufforderungen. Eigenständig, ohne Texte und ohne Seitenstruktur.
          </p>
        </div>

        <DtHormoziTool
          key={organisationId}
          organisationId={organisationId}
          organisationName={organisation.name}
          anbieterHint={describeAnbieterSources(anbieterSummary(anbieter))}
          avatars={avatars.map((a) => ({ id: a.id, name: a.label, role: a.isMix ? null : a.role, isMix: a.isMix }))}
        />
      </div>
    </OrganisationPageShell>
  );
}

export default async function VerwaltungHormoziPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;

  return (
    <Suspense fallback={<HormoziFallback />}>
      <HormoziPageContent searchParams={sp} />
    </Suspense>
  );
}
