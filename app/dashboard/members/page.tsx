import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { OrganisationSwitcher } from "@/app/dashboard/_components/organisation-switcher";
import { Badge } from "@/components/ui/badge";
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
        created_at: string;
      }
    | Array<{
        id: string;
        name: string;
        created_at: string;
      }>
    | null;
};

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
  if (authError || !userId) {
    redirect("/auth/login");
  }

  const { data: membershipsRaw, error: membershipsError } = await supabase
    .from("organisation_members")
    .select("organisation_id, org_role, organisations ( id, name, created_at )")
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
  const organisations = memberships
    .map((m) => {
      const org = Array.isArray(m.organisations)
        ? m.organisations[0] ?? null
        : m.organisations ?? null;
      return org ? { id: org.id, name: org.name, created_at: org.created_at } : null;
    })
    .filter((x): x is { id: string; name: string; created_at: string } => Boolean(x))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const defaultOrgId = organisations[0]?.id ?? null;
  const selectedOrganisationId =
    orgParam && organisations.some((o) => o.id === orgParam)
      ? orgParam
      : defaultOrgId;

  if (!selectedOrganisationId) {
    return (
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              Members
            </h1>
            <p className="text-secondary">
              You’re not part of any organisation yet.
            </p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>No organisations</CardTitle>
            <CardDescription>
              Join an organisation to view its members.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { data: membersRaw, error: membersError } = await supabase
    .from("organisation_members")
    .select("user_id, org_role, created_at, profiles ( email )")
    .eq("organisation_id", selectedOrganisationId)
    .order("created_at", { ascending: true });

  if (membersError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Could not load members.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          {membersError.message}
        </CardContent>
      </Card>
    );
  }

  const members = (membersRaw ?? []) as unknown as Array<{
    user_id: string;
    org_role: string;
    created_at: string;
    profiles?: { email: string } | Array<{ email: string }> | null;
  }>;

  const selectedOrgName =
    organisations.find((o) => o.id === selectedOrganisationId)?.name ??
    "Organisation";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Members
          </h1>
          <p className="text-secondary">
            Showing members for{" "}
            <span className="text-primary">{selectedOrgName}</span>
          </p>
        </div>

        <OrganisationSwitcher
          organisations={organisations.map(({ id, name }) => ({ id, name }))}
          selectedOrganisationId={selectedOrganisationId}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Organisation members</CardTitle>
              <CardDescription>
                {members.length} member{members.length === 1 ? "" : "s"}
              </CardDescription>
            </div>
            <Badge variant="secondary">{members.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {members.length === 0 ? (
            <p className="text-sm text-secondary">No members found.</p>
          ) : (
            <div className="grid gap-2">
              {members.map((member) => {
                const profileObj = Array.isArray(member.profiles)
                  ? member.profiles[0] ?? null
                  : member.profiles ?? null;
                const label = profileObj?.email
                  ? profileObj.email
                  : `User ${shortId(member.user_id)}`;

                return (
                  <div
                    key={member.user_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="grid gap-1">
                      <p className="text-sm font-medium text-primary">{label}</p>
                      <p className="text-xs text-secondary">
                        User-ID: {member.user_id}
                      </p>
                    </div>
                    <Badge variant="outline">{formatOrgRole(member.org_role)}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

