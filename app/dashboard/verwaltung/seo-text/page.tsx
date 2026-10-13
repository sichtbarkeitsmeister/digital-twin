import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtSeoTool } from "@/components/dt/text-tools/dt-seo-tool";
import {
  anbieterSummary,
  loadContentAnbieterSources,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { describeAnbieterSources } from "@/lib/dt/content/route-helpers";
import { loadContentSettings } from "@/lib/dt/content/store";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { createClient } from "@/lib/supabase/server";

function SeoToolFallback() {
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

/** Same access and organisation list as Texte: platform admins, `?org=` picks the organisation. */
async function SeoToolPageContent({ searchParams }: { searchParams: { org?: string } }) {
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
        SEO ist für Administratoren verfügbar. Es gibt noch keine Organisation mit DigitalTwin-Konfiguration.
      </p>
    );
  }

  const organisationId =
    searchParams.org && organisations.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;
  const organisation = organisations.find((o) => o.id === organisationId)!;

  const [settingsRow, anbieter, avatars] = await Promise.all([
    loadContentSettings(supabase, organisationId).catch(() => null),
    loadContentAnbieterSources(supabase, organisationId),
    loadContentAvatarOptions(supabase, organisationId),
  ]);
  const avatarId = settingsRow?.avatar_agent_id ?? avatars[0]?.id ?? null;
  const avatar = avatarId ? await loadContentAvatarRow(supabase, organisationId, avatarId) : null;

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">SEO</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Einen vollständigen Seitentext für <span className="font-semibold">{organisation.name}</span> aus einem
            Briefing schreiben lassen – Schritt 2 „SEO“ aus Texte, ohne die neun Schritte und ohne Seitenstruktur.
          </p>
        </div>

        <DtSeoTool
          key={organisationId}
          organisationId={organisationId}
          organisationName={organisation.name}
          settingsConfirmed={Boolean(settingsRow)}
          anbieterHint={describeAnbieterSources(anbieterSummary(anbieter))}
          avatarName={avatar?.name ?? null}
        />
      </div>
    </OrganisationPageShell>
  );
}

export default async function VerwaltungSeoTextPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;

  return (
    <Suspense fallback={<SeoToolFallback />}>
      <SeoToolPageContent searchParams={sp} />
    </Suspense>
  );
}
