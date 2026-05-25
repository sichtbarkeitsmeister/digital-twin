"use client";

import Link from "next/link";
import { Bell, Plus, Search } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtIconButton } from "@/components/dt/dt-icon-button";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";
import { UserMenu } from "@/components/user-menu";

export function DashboardTopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-sbkm-navy/[0.08] bg-white/45 px-5 py-3 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-8">
      <div className="flex items-center justify-between gap-4">
        <DtLogo href="/dashboard" size="sidebar" className="shrink-0 lg:hidden" />

        <div className="relative hidden min-w-0 flex-1 sm:block sm:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sbkm-ink-500" />
          <input
            type="search"
            placeholder="Suche in Pipeline, Beiträgen, Teams …"
            className="w-full rounded-pill border border-sbkm-navy/15 bg-white/80 py-2.5 pl-10 pr-4 text-sm text-sbkm-navy outline-none transition-[border-color,box-shadow] placeholder:text-sbkm-ink-500 focus:border-sbkm-navy focus:shadow-dt-focus dark:border-white/15 dark:bg-white/10 dark:text-white dark:focus:border-sbkm-mint"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
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
      </div>
    </header>
  );
}

export function DashboardHero({
  title = "Guten Morgen.",
  subtitle = "3 Beiträge warten auf Freigabe — dein Zwilling hat die Markenstimme-Checks schon vorbereitet.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <DtGlassCard variant="subtle" padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-sbkm-mint-700 dark:text-sbkm-mint">
          Übersicht
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-sbkm-navy dark:text-white sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
          {subtitle}
        </p>
      </div>
      <DtPillButton asChild size="sm" className="w-full sm:w-auto">
        <Link href="/dashboard/inbox">Posteingang öffnen</Link>
      </DtPillButton>
    </DtGlassCard>
  );
}
