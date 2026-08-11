import * as React from "react";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { DashboardShell } from "@/app/dashboard/_components/dashboard-shell";
import { userCanManageAnyIntegrations, userHasAnyLeads } from "@/lib/dashboard/org-context";
import { userCanManageAnyDtAgents } from "@/lib/dt/org-access";
import { userCanViewAnyDtUsage } from "@/lib/dt/usage/access";
import { countPendingDtAgentEditRequests } from "@/lib/dt/agent-edit-requests";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-6 text-sm text-sbkm-ink-600">
          Lade…
        </div>
      }
    >
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </React.Suspense>
  );
}

async function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";

  // Run independent nav/permission checks in parallel. Admins skip redundant
  // profile lookups that the helpers would otherwise repeat.
  const [
    canManageIntegrations,
    canManageDtAgents,
    canViewDtUsage,
    showLeads,
    pendingSurveyQuestionsCount,
    pendingAgentEditRequestsCount,
  ] = await Promise.all([
    isPlatformAdmin ? Promise.resolve(true) : userCanManageAnyIntegrations(user.id),
    isPlatformAdmin ? Promise.resolve(true) : userCanManageAnyDtAgents(user.id),
    isPlatformAdmin ? Promise.resolve(true) : userCanViewAnyDtUsage(user.id),
    isPlatformAdmin ? Promise.resolve(true) : userHasAnyLeads(user.id),
    isPlatformAdmin
      ? supabase
          .from("survey_field_questions")
          .select("id", { count: "exact", head: true })
          .is("answer", null)
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
    isPlatformAdmin
      ? countPendingDtAgentEditRequests(supabase)
      : Promise.resolve(0),
  ]);

  return (
    <DashboardShell
      isPlatformAdmin={isPlatformAdmin}
      canManageIntegrations={canManageIntegrations}
      canManageDtAgents={canManageDtAgents}
      canViewDtUsage={canViewDtUsage}
      showLeads={showLeads}
      pendingSurveyQuestionsCount={pendingSurveyQuestionsCount}
      pendingAgentEditRequestsCount={pendingAgentEditRequestsCount}
    >
      {children}
    </DashboardShell>
  );
}
