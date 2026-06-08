import type * as React from "react";

import { DashboardPrefetcher } from "@/app/dashboard/_components/dashboard-prefetcher";
import { DashboardSidebar } from "@/app/dashboard/_components/dashboard-sidebar";
import { DashboardMainArea } from "@/app/dashboard/_components/dashboard-main-area";
import { DashboardTopBar } from "@/app/dashboard/_components/dashboard-top-bar";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export function DashboardShell({
  children,
  isPlatformAdmin,
  canManageIntegrations,
  canAccessDtSeo,
  canManageDtAgents,
  pendingSurveyQuestionsCount,
}: {
  children: React.ReactNode;
  isPlatformAdmin: boolean;
  canManageIntegrations: boolean;
  canAccessDtSeo?: boolean;
  canManageDtAgents?: boolean;
  pendingSurveyQuestionsCount?: number;
}) {
  return (
    <DtPageShell variant="dashboard" className="min-h-screen">
      <div className="flex h-screen max-h-screen overflow-hidden">
        <aside className="hidden w-[280px] shrink-0 border-r border-sbkm-navy/[0.08] bg-white/45 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="border-b border-sbkm-navy/[0.08] px-5 py-4 dark:border-white/10">
              <DtLogo href="/dashboard" size="sidebar" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 scrollbar-subtle">
              <DashboardSidebar
                isPlatformAdmin={isPlatformAdmin}
                canManageIntegrations={canManageIntegrations}
                canAccessDtSeo={canAccessDtSeo ?? false}
                canManageDtAgents={canManageDtAgents ?? false}
                pendingSurveyQuestionsCount={pendingSurveyQuestionsCount ?? 0}
              />
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DashboardTopBar />

          <DashboardMainArea>{children}</DashboardMainArea>
        </div>
      </div>

      <DashboardPrefetcher isPlatformAdmin={isPlatformAdmin} />
    </DtPageShell>
  );
}
