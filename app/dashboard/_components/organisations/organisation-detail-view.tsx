import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Calendar, ClipboardPenLine, Crown, Mail, Users } from "lucide-react";

import { loadOrgOverview } from "@/lib/dashboard/org-overview";
import { canViewDtUsage } from "@/lib/dt/usage/access";
import { isOrgOwner, isPlatformAdmin } from "@/lib/dt/org-access";
import { listSurveysForOrganisation } from "@/lib/dt/list-organisation-surveys";
import { organisationSurveyOpenHref } from "@/lib/dt/organisation-survey-open-href";
import { createClient } from "@/lib/supabase/server";
import {
  formatOrgDate,
  formatOrgRole,
  memberDisplayName,
  memberInitials,
} from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  OrgDetailSection,
  OrgOverviewPanel,
  orgDetailCardClass,
} from "@/app/dashboard/_components/organisations/org-overview-panel";
import { TeamActions } from "@/app/dashboard/_components/organisations/team-actions";
import { DeleteOrganisationButton } from "@/app/dashboard/_components/organisations/delete-organisation-button";
import { OrganisationEditNameForm } from "@/app/dashboard/_components/organisations/organisation-edit-name-form";
import { KickMemberButton } from "@/app/dashboard/_components/kick-member-button";
import { ResendInviteButton } from "@/app/dashboard/_components/resend-invite-button";
import { RevokeInviteButton } from "@/app/dashboard/_components/revoke-invite-button";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";

export function OrganisationDetailFallback() {
  return (
    <OrganisationPageShell>
      <div className="grid gap-3">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-muted/70" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
          <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
        </div>
      </div>
    </OrganisationPageShell>
  );
}

export async function OrganisationDetailView({
  organisationId,
}: {
  organisationId: string;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  const userId = user?.id;

  if (authError || !userId) {
    redirect("/auth/login");
  }

  const platformAdmin = await isPlatformAdmin(supabase, userId);

  const { data: membership } = await supabase
    .from("organisation_members")
    .select("org_role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  const myOrgRole = membership?.org_role ?? null;
  if (!myOrgRole && !platformAdmin) {
    notFound();
  }

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_user_id, created_at, archived_at")
    .eq("id", organisationId)
    .maybeSingle();

  if (!organisation || organisation.archived_at) {
    notFound();
  }

  let ownerEmail: string | null = null;
  if (organisation.owner_user_id) {
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", organisation.owner_user_id)
      .maybeSingle();
    ownerEmail = ownerProfile?.email ?? null;
  }

  const canManage =
    platformAdmin || myOrgRole === "owner" || myOrgRole === "admin";
  const canRenameOrganisation = platformAdmin || myOrgRole === "owner";
  const canTransferOwnership = myOrgRole === "owner" || platformAdmin;
  const canViewUsage = await canViewDtUsage(supabase, userId);
  const canViewSeoReports =
    platformAdmin || (await isOrgOwner(supabase, userId, organisationId));
  const canManageSeo = platformAdmin;

  const overview = await loadOrgOverview(organisationId, {
    includeUsage: canViewUsage,
    excludeSeoUsage: !platformAdmin,
  });

  const [
    { data: membersRaw, error: membersError },
    { data: invitesRaw, error: invitesError },
    surveys,
  ] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("user_id, org_role, created_at, profiles ( email )")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("organisation_invites")
      .select("id, email, org_role, status, created_at")
      .eq("organisation_id", organisationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    listSurveysForOrganisation({ organisationId }),
  ]);

  if (membersError || invitesError) {
    return (
      <OrganisationPageShell>
        <div className={cn(orgDetailCardClass, "p-5")}>
          <h2 className="text-sm font-semibold tracking-tight text-primary">Fehler</h2>
          <p className="mt-1 text-sm text-secondary">
            Organisationsdaten konnten nicht geladen werden. Bitte lade die Seite neu.
          </p>
          {platformAdmin ? (
            <div className="mt-3 grid gap-1 text-sm text-secondary">
              {membersError ? <p>Mitglieder: {membersError.message}</p> : null}
              {invitesError ? <p>Einladungen: {invitesError.message}</p> : null}
            </div>
          ) : null}
        </div>
      </OrganisationPageShell>
    );
  }

  const members = (membersRaw ?? []) as unknown as Array<{
    user_id: string;
    org_role: string;
    created_at: string;
    profiles?: { email: string } | Array<{ email: string }> | null;
  }>;

  const invites = (invitesRaw ?? []) as Array<{
    id: string;
    email: string;
    org_role: string;
    status: string;
    created_at: string;
  }>;

  const displayTitle = overview.config.displayName?.trim() || organisation.name;
  const showInternalName =
    overview.config.displayName?.trim() &&
    overview.config.displayName.trim() !== organisation.name;

  return (
    <OrganisationPageShell>
      <div className="grid gap-5">
        <div className={cn(orgDetailCardClass, "relative p-4 sm:p-5")}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">
                {displayTitle}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-secondary sm:text-sm">
                {showInternalName ? <span>{organisation.name}</span> : null}
                {organisation.slug ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {organisation.slug}
                  </Badge>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" aria-hidden />
                  {formatOrgDate(organisation.created_at)}
                </span>
                {ownerEmail ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                    <Crown className="size-3.5 shrink-0" aria-hidden />
                    {ownerEmail}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {platformAdmin && !membership ? (
                <Badge variant="outline">Plattform-Admin</Badge>
              ) : (
                <Badge variant="outline">{formatOrgRole(myOrgRole!)}</Badge>
              )}
              {overview.config.disabled ? (
                <Badge variant="destructive">Deaktiviert</Badge>
              ) : null}
              {overview.config.seoEnabled && canManageSeo ? (
                <Button
                  asChild
                  size="sm"
                  className="transition-transform duration-150 active:scale-[0.98]"
                >
                  <Link
                    href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(organisationId)}&tab=chat`}
                  >
                    SEO Modus
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <OrgOverviewPanel
          organisationId={organisationId}
          overview={overview}
          memberCount={members.length}
          pendingInviteCount={invites.length}
          canViewUsage={canViewUsage}
          canViewSeoReports={canViewSeoReports}
          canManageSeo={canManageSeo}
          canViewSeoAdvisor={platformAdmin}
          hideSeoCta
        />

        {canRenameOrganisation ? (
          <OrgDetailSection
            title="Name"
            description="Anzeigename ändern — der technische Slug bleibt der Schlüssel für SEO/n8n"
          >
            <div className={cn(orgDetailCardClass, "p-4 sm:p-5")}>
              <OrganisationEditNameForm
                organisationId={organisationId}
                name={organisation.name}
                displayName={overview.config.displayName}
                slug={organisation.slug}
              />
            </div>
          </OrgDetailSection>
        ) : null}

        <OrgDetailSection
          title="Fragebögen"
          description="Umfragen und Antworten dieser Organisation"
        >
          <div className={orgDetailCardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:bg-sbkm-mint/10 dark:text-sbkm-mint">
                  <ClipboardPenLine className="size-4" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">Fragebögen</h3>
                  <p className="text-xs text-secondary">
                    {surveys.length === 0
                      ? "Noch keine Umfragen zugeordnet"
                      : `${surveys.length} ${surveys.length === 1 ? "Fragebogen" : "Fragebögen"}`}
                  </p>
                </div>
              </div>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-8 text-xs font-semibold"
              >
                <Link href={`/dashboard/frageboegen?org=${encodeURIComponent(organisationId)}`}>
                  Alle Fragebögen
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
            <div className="p-2 sm:p-3">
              {surveys.length === 0 ? (
                <p className="px-2 py-3 text-sm text-secondary">
                  Sobald Fragebögen über Ordner, Titel oder Agenten verknüpft sind, erscheinen
                  sie hier — auch für Mitglieder.
                  {platformAdmin ? (
                    <>
                      {" "}
                      <Link
                        href="/dashboard/frageboegen?unassigned=1"
                        className="font-medium text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
                      >
                        Nicht zugeordnete Fragebögen anzeigen
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : (
                <ul className="divide-y divide-sbkm-navy/8 dark:divide-white/8">
                  {surveys.slice(0, 8).map((survey) => {
                    const href = organisationSurveyOpenHref(survey);
                    return (
                      <li key={survey.surveyId}>
                        <Link
                          href={href}
                          className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 transition-colors duration-150 hover:bg-sbkm-navy/[0.03] dark:hover:bg-white/[0.03]"
                        >
                          <span className="min-w-0 truncate text-sm font-medium">
                            {survey.title}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-sbkm-navy dark:text-sbkm-mint">
                            {href.startsWith("/s/") ? "Ausfüllen →" : "Öffnen →"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </OrgDetailSection>

        <OrgDetailSection
          title="Team"
          description="Mitglieder, Einladungen und Zugriff"
        >
          <div className={orgDetailCardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sbkm-mint/15 text-sbkm-navy dark:bg-sbkm-mint/10 dark:text-sbkm-mint">
                  <Users className="size-4" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">Mitglieder</h3>
                  <p className="text-xs text-secondary">
                    {members.length} aktiv
                    {invites.length > 0
                      ? ` · ${invites.length} Einladung${invites.length === 1 ? "" : "en"} offen`
                      : ""}
                  </p>
                </div>
              </div>
              {canManage ? (
                <TeamActions
                  organisationId={organisationId}
                  canTransferOwnership={canTransferOwnership}
                />
              ) : null}
            </div>
            <div className="p-2 sm:p-3">
              {members.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-4 dark:border-white/15">
                  <Users className="size-5 shrink-0 text-secondary" />
                  <div>
                    <p className="text-sm font-medium text-primary">Noch keine Mitglieder</p>
                    <p className="text-xs text-secondary">
                      Lade Kolleginnen und Kollegen per E-Mail ein.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-sbkm-navy/8 dark:divide-white/8">
                  {members.map((member) => {
                    const isSelf = member.user_id === userId;
                    const profileObj = Array.isArray(member.profiles)
                      ? (member.profiles[0] ?? null)
                      : (member.profiles ?? null);
                    const email = profileObj?.email ?? null;
                    const label = memberDisplayName(email);

                    const canKickThis = (() => {
                      if (!canManage) return false;
                      if (isSelf) return false;
                      if (member.org_role === "owner") return false;
                      if (platformAdmin) return true;
                      if (myOrgRole === "owner") return true;
                      if (myOrgRole === "admin") return member.org_role === "employee";
                      return false;
                    })();

                    return (
                      <li
                        key={member.user_id}
                        className="flex flex-wrap items-center justify-between gap-3 px-2 py-2.5 transition-colors duration-150 hover:bg-sbkm-navy/[0.03] dark:hover:bg-white/[0.03]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sbkm-navy/10 text-xs font-semibold text-sbkm-navy dark:bg-white/10 dark:text-white">
                            {memberInitials(email)}
                          </div>
                          <div className="min-w-0 grid gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{label}</span>
                              {isSelf ? <Badge variant="secondary">Du</Badge> : null}
                              <Badge variant="outline">{formatOrgRole(member.org_role)}</Badge>
                            </div>
                            <p className="text-xs text-secondary">
                              Seit {formatOrgDate(member.created_at)}
                            </p>
                          </div>
                        </div>
                        {canKickThis ? (
                          <KickMemberButton
                            organisationId={organisationId}
                            targetUserId={member.user_id}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {invites.length > 0 ? (
                <div className="mt-1 border-t border-sbkm-navy/8 pt-2 dark:border-white/8">
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-secondary">
                    Ausstehende Einladungen
                  </p>
                  <ul className="divide-y divide-sbkm-navy/8 dark:divide-white/8">
                    {invites.map((invite) => {
                      const canRevokeInvite = (() => {
                        if (platformAdmin) return true;
                        if (myOrgRole === "owner") return true;
                        if (myOrgRole === "admin") return invite.org_role === "employee";
                        return false;
                      })();

                      return (
                      <li
                        key={invite.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <Mail className="size-4" aria-hidden />
                          </div>
                          <div className="min-w-0 grid gap-0.5">
                            <span className="truncate text-sm font-medium">{invite.email}</span>
                            <p className="text-xs text-secondary">
                              {formatOrgRole(invite.org_role)} ·{" "}
                              {formatOrgDate(invite.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">Ausstehend</Badge>
                          {canRevokeInvite ? (
                            <>
                              <ResendInviteButton
                                organisationId={organisationId}
                                email={invite.email}
                              />
                              <RevokeInviteButton
                                inviteId={invite.id}
                                organisationId={organisationId}
                              />
                            </>
                          ) : null}
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </OrgDetailSection>

        {platformAdmin ? (
          <div
            className={cn(
              orgDetailCardClass,
              "border-red-200/80 p-4 sm:p-5 dark:border-red-500/30",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <h2 className="text-sm font-semibold tracking-tight text-primary">
                  Gefahrzone
                </h2>
                <p className="max-w-xl text-xs text-secondary sm:text-sm">
                  Organisation aus der Plattform-Übersicht entfernen. Erfordert zwei
                  Bestätigungen (Dialog + Namenseingabe). Nur Plattform-Admins.
                </p>
              </div>
              <DeleteOrganisationButton
                organisationId={organisationId}
                organisationName={organisation.name}
              />
            </div>
          </div>
        ) : null}
      </div>
    </OrganisationPageShell>
  );
}
