"use client";

import { usePathname } from "next/navigation";

import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { DashboardTopBarOrgSelector } from "@/components/dt/dashboard/dashboard-top-bar-org-selector";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";
import { ZumChatButton } from "@/components/zum-chat-button";
import { UserMenu } from "@/components/user-menu";
import { isDashboardOrgBarPath } from "@/lib/dt/seo/dashboard-path";

function TopBarActions() {
  return (
    <div className="flex items-center justify-end gap-2 sm:gap-3">
      <ZumChatButton compact className="shrink-0" />
      <DtThemeToggle />
      <UserMenu />
    </div>
  );
}

export function DashboardTopBar() {
  const pathname = usePathname();
  const showOrgBar = isDashboardOrgBarPath(pathname);

  return (
    <header className="sticky top-0 z-20 border-b border-sbkm-navy/[0.08] bg-white/45 px-5 py-3 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-8">
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <DashboardLogoLink size="sidebar" className="shrink-0 lg:hidden" />
          {showOrgBar ? (
            <div className="min-w-0 max-w-[min(100%,28rem)] flex-1 sm:max-w-xl">
              <DashboardTopBarOrgSelector />
            </div>
          ) : null}
        </div>
        <TopBarActions />
      </div>
    </header>
  );
}
