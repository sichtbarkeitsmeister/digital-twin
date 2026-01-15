import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AdminCreateOrgForm } from "@/app/dashboard/_components/admin-create-org-form";
import { acceptOrganisationInviteAction } from "@/app/dashboard/actions";

type MembershipRow = {
  organisation_id: string;
  org_role: "owner" | "admin" | "employee" | string;
  organisations?:
    | {
        id: string;
        name: string;
        slug: string | null;
        owner_user_id: string | null;
        created_at: string;
      }
    | Array<{
        id: string;
        name: string;
        slug: string | null;
        owner_user_id: string | null;
        created_at: string;
      }>
    | null;
};

type InviteRow = {
  id: string;
  organisation_id: string;
  email: string;
  org_role: "owner" | "admin" | "employee" | string;
  status: "pending" | "accepted" | "revoked" | string;
  created_at: string;
  organisations?:
    | { id: string; name: string; slug: string | null }
    | Array<{ id: string; name: string; slug: string | null }>
    | null;
};

function formatOrgRole(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "employee") return "Employee";
  return role;
}

function DashboardFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-secondary">Lade…</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deine Organisationen</CardTitle>
          <CardDescription>Bitte warten…</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          Inhalte werden geladen.
        </CardContent>
      </Card>
    </div>
  );
}

async function DashboardContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  const email = user?.email ?? "";

  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>
              Konnte dein Profil nicht laden (RLS / Policy).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-secondary">
            {profileError.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPlatformAdmin = profile?.role === "admin";

  const inboxEmail = email.trim().toLowerCase();
  const { data: inboxInvitesRaw, error: inboxError } = await supabase
    .from("organisation_invites")
    .select(
      "id, organisation_id, email, org_role, status, created_at, organisations ( id, name, slug )"
    )
    .eq("status", "pending")
    .eq("email", inboxEmail)
    .order("created_at", { ascending: false });

  if (inboxError) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>Konnte Inbox nicht laden.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-secondary">
            {inboxError.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  const inboxInvites = (inboxInvitesRaw ?? []) as unknown as InviteRow[];

  const { data: membershipsRaw, error: membershipsError } = await supabase
    .from("organisation_members")
    .select(
      "organisation_id, org_role, organisations ( id, name, slug, owner_user_id, created_at )"
    )
    .eq("user_id", userId);

  if (membershipsError) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-secondary">
            Wir konnten deine Organisationen nicht laden.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>Bitte versuche es später erneut.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-secondary">
            {membershipsError.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const organisationIds = memberships.map((m) => m.organisation_id);

  const pendingInvitesByOrg = new Map<string, InviteRow[]>();
  const memberCountByOrg = new Map<string, number>();

  let allOrganisationsRaw: unknown[] = [];
  if (isPlatformAdmin) {
    const { data } = await supabase
      .from("organisations")
      .select("id, name, slug, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    allOrganisationsRaw = (data ?? []) as unknown[];
  }

  const allOrganisations = (allOrganisationsRaw ?? []) as Array<{
    id: string;
    name: string;
    slug: string | null;
    created_at: string;
  }>;

  if (organisationIds.length > 0) {
    const [{ data: invitesRaw }, { data: membersRaw }] = await Promise.all([
      supabase
        .from("organisation_invites")
        .select("id, organisation_id, email, org_role, status, created_at")
        .in("organisation_id", organisationIds)
        .eq("status", "pending"),
      supabase
        .from("organisation_members")
        .select("organisation_id, user_id")
        .in("organisation_id", organisationIds),
    ]);

    const invites = (invitesRaw ?? []) as InviteRow[];
    for (const invite of invites) {
      const list = pendingInvitesByOrg.get(invite.organisation_id) ?? [];
      list.push(invite);
      pendingInvitesByOrg.set(invite.organisation_id, list);
    }

    const members = (membersRaw ?? []) as Array<{
      organisation_id: string;
      user_id: string;
    }>;
    for (const member of members) {
      memberCountByOrg.set(
        member.organisation_id,
        (memberCountByOrg.get(member.organisation_id) ?? 0) + 1
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-secondary">
            Angemeldet als <span className="text-primary">{email}</span>
          </p>
        </div>
      </div>

      <section className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
          <Badge variant="secondary">{inboxInvites.length}</Badge>
        </div>

        {inboxInvites.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Keine Einladungen</CardTitle>
              <CardDescription>
                Hier erscheinen Einladungen, die du annehmen kannst.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3">
            {inboxInvites.map((invite) => {
              const org = Array.isArray(invite.organisations)
                ? invite.organisations[0] ?? null
                : invite.organisations ?? null;

              return (
                <Card key={invite.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {org?.name ?? "Organisation"}
                      </CardTitle>
                      <Badge variant="outline">
                        {formatOrgRole(invite.org_role)}
                      </Badge>
                    </div>
                    <CardDescription>
                      {org?.slug ? `${org.slug} · ` : ""}
                      Eingeladen als {formatOrgRole(invite.org_role)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-secondary">
                      Invite for{" "}
                      <span className="text-primary">{invite.email}</span>
                    </p>
                    <form action={acceptOrganisationInviteAction}>
                      <input type="hidden" name="invite_id" value={invite.id} />
                      <Button type="submit" size="sm">
                        Accept
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <section className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Deine Organisationen
          </h2>
          <Badge variant="secondary">{memberships.length}</Badge>
        </div>

        {memberships.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Noch keine Organisation</CardTitle>
              <CardDescription>
                Du wirst einer Organisation hinzugefügt, sobald du eingeladen
                wurdest.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-secondary">
              Wenn du denkst, das ist ein Fehler, bitte den Owner oder Admin
              deiner Organisation um eine Einladung.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {memberships.map((membership) => {
              const org = Array.isArray(membership.organisations)
                ? membership.organisations[0] ?? null
                : membership.organisations ?? null;
              const pendingInvites =
                pendingInvitesByOrg.get(membership.organisation_id) ?? [];
              const memberCount =
                memberCountByOrg.get(membership.organisation_id) ?? 0;

              return (
                <Card key={membership.organisation_id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {org?.name ?? "Organisation"}
                      </CardTitle>
                      <Badge variant="outline">
                        {formatOrgRole(membership.org_role)}
                      </Badge>
                    </div>
                    <CardDescription>
                      {memberCount} Mitglied{memberCount === 1 ? "" : "er"}
                      {pendingInvites.length > 0
                        ? ` · ${pendingInvites.length} Einladung${
                            pendingInvites.length === 1 ? "" : "en"
                          } ausstehend`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <Button asChild variant="secondary" size="sm">
                        <Link
                          href={`/dashboard/organisations/${membership.organisation_id}`}
                        >
                          Open
                        </Link>
                      </Button>
                    </div>
                    {pendingInvites.length > 0 ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                          Ausstehende Einladungen
                        </p>
                        <div className="grid gap-2">
                          {pendingInvites.slice(0, 3).map((invite) => (
                            <div
                              key={invite.id}
                              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                            >
                              <span className="truncate">{invite.email}</span>
                              <Badge variant="secondary">
                                {formatOrgRole(invite.org_role)}
                              </Badge>
                            </div>
                          ))}
                          {pendingInvites.length > 3 ? (
                            <p className="text-xs text-secondary">
                              +{pendingInvites.length - 3} weitere
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-secondary">
                        Keine ausstehenden Einladungen.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      {isPlatformAdmin ? (
        <section className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Admin</h2>
            <Badge>Platform</Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Create organisation</CardTitle>
                <CardDescription>
                  Erstellt eine Organisation mit initialem Owner per E-Mail.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdminCreateOrgForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>All organisations</CardTitle>
                <CardDescription>
                  {allOrganisations.length} Organisation
                  {allOrganisations.length === 1 ? "" : "en"} (letzte 100)
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {allOrganisations.length === 0 ? (
                  <p className="text-sm text-secondary">
                    Noch keine Organisationen vorhanden.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {allOrganisations.map((org) => (
                      <div
                        key={org.id}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <div className="grid gap-1">
                          <p className="text-sm font-medium">{org.name}</p>
                          <p className="text-xs text-secondary">
                            {org.slug ? `${org.slug} · ` : ""}
                            {org.id}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/dashboard/organisations/${org.id}`}>
                            Manage
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardContent />
    </Suspense>
  );
}
