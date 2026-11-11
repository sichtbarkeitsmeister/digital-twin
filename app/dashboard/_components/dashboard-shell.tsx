import type * as React from "react";
import { Suspense } from "react";

import { DashboardPrefetcher } from "@/app/dashboard/_components/dashboard-prefetcher";
import { DashboardHeaderProvider } from "@/app/dashboard/_components/dashboard-header-slot";
import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { DashboardSidebar } from "@/app/dashboard/_components/dashboard-sidebar";
import {
  DashboardMobileNavDrawer,
  DashboardMobileNavProvider,
} from "@/app/dashboard/_components/dashboard-mobile-nav";
import { DashboardMainArea } from "@/app/dashboard/_components/dashboard-main-area";
import { DashboardTopBar } from "@/app/dashboard/_components/dashboard-top-bar";
import { DashboardStickySurveyAiAssistant } from "@/app/dashboard/_components/dashboard-sticky-survey-ai-assistant";
import { DtPageShell } from "@/components/dt/dt-page-shell";
import { OrganisationDocumentTitle } from "@/components/shared/organisation-document-title";

export function DashboardShell({
  children,
  isPlatformAdmin,
  canManageDtAgents,
  canViewDtUsage,
  pendingSurveyQuestionsCount,
  pendingAgentEditRequestsCount,
  pendingCompanyProfileEditsCount,
}: {
  children: React.ReactNode;
  isPlatformAdmin: boolean;
  canManageDtAgents?: boolean;
  canViewDtUsage?: boolean;
  pendingSurveyQuestionsCount?: number;
  pendingAgentEditRequestsCount?: number;
  pendingCompanyProfileEditsCount?: number;
}) {
  // One element for both the desktop aside and the mobile drawer.
  const sidebar = (
    <DashboardSidebar
      isPlatformAdmin={isPlatformAdmin}
      canManageDtAgents={canManageDtAgents ?? false}
      canViewDtUsage={canViewDtUsage ?? false}
      pendingSurveyQuestionsCount={pendingSurveyQuestionsCount ?? 0}
      pendingAgentEditRequestsCount={pendingAgentEditRequestsCount ?? 0}
      pendingCompanyProfileEditsCount={pendingCompanyProfileEditsCount ?? 0}
    />
  );

  return (
    <DtPageShell
      variant="dashboard"
      className="dt-touch-inputs min-h-screen supports-[height:100dvh]:min-h-dvh"
    >
      <DashboardMobileNavProvider>
      {/* dvh keeps the shell inside the visible area when mobile browser bars show; vh is the fallback. */}
      <div className="flex h-screen max-h-screen overflow-hidden supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh">
        <aside className="hidden w-[280px] shrink-0 border-r border-sbkm-navy/[0.08] bg-white/45 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="border-b border-sbkm-navy/[0.08] px-5 py-4 dark:border-white/10">
              <DashboardLogoLink size="sidebar" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 scrollbar-subtle">
              {sidebar}
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

      <DashboardMobileNavDrawer>{sidebar}</DashboardMobileNavDrawer>
      </DashboardMobileNavProvider>

      <DashboardPrefetcher isPlatformAdmin={isPlatformAdmin} />
      <OrganisationDocumentTitle />

      <Suspense fallback={null}>
        <DashboardStickySurveyAiAssistant />
      </Suspense>
    </DtPageShell>
  );
}
