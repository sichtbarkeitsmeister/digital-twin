"use client";

import { usePathname } from "next/navigation";

import { DashboardMobileNavTrigger } from "@/app/dashboard/_components/dashboard-mobile-nav";
import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { DashboardTopBarOrgSelector } from "@/components/dt/dashboard/dashboard-top-bar-org-selector";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";
import { ZumChatButton } from "@/components/zum-chat-button";
import { UserMenu } from "@/components/user-menu";
import { isDashboardOrgBarPath } from "@/lib/dt/seo/dashboard-path";

function TopBarActions() {
  return (
    <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 sm:gap-3 md:ml-0">
      <ZumChatButton compact className="shrink-0" />
      {/* Below sm the theme switch lives in the navigation drawer. */}
      <div className="hidden sm:block">
        <DtThemeToggle />
      </div>
      <UserMenu />
    </div>
  );
}

export function DashboardTopBar() {
  const pathname = usePathname();
  const showOrgBar = isDashboardOrgBarPath(pathname);

  return (
    <header className="sticky top-0 z-20 border-b border-sbkm-navy/[0.08] bg-white/45 px-3 py-3 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-8">
      {/* Below md the left group dissolves (`contents`) so the org selector wraps onto its own row. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 sm:gap-x-4 md:flex-nowrap md:justify-between md:gap-4">
        <div className="contents min-w-0 items-center gap-3 md:flex">
          <DashboardMobileNavTrigger />
          <DashboardLogoLink
            size="sidebar"
            className="h-6 max-w-[7.5rem] shrink-0 sm:max-w-none lg:hidden"
          />
          {showOrgBar ? (
            <div className="order-last min-w-0 basis-full md:order-none md:max-w-xl md:flex-1">
              <DashboardTopBarOrgSelector />
            </div>
          ) : null}
        </div>
        <TopBarActions />
      </div>
    </header>
  );
}
