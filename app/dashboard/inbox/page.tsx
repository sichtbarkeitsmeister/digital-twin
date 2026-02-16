import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { acceptOrganisationInviteAction } from "@/app/dashboard/actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export default async function InboxPage() {
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
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Could not load inbox.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-secondary">
          {inboxError.message}
        </CardContent>
      </Card>
    );
  }

  const inboxInvites = (inboxInvitesRaw ?? []) as unknown as InviteRow[];

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Inbox
          </h1>
          <p className="text-secondary">
            Signed in as <span className="text-primary">{email}</span>
          </p>
        </div>
      </div>

      <section className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-primary">
            Invites
          </h2>
          <Badge variant="secondary">{inboxInvites.length}</Badge>
        </div>

        {inboxInvites.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No invites</CardTitle>
              <CardDescription>
                Invitations you can accept will appear here.
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
                      Invited as {formatOrgRole(invite.org_role)}
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
    </div>
  );
}

