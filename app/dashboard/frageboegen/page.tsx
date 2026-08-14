import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ClipboardPenLine } from "lucide-react";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { PersistedOrganisationUrlSync } from "@/components/shared/persisted-organisation-url-sync";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listSurveysForOrganisation } from "@/lib/dt/list-organisation-surveys";
import { loadDtManageOrganisations } from "@/lib/dt/load-manage-organisations";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function purposeLabel(purpose: string) {
  return purpose === "anbieter" ? "Anbieter" : "Persona";
}

function statusLabel(status: string | null) {
  if (status === "completed") return "Abgeschlossen";
  if (status === "in_progress") return "In Bearbeitung";
  if (!status) return "Ohne Antwort";
  return status;
}

export default async function OrganisationFrageboegenPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    redirect("/auth/login");
  }

  const { organisations, isPlatformAdmin } = await loadDtManageOrganisations(user.id);
  const selectedOrganisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : (organisations[0]?.id ?? null);

  if (!selectedOrganisationId) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Fragebögen</h1>
        <Card>
          <CardHeader>
            <CardTitle>Keine Organisation</CardTitle>
            <CardDescription>
              Du brauchst Admin- oder Inhaber-Rechte in einer Organisation, um Fragebögen zu
              sehen.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const selectedOrgName =
    organisations.find((o) => o.id === selectedOrganisationId)?.name ?? "Organisation";
  const surveys = await listSurveysForOrganisation({
    organisationId: selectedOrganisationId,
  });

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
            <h1 className="text-2xl font-bold tracking-tight text-primary">Fragebögen</h1>
            <p className="text-sm text-secondary">
              Alle Umfragen und Antworten für {selectedOrgName}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrganisationSwitcher
              organisations={organisations}
              selectedOrganisationId={selectedOrganisationId}
              orgPath="/dashboard/frageboegen"
            />
            {isPlatformAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/surveys">Alle Umfragen</Link>
              </Button>
            ) : null}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardPenLine className="size-4" aria-hidden />
              {surveys.length} {surveys.length === 1 ? "Fragebogen" : "Fragebögen"}
            </CardTitle>
            <CardDescription>
              Verknüpft über Organisations-ID, Ordnername oder Agenten-Zuordnung.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {surveys.length === 0 ? (
              <p className="rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-8 text-center text-sm text-secondary dark:border-white/15">
                Noch keine Fragebögen für diese Organisation gefunden.
              </p>
            ) : (
              <ul className="grid gap-2">
                {surveys.map((survey) => {
                  const href = survey.responseId
                    ? `/dashboard/surveys/${survey.surveyId}/responses/${survey.responseId}`
                    : `/dashboard/surveys/${survey.surveyId}/edit`;
                  return (
                    <li key={survey.surveyId}>
                      <Link
                        href={href}
                        className="flex flex-col gap-2 rounded-xl border border-sbkm-navy/10 bg-white/70 px-4 py-3 transition hover:border-sbkm-mint/40 hover:bg-sbkm-mint/10 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 grid gap-1">
                          <p className="truncate text-sm font-semibold text-primary">
                            {survey.title}
                          </p>
                          <p className="text-xs text-secondary">
                            {survey.folderName
                              ? `Ordner: ${survey.folderName}`
                              : "Ohne Ordner"}
                            {" · "}
                            aktualisiert {formatDate(survey.updatedAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">{purposeLabel(survey.purpose)}</Badge>
                          <Badge
                            variant={
                              survey.responseStatus === "completed" ? "default" : "secondary"
                            }
                          >
                            {statusLabel(survey.responseStatus)}
                          </Badge>
                          <span className="text-xs font-medium text-sbkm-navy dark:text-sbkm-mint">
                            Öffnen →
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
