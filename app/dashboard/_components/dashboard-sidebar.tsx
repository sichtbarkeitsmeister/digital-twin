"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Bot,
  ClipboardList,
  ClipboardPenLine,
  FileSearch,
  Inbox,
  Plug,
  Shield,
  Sparkles,
  Workflow,
  Mail,
} from "lucide-react";

import { ZumChatButton } from "@/components/zum-chat-button";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
  showDot?: boolean;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = item.match ? item.match(pathname) : isActivePath(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sbkm-navy text-white shadow-dt dark:bg-sbkm-mint dark:text-sbkm-navy"
          : "text-sbkm-ink-700 hover:bg-sbkm-navy/[0.06] dark:text-white/75 dark:hover:bg-white/10",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-sbkm-mint dark:text-sbkm-navy" : "text-sbkm-ink-500 dark:text-white/60",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.showDot ? (
        <span
          aria-label="Neue Aktivität"
          className={cn(
            "ml-auto h-2 w-2 rounded-full",
            active ? "bg-sbkm-mint dark:bg-sbkm-navy" : "bg-red-500",
          )}
        />
      ) : null}
    </Link>
  );
}

export function DashboardSidebar({
  isPlatformAdmin,
  canManageIntegrations,
  canManageDtAgents,
  canViewDtUsage,
  showLeads,
  pendingSurveyQuestionsCount,
  pendingAgentEditRequestsCount,
}: {
  isPlatformAdmin: boolean;
  canManageIntegrations: boolean;
  canManageDtAgents: boolean;
  canViewDtUsage: boolean;
  showLeads: boolean;
  pendingSurveyQuestionsCount: number;
  pendingAgentEditRequestsCount: number;
}) {
  const mainItems: NavItem[] = [
    { label: "Posteingang", href: "/dashboard/inbox", icon: Inbox },
    ...(showLeads ? [{ label: "Leads", href: "/dashboard/leads", icon: Sparkles }] : []),
    { label: "Organisation", href: "/dashboard/organisations", icon: Building2 },
    ...(canManageIntegrations
      ? [{ label: "Integrationen", href: "/dashboard/integrations", icon: Plug }]
      : []),
  ];

  const verwaltungItems: NavItem[] = [
    ...(canManageDtAgents
      ? [
          {
            label: "Agenten",
            href: "/dashboard/verwaltung/agents",
            icon: Bot,
            match: (pathname: string) =>
              pathname.startsWith("/dashboard/verwaltung/agents") ||
              pathname.startsWith("/dashboard/digital-twin/agents"),
          },
        ]
      : []),
    ...(isPlatformAdmin
      ? [
          {
            label: "Agent-Kontext",
            href: "/dashboard/verwaltung/agent-kontext",
            icon: FileSearch,
            match: (pathname: string) =>
              pathname.startsWith("/dashboard/verwaltung/agent-kontext"),
          },
          {
            label: "SEO Modus",
            href: "/dashboard/verwaltung/seo",
            icon: Sparkles,
            match: (pathname: string) =>
              pathname.startsWith("/dashboard/verwaltung/seo") ||
              pathname.startsWith("/dashboard/digital-twin/seo"),
          },
        ]
      : []),
    ...(canViewDtUsage
      ? [
          {
            label: "Token-Nutzung",
            href: "/dashboard/verwaltung/usage",
            icon: BarChart3,
            match: (pathname: string) => pathname.startsWith("/dashboard/verwaltung/usage"),
          },
        ]
      : []),
  ];

  const frageboegenItem: NavItem | null =
    canManageDtAgents || isPlatformAdmin
      ? {
          label: "Fragebögen",
          href: "/dashboard/frageboegen",
          icon: ClipboardPenLine,
          match: (pathname: string) => pathname.startsWith("/dashboard/frageboegen"),
        }
      : null;

  const adminItems: NavItem[] = [
    {
      label: "Agent-Anfragen",
      href: "/dashboard/admin/agent-requests",
      icon: ClipboardList,
      showDot: pendingAgentEditRequestsCount > 0,
      match: (pathname: string) => pathname.startsWith("/dashboard/admin/agent-requests"),
    },
    {
      label: "Plattform-Übersicht",
      href: "/dashboard/admin/organisations",
      icon: Shield,
      match: (pathname: string) =>
        pathname.startsWith("/dashboard/admin/organisations") ||
        pathname.startsWith("/dashboard/admin/digital-twin"),
    },
    { label: "Jobs", href: "/dashboard/admin/jobs", icon: Workflow },
    {
      label: "E-Mails",
      href: "/dashboard/admin/mails",
      icon: Mail,
      match: (pathname: string) => pathname.startsWith("/dashboard/admin/mails"),
    },
  ];

  const alleUmfragenItem: NavItem = {
    label: "Alle Umfragen",
    href: "/dashboard/surveys",
    icon: ClipboardList,
    showDot: pendingSurveyQuestionsCount > 0,
    match: (pathname: string) => pathname.startsWith("/dashboard/surveys"),
  };

  return (
    <div className="grid gap-4">
      <ZumChatButton size="full" className="w-full justify-center shadow-dt" />

      <nav className="grid gap-1">
        {mainItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {verwaltungItems.length > 0 || frageboegenItem || isPlatformAdmin ? (
        <div className="grid gap-2 pt-2">
          <div className="border-t border-sbkm-navy/10 pt-3 dark:border-white/10">
            <p className="px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sbkm-ink-500">
              Verwaltung
            </p>
          </div>
          <nav className="grid gap-1">
            {verwaltungItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
            {isPlatformAdmin
              ? adminItems.map((item) => <NavLink key={item.href} item={item} />)
              : null}
            {frageboegenItem ? <NavLink key={frageboegenItem.href} item={frageboegenItem} /> : null}
            {isPlatformAdmin ? <NavLink key={alleUmfragenItem.href} item={alleUmfragenItem} /> : null}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
