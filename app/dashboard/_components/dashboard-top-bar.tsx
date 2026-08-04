"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Plus } from "lucide-react";

import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { DashboardTopBarOrgSelector } from "@/components/dt/dashboard/dashboard-top-bar-org-selector";
import { DtIconButton } from "@/components/dt/dt-icon-button";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";
import { ZumChatButton } from "@/components/zum-chat-button";
import { UserMenu } from "@/components/user-menu";
import { isDashboardOrgBarPath } from "@/lib/dt/seo/dashboard-path";

function TopBarActions() {
  return (
    <div className="flex items-center justify-end gap-2 sm:gap-3">
      <ZumChatButton compact className="shrink-0" />
      <DtIconButton aria-label="Benachrichtigungen" className="relative">
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} />
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-sbkm-mint" />
      </DtIconButton>
      <DtThemeToggle />
      <UserMenu />
      <DtPillButton asChild size="sm" className="hidden sm:inline-flex">
        <Link href="/dashboard/surveys/new">
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          Neuer Entwurf
        </Link>
      </DtPillButton>
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
            <div className="min-w-[10rem] max-w-xs sm:min-w-[12rem] sm:max-w-sm">
              <DashboardTopBarOrgSelector />
            </div>
          ) : null}
        </div>
        <TopBarActions />
      </div>
    </header>
  );
}
