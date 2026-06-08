import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, use } from "react";
import { Calendar, Crown, Mail, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  formatOrgDate,
  formatOrgRole,
  memberDisplayName,
  memberInitials,
} from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { InviteMemberForm } from "@/app/dashboard/_components/invite-member-form";
import { TransferOwnershipForm } from "@/app/dashboard/_components/transfer-ownership-form";
import { KickMemberButton } from "@/app/dashboard/_components/kick-member-button";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";

function OrganisationFallback() {
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

async function OrganisationContent({
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";

  let myOrgRole: string | null = null;
  if (!isPlatformAdmin) {
    const { data: membership } = await supabase
      .from("organisation_members")
      .select("org_role")
      .eq("organisation_id", organisationId)
      .eq("user_id", userId)
      .maybeSingle();

    myOrgRole = membership?.org_role ?? null;
    if (!myOrgRole) {
      notFound();
    }
  }

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name, slug, owner_user_id, created_at")
    .eq("id", organisationId)
    .maybeSingle();

  if (!organisation) {
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
    isPlatformAdmin || myOrgRole === "owner" || myOrgRole === "admin";
  const canTransferOwnership = isPlatformAdmin || myOrgRole === "owner";

  const [
    { data: membersRaw, error: membersError },
    { data: invitesRaw, error: invitesError },
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
  ]);

  if (membersError || invitesError) {
    return (
      <OrganisationPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>
              Organisationsdaten konnten nicht geladen werden.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-secondary">
            {membersError ? <p>Mitglieder: {membersError.message}</p> : null}
            {invitesError ? <p>Einladungen: {invitesError.message}</p> : null}
          </CardContent>
        </Card>
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

  return (
    <OrganisationPageShell>
      <div className="grid gap-4">
        <Link
          href="/dashboard/organisations"
          className="inline-flex w-fit text-sm text-secondary transition-colors duration-150 hover:text-primary"
        >
          ← Zurück zu Organisationen
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-primary">
              {organisation.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
              {organisation.slug ? (
                <span>{organisation.slug}</span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden />
                Erstellt {formatOrgDate(organisation.created_at)}
              </span>
              {ownerEmail ? (
                <span className="inline-flex items-center gap-1.5">
                  <Crown className="size-3.5" aria-hidden />
                  Inhaber: {ownerEmail}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPlatformAdmin ? (
              <Badge>Plattform-Admin</Badge>
            ) : (
              <Badge variant="outline">{formatOrgRole(myOrgRole ?? "")}</Badge>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex items-center gap-3">
              <Users className="size-4 text-secondary" aria-hidden />
              <div>
                <p className="text-xs text-secondary">Mitglieder</p>
                <p className="text-xl font-semibold tabular-nums tracking-tight">
                  {members.length}
                </p>
              </div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex items-center gap-3">
              <Mail className="size-4 text-secondary" aria-hidden />
              <div>
                <p className="text-xs text-secondary">Offene Einladungen</p>
                <p className="text-xl font-semibold tabular-nums tracking-tight">
                  {invites.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="tracking-tight">Mitglieder</CardTitle>
            <CardDescription>
              {members.length} Mitglied{members.length === 1 ? "" : "er"} in
              dieser Organisation
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {members.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                <Users className="mx-auto mb-2 size-5 text-secondary" />
                <p className="text-sm font-medium text-primary">
                  Noch keine Mitglieder
                </p>
                <p className="mt-1 text-sm text-secondary">
                  Lade Kolleginnen und Kollegen per E-Mail ein.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
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
                    if (isPlatformAdmin) return true;
                    if (myOrgRole === "owner") return true;
                    if (myOrgRole === "admin")
                      return member.org_role === "employee";
                    return false;
                  })();

                  return (
                    <div
                      key={member.user_id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {memberInitials(email)}
                        </div>
                        <div className="min-w-0 grid gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {label}
                            </span>
                            {isSelf ? (
                              <Badge variant="secondary">Du</Badge>
                            ) : null}
                            <Badge variant="outline">
                              {formatOrgRole(member.org_role)}
                            </Badge>
                          </div>
                          <p className="text-xs text-secondary">
                            Beigetreten {formatOrgDate(member.created_at)}
                          </p>
                        </div>
                      </div>

                      {canKickThis ? (
                        <KickMemberButton
                          organisationId={organisationId}
                          targetUserId={member.user_id}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="tracking-tight">Einladungen</CardTitle>
            <CardDescription>
              {invites.length} ausstehende Einladung
              {invites.length === 1 ? "" : "en"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {invites.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                <Mail className="mx-auto mb-2 size-5 text-secondary" />
                <p className="text-sm font-medium text-primary">
                  Keine offenen Einladungen
                </p>
                <p className="mt-1 text-sm text-secondary">
                  Neue Einladungen erscheinen hier, bis sie angenommen werden.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30"
                  >
                    <div className="grid gap-0.5">
                      <span className="text-sm font-medium">
                        {invite.email}
                      </span>
                      <p className="text-xs text-secondary">
                        Als {formatOrgRole(invite.org_role)} ·{" "}
                        {formatOrgDate(invite.created_at)}
                      </p>
                    </div>
                    <Badge variant="secondary">Ausstehend</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
            <CardHeader>
              <CardTitle className="tracking-tight">
                Mitglied einladen
              </CardTitle>
              <CardDescription>
                Einladungen werden sofort als Mitglied eingetragen, wenn die
                E-Mail bereits ein Konto hat.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm organisationId={organisationId} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
            <CardHeader>
              <CardTitle className="tracking-tight">Ownership</CardTitle>
              <CardDescription>
                Ownership kann nur vom Inhaber oder Plattform-Admin per
                E-Mail-Adresse übertragen werden.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {canTransferOwnership ? (
                <TransferOwnershipForm organisationId={organisationId} />
              ) : (
                <p className="text-sm text-secondary">
                  Du hast keine Berechtigung, Ownership zu übertragen.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </OrganisationPageShell>
  );
}

function OrganisationPageInner({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  const { organisationId } = use(params);
  return <OrganisationContent organisationId={organisationId} />;
}

export default function OrganisationPage({
  params,
}: {
  params: Promise<{ organisationId: string }>;
}) {
  return (
    <Suspense fallback={<OrganisationFallback />}>
      <OrganisationPageInner params={params} />
    </Suspense>
  );
}
