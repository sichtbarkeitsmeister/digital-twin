import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtContentWorkspace } from "@/components/dt/content/dt-content-workspace";
import { loadContentAnbieterSources, loadContentAvatarOptions } from "@/lib/dt/content/load-sources";
import { sectionsForSuggestion, suggestTextSettings } from "@/lib/dt/content/mapping";
import { loadContentSettings, settingsFromRow } from "@/lib/dt/content/store";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { createClient } from "@/lib/supabase/server";

function TexteFallback() {
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

async function TextePageContent({ searchParams }: { searchParams: { org?: string } }) {
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
        Texte sind für Administratoren verfügbar. Es gibt noch keine Organisation mit DigitalTwin-Konfiguration.
      </p>
    );
  }

  const organisationId =
    searchParams.org && organisations.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;
  const organisation = organisations.find((o) => o.id === organisationId)!;

  const [avatars, anbieter, settingsRow] = await Promise.all([
    loadContentAvatarOptions(supabase, organisationId),
    loadContentAnbieterSources(supabase, organisationId),
    loadContentSettings(supabase, organisationId).catch(() => null),
  ]);

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">Texte</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Seitentexte für <span className="font-semibold">{organisation.name}</span> in neun Schritten
            schreiben lassen, prüfen und freigeben.
          </p>
        </div>

        <DtContentWorkspace
          key={organisationId}
          organisationId={organisationId}
          avatars={avatars}
          suggestion={suggestTextSettings(
            sectionsForSuggestion(anbieter.workshop, anbieter.fragebogen?.facts ?? []),
          )}
          initialSettings={settingsRow ? settingsFromRow(settingsRow) : null}
          initialAvatarId={settingsRow?.avatar_agent_id ?? null}
        />
      </div>
    </OrganisationPageShell>
  );
}

export default async function VerwaltungTextePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;

  return (
    <Suspense fallback={<TexteFallback />}>
      <TextePageContent searchParams={sp} />
    </Suspense>
  );
}
