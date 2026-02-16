import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
};

function formatOrgRole(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "employee") return "Employee";
  return role;
}

export default async function OrganisationsPage() {
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

  const { data: membershipsRaw, error: membershipsError } = await supabase
    .from("organisation_members")
    .select(
      "organisation_id, org_role, organisations ( id, name, slug, owner_user_id, created_at )"
    )
    .eq("user_id", userId);

  if (membershipsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Could not load organisations.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          {membershipsError.message}
        </CardContent>
      </Card>
    );
  }

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const organisationIds = memberships.map((m) => m.organisation_id);

  const pendingInvitesByOrg = new Map<string, InviteRow[]>();
  const memberCountByOrg = new Map<string, number>();

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
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Organisations
          </h1>
          <p className="text-secondary">
            Signed in as <span className="text-primary">{email}</span>
          </p>
        </div>
        <Badge variant="secondary">{memberships.length}</Badge>
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No organisations yet</CardTitle>
            <CardDescription>
              You’ll show up here once you’ve been invited.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-secondary">
            If you think this is a mistake, ask your organisation owner/admin
            for an invite.
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
                    {memberCount} member{memberCount === 1 ? "" : "s"}
                    {pendingInvites.length > 0
                      ? ` · ${pendingInvites.length} pending invite${
                          pendingInvites.length === 1 ? "" : "s"
                        }`
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
                        Pending invites
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
                            +{pendingInvites.length - 3} more
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-secondary">No pending invites.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

