import Link from "next/link";
import { redirect } from "next/navigation";
import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
import { PlatformAdminTeamCard } from "@/app/dashboard/_components/platform-admin-team-card";
import { loadPlatformAdminTeam } from "@/lib/dashboard/platform-admin-team";
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

export default function AdminPlatformTeamPage() {
  return (
    <React.Suspense
      fallback={
        <OrganisationPageShell>
          <div className="grid gap-3">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
          </div>
        </OrganisationPageShell>
      }
    >
      <AdminPlatformTeamPageContent />
    </React.Suspense>
  );
}

async function AdminPlatformTeamPageContent() {
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

  if (profile?.role !== "admin") {
    redirect("/dashboard/inbox");
  }

  const members = await loadPlatformAdminTeam(supabase);

  return (
    <OrganisationPageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-secondary">
            <Link href="/dashboard/admin/organisations">
              <ArrowLeft className="size-4" aria-hidden />
              Zur Plattform-Übersicht
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Plattform-Team</h1>
          <p className="max-w-2xl text-sm text-secondary">
            Wer die Admin-Ansicht sieht: Verwaltung, SEO Modus, Jobs und E-Mails.
          </p>
        </div>
        <Badge>Plattform-Admin</Badge>
      </div>

      <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
        <CardHeader>
          <CardTitle className="tracking-tight">Admin-Ansicht vergeben</CardTitle>
          <CardDescription>
            Kolleginnen per E-Mail freischalten oder bestehende Konten umstellen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformAdminTeamCard members={members} currentUserId={userId} />
        </CardContent>
      </Card>
    </OrganisationPageShell>
  );
}
