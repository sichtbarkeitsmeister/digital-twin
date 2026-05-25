import type * as React from "react";

import { DashboardPrefetcher } from "@/app/dashboard/_components/dashboard-prefetcher";
import { DashboardSidebar } from "@/app/dashboard/_components/dashboard-sidebar";
import { DashboardHero, DashboardTopBar } from "@/app/dashboard/_components/dashboard-top-bar";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtPageShell } from "@/components/dt/dt-page-shell";

export function DashboardShell({
  children,
  isPlatformAdmin,
  canManageIntegrations,
  pendingSurveyQuestionsCount,
}: {
  children: React.ReactNode;
  isPlatformAdmin: boolean;
  canManageIntegrations: boolean;
  pendingSurveyQuestionsCount?: number;
}) {
  return (
    <DtPageShell variant="dashboard" className="min-h-screen">
      <div className="flex min-h-screen">
        <aside className="hidden w-[280px] shrink-0 border-r border-sbkm-navy/[0.08] bg-white/45 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="border-b border-sbkm-navy/[0.08] px-5 py-4 dark:border-white/10">
              <DtLogo href="/dashboard" size="sidebar" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 scrollbar-subtle">
              <DashboardSidebar
                isPlatformAdmin={isPlatformAdmin}
                canManageIntegrations={canManageIntegrations}
                pendingSurveyQuestionsCount={pendingSurveyQuestionsCount ?? 0}
              />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopBar />

          <div className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-7">
            <DashboardHero />
            <div className="rounded-dt border border-sbkm-navy/10 bg-white/55 p-5 shadow-dt backdrop-blur-[32px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-white/[0.06] sm:p-6">
              {children}
            </div>

            <footer className="flex flex-col gap-2 border-t border-sbkm-navy/[0.08] pt-6 text-xs text-sbkm-ink-600 dark:border-white/10 dark:text-white/50 sm:flex-row sm:items-center sm:justify-between">
              <span>© DigitalTwin · planbar, messbar, ohne Blackbox.</span>
              <span>
                Powered by <strong className="text-sbkm-navy dark:text-white">sbkm.</strong>
              </span>
            </footer>
          </div>
        </div>
      </div>

      <DashboardPrefetcher isPlatformAdmin={isPlatformAdmin} />
    </DtPageShell>
  );
}
