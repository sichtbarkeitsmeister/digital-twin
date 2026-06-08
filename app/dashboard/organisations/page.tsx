import { redirect } from "next/navigation";
import { Building2, Mail, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { OrganisationEmptyState } from "@/app/dashboard/_components/organisations/organisation-empty-state";
import {
  OrganisationListGrid,
  type OrganisationListItem,
} from "@/app/dashboard/_components/organisations/organisation-list-grid";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";

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
      "organisation_id, org_role, organisations ( id, name, slug, owner_user_id, created_at )",
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
        (memberCountByOrg.get(member.organisation_id) ?? 0) + 1,
      );
    }
  }

  const totalMembers = [...memberCountByOrg.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const totalPendingInvites = [...pendingInvitesByOrg.values()].reduce(
    (sum, invites) => sum + invites.length,
    0,
  );

  const listItems: OrganisationListItem[] = memberships.map((membership) => {
    const org = Array.isArray(membership.organisations)
      ? (membership.organisations[0] ?? null)
      : (membership.organisations ?? null);
    const pendingInvites =
      pendingInvitesByOrg.get(membership.organisation_id) ?? [];

    return {
      organisationId: membership.organisation_id,
      name: org?.name ?? "Organisation",
      slug: org?.slug ?? null,
      orgRole: membership.org_role,
      memberCount: memberCountByOrg.get(membership.organisation_id) ?? 0,
      pendingInviteCount: pendingInvites.length,
      createdAt: org?.created_at ?? "",
      pendingInvites: pendingInvites.map((invite) => ({
        email: invite.email,
        orgRole: invite.org_role,
      })),
    };
  });

  return (
    <OrganisationPageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Organisationen
          </h1>
          <p className="text-sm text-secondary">
            Angemeldet als{" "}
            <span className="font-medium text-primary">{email}</span>
          </p>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {memberships.length} Organisation
          {memberships.length === 1 ? "" : "en"}
        </Badge>
      </div>

      {memberships.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              label: "Organisationen",
              value: memberships.length,
              icon: Building2,
            },
            { label: "Mitglieder gesamt", value: totalMembers, icon: Users },
            {
              label: "Offene Einladungen",
              value: totalPendingInvites,
              icon: Mail,
            },
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
      ) : null}

      {memberships.length === 0 ? (
        <OrganisationEmptyState />
      ) : (
        <OrganisationListGrid organisations={listItems} />
      )}
    </OrganisationPageShell>
  );
}
