import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ClipboardPenLine } from "lucide-react";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { EnsureOrgSurveyFolderPrompt } from "@/app/dashboard/frageboegen/_components/ensure-org-survey-folder-prompt";
import { SurveyOrganisationAssignmentMenu } from "@/app/dashboard/surveys/_components/survey-organisation-assignment-menu";
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
import {
  countUnassignedSurveys,
  listSurveysForOrganisation,
  listUnassignedSurveys,
} from "@/lib/dt/list-organisation-surveys";
import { findOrganisationSurveyFolder } from "@/lib/dt/ensure-organisation-survey-folder";
import { organisationSurveyOpenHref } from "@/lib/dt/organisation-survey-open-href";
import {
  loadDtFragebogenOrganisations,
  loadDtManageOrganisations,
} from "@/lib/dt/load-manage-organisations";
import { organisationOptionLabel } from "@/lib/shared/organisation-option";
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
  return purpose === "anbieter" ? "Anbieter" : purpose === "intern" ? "Intern" : "Persona";
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
  searchParams: Promise<{ org?: string; unassigned?: string }>;
}) {
  const { org: orgParam, unassigned: unassignedParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    redirect("/auth/login");
  }

  const [{ organisations, isPlatformAdmin }, manage] = await Promise.all([
    loadDtFragebogenOrganisations(user.id),
    loadDtManageOrganisations(user.id),
  ]);
  const assignableOrganisations = isPlatformAdmin
    ? organisations
    : manage.organisations;
  const canAssign = assignableOrganisations.length > 0;
  const showUnassigned = isPlatformAdmin && unassignedParam === "1";
  const selectedOrganisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : (organisations[0]?.id ?? null);

  if (!selectedOrganisationId && !showUnassigned) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">Fragebögen</h1>
        <Card>
          <CardHeader>
            <CardTitle>Keine Organisation</CardTitle>
            <CardDescription>
              Du musst Mitglied einer Organisation sein, um Fragebögen zu sehen.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const selectedOrg =
    organisations.find((o) => o.id === selectedOrganisationId) ?? null;
  const selectedOrgName = organisationOptionLabel(selectedOrg);
  const [surveys, surveyFolder, unassignedCount] = await Promise.all([
    showUnassigned
      ? listUnassignedSurveys()
      : listSurveysForOrganisation({
          organisationId: selectedOrganisationId!,
        }),
    selectedOrganisationId
      ? findOrganisationSurveyFolder(selectedOrganisationId)
      : Promise.resolve(null),
    isPlatformAdmin ? countUnassignedSurveys() : Promise.resolve(0),
  ]);

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
              {showUnassigned
                ? "Umfragen ohne Organisations-Zuordnung — hier zuordnen, damit sie unter der Organisation erscheinen."
                : `Alle Umfragen und Antworten für ${selectedOrgName}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {organisations.length > 0 ? (
              <OrganisationSwitcher
                organisations={organisations}
                selectedOrganisationId={showUnassigned ? null : selectedOrganisationId}
                orgPath="/dashboard/frageboegen"
              />
            ) : null}
            {isPlatformAdmin ? (
              <Button asChild variant={showUnassigned ? "default" : "outline"} size="sm">
                <Link href="/dashboard/frageboegen?unassigned=1">
                  Ohne Organisation{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
                </Link>
              </Button>
            ) : null}
            {selectedOrganisationId ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/organisations?org=${encodeURIComponent(selectedOrganisationId)}`}
                >
                  Organisation bearbeiten
                </Link>
              </Button>
            ) : null}
            {isPlatformAdmin ? (
              <>
                {selectedOrganisationId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/dashboard/erstgespraech?org=${encodeURIComponent(selectedOrganisationId)}`}
                    >
                      Erstgespräch
                    </Link>
                  </Button>
                ) : null}
                <Button asChild size="sm">
                  <Link
                    href={
                      selectedOrganisationId
                        ? `/dashboard/frageboegen/neu?org=${encodeURIComponent(selectedOrganisationId)}`
                        : "/dashboard/frageboegen/neu"
                    }
                  >
                    Fragebogen erzeugen
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/surveys">Alle Umfragen</Link>
                </Button>
              </>
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
              {showUnassigned
                ? "Diese Umfragen haben noch keine Organisation. Über das Menü zuordnen."
                : "Zuordnung über Organisations-ID, Ordnername oder Agenten. Organisation pro Fragebogen sichtbar und änderbar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {isPlatformAdmin && !showUnassigned && selectedOrganisationId && !surveyFolder ? (
              <EnsureOrgSurveyFolderPrompt
                organisationId={selectedOrganisationId}
                organisationName={selectedOrgName}
              />
            ) : null}
            {surveys.length === 0 ? (
              <p className="rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-8 text-center text-sm text-secondary dark:border-white/15">
                {showUnassigned
                  ? "Alle Umfragen sind einer Organisation zugeordnet."
                  : "Noch keine Fragebögen für diese Organisation gefunden."}
                {isPlatformAdmin && !showUnassigned && unassignedCount > 0 ? (
                  <>
                    {" "}
                    <Link
                      href="/dashboard/frageboegen?unassigned=1"
                      className="font-medium text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
                    >
                      {unassignedCount} nicht zugeordnete Fragebögen anzeigen
                    </Link>
                  </>
                ) : null}
              </p>
            ) : (
              <ul className="grid gap-2">
                {surveys.map((survey) => {
                  const href = organisationSurveyOpenHref(survey);
                  return (
                    <li
                      key={survey.surveyId}
                      className="flex flex-col gap-2 rounded-xl border border-sbkm-navy/10 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 grid gap-1">
                        <Link
                          href={href}
                          className="truncate text-sm font-semibold text-primary hover:underline"
                        >
                          {survey.title}
                        </Link>
                        <p className="text-xs text-secondary">
                          {survey.folderName
                            ? `Ordner: ${survey.folderName}`
                            : "Ohne Ordner"}
                          {" · "}
                          aktualisiert {formatDate(survey.updatedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SurveyOrganisationAssignmentMenu
                          surveyId={survey.surveyId}
                          currentOrganisationId={survey.organisationId}
                          organisations={assignableOrganisations}
                          labelOrganisations={organisations}
                          canEdit={canAssign}
                          allowUnassign={isPlatformAdmin}
                        />
                        <Badge variant="outline">{purposeLabel(survey.purpose)}</Badge>
                        <Badge
                          variant={
                            survey.responseStatus === "completed" ? "default" : "secondary"
                          }
                        >
                          {statusLabel(survey.responseStatus)}
                        </Badge>
                        <Link
                          href={href}
                          className="text-xs font-medium text-sbkm-navy dark:text-sbkm-mint"
                        >
                          {href.startsWith("/s/") ? "Ausfüllen →" : "Öffnen →"}
                        </Link>
                      </div>
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
