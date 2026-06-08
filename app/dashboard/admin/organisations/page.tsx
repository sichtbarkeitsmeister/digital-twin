import Link from "next/link";
import { redirect } from "next/navigation";
import * as React from "react";
import { Building2, Mail, Sparkles, Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { AdminCreateOrgForm } from "@/app/dashboard/_components/admin-create-org-form";
import {
  AdminOrganisationList,
  type AdminOrganisationListItem,
} from "@/app/dashboard/_components/organisations/admin-organisation-list";
import { AdminOrganisationQuickLinks } from "@/app/dashboard/_components/organisations/admin-organisation-quick-links";
import { OrganisationPageShell } from "@/app/dashboard/_components/organisations/organisation-page-shell";
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
    <React.Suspense
      fallback={
        <OrganisationPageShell>
          <div className="grid gap-3">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
            <div className="grid gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl bg-muted/50"
                />
              ))}
            </div>
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

  const [
    { data: allOrganisationsRaw },
    { data: membersRaw },
    { data: invitesRaw },
  ] = await Promise.all([
    supabase
      .from("organisations")
      .select("id, name, slug, created_at, owner_user_id")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("organisation_members").select("organisation_id"),
    supabase
      .from("organisation_invites")
      .select("organisation_id")
      .eq("status", "pending"),
  ]);

  const allOrganisations = (allOrganisationsRaw ?? []) as Array<{
    id: string;
    name: string;
    slug: string | null;
    created_at: string;
    owner_user_id: string | null;
  }>;

  const memberCountByOrg = new Map<string, number>();
  for (const row of membersRaw ?? []) {
    memberCountByOrg.set(
      row.organisation_id,
      (memberCountByOrg.get(row.organisation_id) ?? 0) + 1,
    );
  }

  const pendingInviteCountByOrg = new Map<string, number>();
  for (const row of invitesRaw ?? []) {
    pendingInviteCountByOrg.set(
      row.organisation_id,
      (pendingInviteCountByOrg.get(row.organisation_id) ?? 0) + 1,
    );
  }

  const ownerIds = [
    ...new Set(
      allOrganisations
        .map((org) => org.owner_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const ownerEmailById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: ownerProfiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", ownerIds);

    for (const owner of ownerProfiles ?? []) {
      if (owner.email) {
        ownerEmailById.set(owner.id, owner.email);
      }
    }
  }

  const totalMembers = [...memberCountByOrg.values()].reduce(
    (sum, n) => sum + n,
    0,
  );
  const totalPendingInvites = invitesRaw?.length ?? 0;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const newOrgsCount = allOrganisations.filter(
    (org) => new Date(org.created_at).getTime() >= thirtyDaysAgo,
  ).length;
  const orgsWithoutOwner = allOrganisations.filter(
    (org) => !org.owner_user_id || !ownerEmailById.get(org.owner_user_id),
  ).length;

  const listItems: AdminOrganisationListItem[] = allOrganisations.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.created_at,
    memberCount: memberCountByOrg.get(org.id) ?? 0,
    pendingInviteCount: pendingInviteCountByOrg.get(org.id) ?? 0,
    ownerEmail: org.owner_user_id
      ? (ownerEmailById.get(org.owner_user_id) ?? null)
      : null,
  }));

  return (
    <OrganisationPageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Organisationen verwalten
          </h1>
          <p className="text-sm text-secondary">
            Plattform-Administration — anlegen, durchsuchen und Teams verwalten.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Plattform-Admin</Badge>
          <Badge variant="outline" className="tabular-nums">
            {allOrganisations.length} / 100
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Organisationen",
            value: allOrganisations.length,
            icon: Building2,
          },
          { label: "Mitglieder gesamt", value: totalMembers, icon: Users },
          {
            label: "Offene Einladungen",
            value: totalPendingInvites,
            icon: Mail,
          },
          {
            label: "Neu (30 Tage)",
            value: newOrgsCount,
            icon: Sparkles,
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

      {orgsWithoutOwner > 0 ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
          {orgsWithoutOwner} Organisation
          {orgsWithoutOwner === 1 ? "" : "en"} ohne hinterlegten Inhaber —
          prüfe die Einladung oder übertrage Ownership in der Detailansicht.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] xl:sticky xl:top-4 xl:self-start">
          <CardHeader>
            <CardTitle className="tracking-tight">
              Organisation anlegen
            </CardTitle>
            <CardDescription>
              Neue Organisation mit initialem Inhaber per E-Mail erstellen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminCreateOrgForm />
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
            Weitere Admin-Tools
          </p>
          <AdminOrganisationQuickLinks />
        </div>
      </div>

      <Card className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle className="tracking-tight">
                Alle Organisationen
              </CardTitle>
              <CardDescription>
                Neueste 100 Organisationen — sortiert nach Erstellungsdatum.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost" className="shrink-0">
              <Link href="/dashboard/admin/digital-twin">
                DigitalTwin-Übersicht
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <AdminOrganisationList organisations={listItems} />
        </CardContent>
      </Card>
    </OrganisationPageShell>
  );
}
