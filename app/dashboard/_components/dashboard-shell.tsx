import type * as React from "react";
import { Suspense } from "react";

import { DashboardPrefetcher } from "@/app/dashboard/_components/dashboard-prefetcher";
import { DashboardHeaderProvider } from "@/app/dashboard/_components/dashboard-header-slot";
import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { DashboardSidebar } from "@/app/dashboard/_components/dashboard-sidebar";
import { DashboardMainArea } from "@/app/dashboard/_components/dashboard-main-area";
import { DashboardTopBar } from "@/app/dashboard/_components/dashboard-top-bar";
import { DashboardStickySurveyAiAssistant } from "@/app/dashboard/_components/dashboard-sticky-survey-ai-assistant";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export function DashboardShell({
  children,
  isPlatformAdmin,
  canManageIntegrations,
  canManageDtAgents,
  canViewDtUsage,
  showLeads,
  showFrageboegen,
  pendingSurveyQuestionsCount,
  pendingAgentEditRequestsCount,
}: {
  children: React.ReactNode;
  isPlatformAdmin: boolean;
  canManageIntegrations: boolean;
  canManageDtAgents?: boolean;
  canViewDtUsage?: boolean;
  showLeads?: boolean;
  showFrageboegen?: boolean;
  pendingSurveyQuestionsCount?: number;
  pendingAgentEditRequestsCount?: number;
}) {
  return (
    <DtPageShell variant="dashboard" className="min-h-screen">
      <div className="flex h-screen max-h-screen overflow-hidden">
        <aside className="hidden w-[280px] shrink-0 border-r border-sbkm-navy/[0.08] bg-white/45 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="border-b border-sbkm-navy/[0.08] px-5 py-4 dark:border-white/10">
              <DashboardLogoLink size="sidebar" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 scrollbar-subtle">
              <DashboardSidebar
                isPlatformAdmin={isPlatformAdmin}
                canManageIntegrations={canManageIntegrations}
                canManageDtAgents={canManageDtAgents ?? false}
                canViewDtUsage={canViewDtUsage ?? false}
                showLeads={showLeads ?? false}
                showFrageboegen={showFrageboegen ?? false}
                pendingSurveyQuestionsCount={pendingSurveyQuestionsCount ?? 0}
                pendingAgentEditRequestsCount={pendingAgentEditRequestsCount ?? 0}
              />
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DashboardHeaderProvider>
            <DashboardTopBar />
            <DashboardMainArea>{children}</DashboardMainArea>
          </DashboardHeaderProvider>
        </div>
      </div>

      <DashboardPrefetcher isPlatformAdmin={isPlatformAdmin} />

      {isPlatformAdmin ? (
        <Suspense fallback={null}>
          <DashboardStickySurveyAiAssistant />
        </Suspense>
      ) : null}
    </DtPageShell>
  );
}
