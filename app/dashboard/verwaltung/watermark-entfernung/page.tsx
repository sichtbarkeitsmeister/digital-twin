import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { DtWatermarkTool } from "@/components/dt/text-tools/dt-watermark-tool";
import { XAI_MISSING_KEY_MESSAGE, resolveXaiApiKey } from "@/lib/dt/content/pipeline/xai";
import { loadContentSettings } from "@/lib/dt/content/store";
import { loadDtSeoOrganisations } from "@/lib/dt/load-seo-organisations";
import { createClient } from "@/lib/supabase/server";

function WatermarkFallback() {
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
async function WatermarkPageContent({ searchParams }: { searchParams: { org?: string } }) {
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
        Watermark Entfernung ist für Administratoren verfügbar. Es gibt noch keine Organisation mit DigitalTwin-Konfiguration.
      </p>
    );
  }

  const organisationId =
    searchParams.org && organisations.some((o) => o.id === searchParams.org)
      ? searchParams.org
      : organisations[0]!.id;
  const organisation = organisations.find((o) => o.id === organisationId)!;

  const settingsRow = await loadContentSettings(supabase, organisationId).catch(() => null);

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">Watermark Entfernung</h1>
          <p className="text-xs text-secondary sm:text-sm">
            Einen fertigen Text für <span className="font-semibold">{organisation.name}</span> Satz für Satz neu
            formulieren lassen – ein Schritt auf Grok, ohne die neun Schritte von Texte.
          </p>
        </div>

        <DtWatermarkTool
          key={organisationId}
          organisationId={organisationId}
          organisationName={organisation.name}
          settingsConfirmed={Boolean(settingsRow)}
          xaiConfigured={Boolean(resolveXaiApiKey())}
          xaiMissingMessage={XAI_MISSING_KEY_MESSAGE}
        />
      </div>
    </OrganisationPageShell>
  );
}

export default async function VerwaltungWatermarkPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;

  return (
    <Suspense fallback={<WatermarkFallback />}>
      <WatermarkPageContent searchParams={sp} />
    </Suspense>
  );
}
