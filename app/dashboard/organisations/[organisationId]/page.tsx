import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, use } from "react";

import { createClient } from "@/lib/supabase/server";
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

function shortId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatOrgRole(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "employee") return "Employee";
  return role;
}

function OrganisationFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
          <CardDescription>Lade…</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          Inhalte werden geladen.
        </CardContent>
      </Card>
    </div>
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Fehler</CardTitle>
            <CardDescription>
              Konnte Organisationsdaten nicht laden.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-secondary">
            {membersError ? (
              <p>
                <span className="font-semibold">Members:</span>{" "}
                {membersError.message}
              </p>
            ) : null}
            {invitesError ? (
              <p>
                <span className="font-semibold">Invites:</span>{" "}
                {invitesError.message}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              className="text-sm text-secondary hover:text-primary transition-colors"
            >
              ← Back to dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">
              {organisation.name}
            </h1>
            <p className="text-secondary text-sm">
              Organisation ID:{" "}
              <span className="text-primary">{organisation.id}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPlatformAdmin ? (
              <Badge>Platform admin</Badge>
            ) : (
              <Badge variant="outline">{formatOrgRole(myOrgRole ?? "")}</Badge>
            )}
            {organisation.slug ? (
              <Badge variant="secondary">{organisation.slug}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} Mitglied{members.length === 1 ? "" : "er"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {members.length === 0 ? (
              <p className="text-sm text-secondary">Keine Mitglieder.</p>
            ) : (
              <div className="grid gap-2">
                {members.map((member) => {
                  const isSelf = member.user_id === userId;
                  const profileObj = Array.isArray(member.profiles)
                    ? member.profiles[0] ?? null
                    : member.profiles ?? null;
                  const label = profileObj?.email
                    ? profileObj.email
                    : `User ${shortId(member.user_id)}`;

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
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{label}</span>
                          {isSelf ? (
                            <Badge variant="secondary">You</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {formatOrgRole(member.org_role)}
                          </Badge>
                        </div>
                        <p className="text-xs text-secondary">
                          User-ID: {member.user_id}
                        </p>
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

        <Card>
          <CardHeader>
            <CardTitle>Invites</CardTitle>
            <CardDescription>{invites.length} ausstehend</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {invites.length === 0 ? (
              <p className="text-sm text-secondary">
                Keine ausstehenden Einladungen.
              </p>
            ) : (
              <div className="grid gap-2">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="grid gap-1">
                      <span className="text-sm font-medium">
                        {invite.email}
                      </span>
                      <p className="text-xs text-secondary">
                        Eingeladen als {formatOrgRole(invite.org_role)}
                      </p>
                    </div>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Invite member</CardTitle>
              <CardDescription>
                Einladungen werden sofort als Mitglied eingetragen, wenn die
                E-Mail bereits einen Account hat.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteMemberForm organisationId={organisationId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ownership</CardTitle>
              <CardDescription>
                Ownership kann nur vom Owner oder Plattform-Admin übertragen
                werden.
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
    </div>
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
