"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Bot,
  ClipboardPenLine,
  Inbox,
  Plug,
  Shield,
  MessageCircle,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

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
  canAccessDtSeo,
  canManageDtAgents,
  pendingSurveyQuestionsCount,
}: {
  isPlatformAdmin: boolean;
  canManageIntegrations: boolean;
  canAccessDtSeo: boolean;
  canManageDtAgents: boolean;
  pendingSurveyQuestionsCount: number;
}) {
  const mainItems: NavItem[] = [
    { label: "Posteingang", href: "/dashboard/inbox", icon: Inbox },
    { label: "Leads", href: "/dashboard/leads", icon: Sparkles },
    { label: "Organisationen", href: "/dashboard/organisations", icon: Building2 },
    { label: "Mitglieder", href: "/dashboard/members", icon: Users },
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
    ...(canAccessDtSeo
      ? [
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
    ...(isPlatformAdmin
      ? [
          {
            label: "DigitalTwin Admin",
            href: "/dashboard/admin/digital-twin",
            icon: MessageCircle,
          },
        ]
      : []),
  ];

  const adminItems: NavItem[] = [
    {
      label: "Organisationen verwalten",
      href: "/dashboard/admin/organisations",
      icon: Shield,
    },
    { label: "Jobs runner", href: "/dashboard/admin/jobs", icon: Workflow },
    {
      label: "Umfragen",
      href: "/dashboard/surveys",
      icon: ClipboardPenLine,
      showDot: pendingSurveyQuestionsCount > 0,
    },
  ];

  return (
    <div className="grid gap-4">
      <nav className="grid gap-1">
        {mainItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {verwaltungItems.length > 0 || isPlatformAdmin ? (
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
          </nav>
        </div>
      ) : null}
    </div>
  );
}
