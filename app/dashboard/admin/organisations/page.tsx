import Link from "next/link";
import { redirect } from "next/navigation";
import * as React from "react";

import { createClient } from "@/lib/supabase/server";

import { AdminCreateOrgForm } from "@/app/dashboard/_components/admin-create-org-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminOrganisationsPage() {
  return (
    <React.Suspense fallback={<p className="text-sm text-secondary">Lade…</p>}>
      <AdminOrganisationsPageContent />
    </React.Suspense>
  );
}

async function AdminOrganisationsPageContent() {
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
  if (!isPlatformAdmin) {
    redirect("/dashboard/inbox");
  }

  const { data: allOrganisationsRaw } = await supabase
    .from("organisations")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const allOrganisations = (allOrganisationsRaw ?? []) as Array<{
    id: string;
    name: string;
    slug: string | null;
    created_at: string;
  }>;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Manage organisations
          </h1>
          <p className="text-secondary">Platform admin tools.</p>
        </div>
        <Badge>Admin</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create organisation</CardTitle>
            <CardDescription>
              Create an organisation with an initial owner by email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminCreateOrgForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Umfragen</CardTitle>
            <CardDescription>Entwürfe erstellen, Umfragen veröffentlichen und Antworten ansehen.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-secondary">Entwürfe sind standardmäßig privat.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/surveys">Öffnen</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>All organisations</CardTitle>
              <CardDescription>
                {allOrganisations.length} organisation
                {allOrganisations.length === 1 ? "" : "s"} (latest 100)
              </CardDescription>
            </div>
            <Badge variant="secondary">{allOrganisations.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {allOrganisations.length === 0 ? (
            <p className="text-sm text-secondary">No organisations found.</p>
          ) : (
            <div className="grid gap-2">
              {allOrganisations.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="grid gap-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">
                      {org.name}
                    </p>
                    <p className="text-xs text-secondary truncate">
                      {org.slug ? `${org.slug} · ` : ""}
                      {org.id}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/organisations/${org.id}`}>Manage</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

