import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, Crown, Mail, Shield, UserPlus, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { formatOrgDate, formatOrgRole } from "@/lib/dashboard/organisation-ui";
import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { MemberListGrid } from "@/app/dashboard/_components/members/member-list-grid";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
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

type MembershipRow = {
  organisation_id: string;
  org_role: string;
  organisations?:
    | {
        id: string;
        name: string;
        slug: string | null;
        created_at: string;
      }
    | Array<{
        id: string;
        name: string;
        slug: string | null;
        created_at: string;
      }>
    | null;
};

function countByRole(members: Array<{ org_role: string }>, role: string) {
  return members.filter((m) => m.org_role === role).length;
}

export default async function MembersPage({
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

  const userId = user?.id;
  const userEmail = user?.email ?? "";
  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";

  const { data: membershipsRaw, error: membershipsError } = await supabase
    .from("organisation_members")
    .select(
      "organisation_id, org_role, organisations ( id, name, slug, created_at )",
    )
    .eq("user_id", userId);

  if (membershipsError) {
    return (
      <OrganisationPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>
              Organisationen konnten nicht geladen werden.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-secondary">
            {membershipsError.message}
          </CardContent>
        </Card>
      </OrganisationPageShell>
    );
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const organisations = memberships
    .map((m) => {
      const org = Array.isArray(m.organisations)
        ? (m.organisations[0] ?? null)
        : (m.organisations ?? null);
      return org
        ? {
            id: org.id,
            name: org.name,
            slug: org.slug,
            created_at: org.created_at,
          }
        : null;
    })
    .filter(
      (x): x is { id: string; name: string; slug: string | null; created_at: string } =>
        Boolean(x),
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const defaultOrgId = organisations[0]?.id ?? null;
  const selectedOrganisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : defaultOrgId;

  if (!selectedOrganisationId) {
    return (
      <OrganisationPageShell>
        <div className="grid gap-6">
          <div className="grid gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              Mitglieder
            </h1>
            <p className="text-sm text-secondary">
              Du bist noch in keiner Organisation.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <Users className="mx-auto mb-3 size-8 text-secondary" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-primary">
              Keine Organisation
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
              Sobald du eingeladen wirst, siehst du hier alle Mitglieder deiner
              Organisation.
            </p>
            <Button asChild variant="secondary" className="mt-6">
              <Link href="/dashboard/organisations">Organisationen ansehen</Link>
            </Button>
          </div>
        </div>
      </OrganisationPageShell>
    );
  }

  const myOrgRole =
    memberships.find((m) => m.organisation_id === selectedOrganisationId)
      ?.org_role ?? null;
  const canManage =
    isPlatformAdmin || myOrgRole === "owner" || myOrgRole === "admin";

  const [
    { data: membersRaw, error: membersError },
    { data: invitesRaw, error: invitesError },
  ] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("user_id, org_role, created_at, profiles ( email )")
      .eq("organisation_id", selectedOrganisationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("organisation_invites")
      .select("id, email, org_role, created_at")
      .eq("organisation_id", selectedOrganisationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  if (membersError || invitesError) {
    return (
      <OrganisationPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>Daten konnten nicht geladen werden.</CardDescription>
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
    created_at: string;
  }>;

  const selectedOrg = organisations.find((o) => o.id === selectedOrganisationId);
  const selectedOrgName = selectedOrg?.name ?? "Organisation";

  const memberItems = members.map((member) => {
    const profileObj = Array.isArray(member.profiles)
      ? (member.profiles[0] ?? null)
      : (member.profiles ?? null);

    return {
      userId: member.user_id,
      email: profileObj?.email ?? null,
      orgRole: member.org_role,
      createdAt: member.created_at,
      isSelf: member.user_id === userId,
    };
  });

  const ownerCount = countByRole(members, "owner");
  const adminCount = countByRole(members, "admin");
  const employeeCount = countByRole(members, "employee");

  return (
    <OrganisationPageShell>
      <Suspense fallback={null}>
        <PersistedOrganisationUrlSync
          allowedOrganisationIds={organisations.map((organisation) => organisation.id)}
        />
      </Suspense>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Mitglieder
          </h1>
          <p className="text-sm text-secondary">
            Team von{" "}
            <span className="font-medium text-primary">{selectedOrgName}</span>
            {selectedOrg?.slug ? (
              <span className="text-secondary"> · {selectedOrg.slug}</span>
            ) : null}
          </p>
          <p className="text-xs text-secondary">
            Angemeldet als {userEmail}
            {myOrgRole ? (
              <>
                {" "}
                · deine Rolle:{" "}
                <span className="font-medium text-primary">
                  {formatOrgRole(myOrgRole)}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <OrganisationSwitcher
            organisations={organisations.map(({ id, name }) => ({ id, name }))}
            selectedOrganisationId={selectedOrganisationId}
          />
          {canManage ? (
            <Button
              asChild
              size="sm"
              className="transition-transform duration-150 active:scale-[0.98]"
            >
              <Link href={`/dashboard/organisations/${selectedOrganisationId}`}>
                <UserPlus className="size-4" aria-hidden />
                Einladen & verwalten
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Mitglieder", value: members.length, icon: Users },
          { label: "Inhaber", value: ownerCount, icon: Crown },
          { label: "Admins", value: adminCount, icon: Shield },
          { label: "Offene Einladungen", value: invites.length, icon: Mail },
        ].map((stat) => (
          <div
            key={stat.label}
            className="relative overflow-hidden rounded-xl border border-border/80 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex items-center gap-3">
              <stat.icon className="size-4 text-secondary" aria-hidden />
              <div>
                <p className="text-xs text-secondary">{stat.label}</p>
                <p className="text-xl font-semibold tabular-nums tracking-tight text-primary">
                  {stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle className="tracking-tight">Team</CardTitle>
                <CardDescription>
                  {members.length} Mitglied{members.length === 1 ? "" : "er"}
                  {employeeCount > 0
                    ? ` · ${employeeCount} Mitarbeiter`
                    : ""}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {members.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <Users className="mx-auto mb-2 size-5 text-secondary" />
                <p className="text-sm font-medium text-primary">
                  Noch keine Mitglieder
                </p>
                <p className="mt-1 text-sm text-secondary">
                  {canManage
                    ? "Lade Kolleginnen und Kollegen per E-Mail ein."
                    : "Dein Admin kann neue Mitglieder einladen."}
                </p>
                {canManage ? (
                  <Button asChild size="sm" variant="secondary" className="mt-4">
                    <Link
                      href={`/dashboard/organisations/${selectedOrganisationId}`}
                    >
                      Mitglied einladen
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <MemberListGrid members={memberItems} />
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle className="tracking-tight">Einladungen</CardTitle>
                <CardDescription>
                  {invites.length} ausstehende Einladung
                  {invites.length === 1 ? "" : "en"}
                </CardDescription>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {invites.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {invites.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <Mail className="mx-auto mb-2 size-5 text-secondary" />
                <p className="text-sm font-medium text-primary">
                  Keine offenen Einladungen
                </p>
                <p className="mt-1 text-sm text-secondary">
                  Ausstehende Einladungen erscheinen hier, bis sie angenommen
                  werden.
                </p>
              </div>
            ) : (
              invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30"
                >
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium text-primary">
                      {invite.email}
                    </span>
                    <p className="text-xs text-secondary">
                      Als {formatOrgRole(invite.org_role)} ·{" "}
                      {formatOrgDate(invite.created_at)}
                    </p>
                  </div>
                  <Badge variant="secondary">Ausstehend</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </OrganisationPageShell>
  );
}
