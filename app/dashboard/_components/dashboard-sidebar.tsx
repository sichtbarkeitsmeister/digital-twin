"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ClipboardPenLine,
  Inbox,
  Shield,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
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
        "group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent text-accent-foreground" : "text-secondary"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-transparent",
          active ? "bg-primary" : "group-hover:bg-primary/40"
        )}
      />
      <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-secondary")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function DashboardSidebar({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const mainItems: NavItem[] = [
    { label: "Inbox", href: "/dashboard/inbox", icon: Inbox },
    { label: "Organisations", href: "/dashboard/organisations", icon: Building2 },
    { label: "Members", href: "/dashboard/members", icon: Users },
  ];

  const adminItems: NavItem[] = [
    {
      label: "Manage organisations",
      href: "/dashboard/admin/organisations",
      icon: Shield,
    },
    { label: "Survey builder", href: "/dashboard/surveys/new", icon: ClipboardPenLine },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 px-2 pt-1">
        <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
          DT
        </div>
        <div className="grid leading-tight">
          <p className="text-sm font-semibold tracking-tight text-primary">
            Digital Twin
          </p>
          <p className="text-xs text-secondary">Dashboard</p>
        </div>
      </div>

      <nav className="grid gap-1">
        {mainItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {isPlatformAdmin ? (
        <div className="grid gap-2 pt-2">
          <div className="border-t pt-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-secondary">
              Admin
            </p>
          </div>
          <nav className="grid gap-1">
            {adminItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

