import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { TranscriptsPanel } from "@/app/dashboard/transkripte/_components/transcripts-panel";
import { WorkshopBoard } from "@/app/dashboard/transkripte/_components/workshop-board";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { organisationOptionLabel } from "@/lib/shared/organisation-option";
import { createClient } from "@/lib/supabase/server";

export default async function TranskriptePage({
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
      : (organisations[0]?.id ?? null);

  const selected =
    organisations.find((o) => o.id === organisationId) ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((o) => o.id)}
        />
      </Suspense>
      <div className="grid gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
              <FileText className="size-6" aria-hidden />
              Transkripte
            </h1>
            <p className="max-w-2xl text-sm text-secondary">
              Gespräche und Zusammenfassungen bleiben im Bestand der Organisation. Der Twin wertet
              den ganzen Bestand aus. Anbieter und Avatare entstehen erst, wenn du den jeweiligen
              Schritt freigibst.
            </p>
          </div>
          {organisations.length > 0 ? (
            <OrganisationSwitcher
              organisations={organisations}
              selectedOrganisationId={organisationId}
              orgPath="/dashboard/transkripte"
            />
          ) : null}
        </div>

        {!organisationId ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-secondary">
            Bitte zuerst eine Organisation wählen.
          </p>
        ) : (
          <>
            <TranscriptsPanel
              organisationId={organisationId}
              organisationName={organisationOptionLabel(selected)}
            />
            <WorkshopBoard organisationId={organisationId} />
          </>
        )}
      </div>
    </>
  );
}
