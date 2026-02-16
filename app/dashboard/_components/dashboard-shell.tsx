import type * as React from "react";

import { DashboardPrefetcher } from "@/app/dashboard/_components/dashboard-prefetcher";
import { DashboardSidebar } from "@/app/dashboard/_components/dashboard-sidebar";

export function DashboardShell({
  children,
  isPlatformAdmin,
}: {
  children: React.ReactNode;
  isPlatformAdmin: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="flex gap-6">
        <aside className="w-[280px] shrink-0">
          <div className="sticky top-6">
            <div className="rounded-lg border bg-card p-3">
              <DashboardSidebar isPlatformAdmin={isPlatformAdmin} />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="rounded-lg border bg-card p-5 sm:p-6">{children}</div>
        </main>
      </div>

      <DashboardPrefetcher isPlatformAdmin={isPlatformAdmin} />
    </div>
  );
}

