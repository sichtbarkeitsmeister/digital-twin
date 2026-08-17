import Link from "next/link";
import { redirect } from "next/navigation";
import * as React from "react";
import { ClipboardPenLine, Workflow } from "lucide-react";

import { AdminCreateOrgForm } from "@/app/dashboard/_components/admin-create-org-form";
import { PlatformAdminOrgHub } from "@/app/dashboard/_components/organisations/platform-admin-org-hub";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { loadPlatformAdminOverview } from "@/lib/dashboard/platform-admin-overview";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminOrganisationsPage() {
  return (
    <React.Suspense
      fallback={
        <OrganisationPageShell>
          <div className="grid gap-3">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted/50" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
          </div>
        </OrganisationPageShell>
      }
    >
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

  const { organisations, stats } = await loadPlatformAdminOverview();

  return (
    <OrganisationPageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Plattform-Übersicht
          </h1>
          <p className="max-w-2xl text-sm text-secondary">
            Organisationen, SEO und Teams auf einen Blick — anlegen, filtern und direkt öffnen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Plattform-Admin</Badge>
          <Badge variant="outline" className="tabular-nums">
            {stats.totalOrgs} / 100
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="grid gap-4 xl:sticky xl:top-4 xl:self-start">
          <Card
            id="organisation-anlegen"
            className="overflow-hidden scroll-mt-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]"
          >
              <CardDescription>
                Neue Organisation mit initialem Inhaber per E-Mail erstellen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AdminCreateOrgForm />
            </CardContent>
          </Card>

          <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base tracking-tight">Weitere Tools</CardTitle>
              <CardDescription className="text-xs">
                Umfragen, Jobs und Agent-Anfragen.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button asChild size="sm" variant="outline" className="justify-start gap-2">
                <Link href="/dashboard/surveys">
                  <ClipboardPenLine className="size-4" aria-hidden />
                  Umfragen
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="justify-start gap-2">
                <Link href="/dashboard/admin/jobs">
                  <Workflow className="size-4" aria-hidden />
                  Jobs runner
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="justify-start gap-2">
                <Link href="/dashboard/admin/agent-requests">
                  Agent-Anfragen
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
          <CardHeader>
            <CardTitle className="tracking-tight">Alle Organisationen</CardTitle>
            <CardDescription>
              SEO, Agenten und Team-Status — filterbar und durchsuchbar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlatformAdminOrgHub organisations={organisations} stats={stats} />
          </CardContent>
        </Card>
      </div>
    </OrganisationPageShell>
  );
}
