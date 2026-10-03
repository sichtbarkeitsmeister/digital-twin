import Link from "next/link";

import { cn } from "@/components/dt/cn";

export type OrgDetailTabId = "overview" | "avatare" | "seo" | "texte";

export function orgTexteHref(organisationId: string): string {
  return `/dashboard/organisations/${encodeURIComponent(organisationId)}/texte`;
}

/** Link tabs for the organisation detail view; rendered for platform admins only (same as SEO Modus). */
export function OrgDetailTabs(props: { organisationId: string; active: OrgDetailTabId }) {
  const org = encodeURIComponent(props.organisationId);
  const tabs: Array<{ id: OrgDetailTabId; label: string; href: string }> = [
    { id: "overview", label: "Übersicht", href: `/dashboard/organisations?org=${org}` },
    { id: "avatare", label: "Avatare", href: `/dashboard/verwaltung/agents?org=${org}` },
    { id: "seo", label: "SEO", href: `/dashboard/verwaltung/seo?org=${org}&tab=chat` },
    { id: "texte", label: "Texte", href: orgTexteHref(props.organisationId) },
  ];

  return (
    <nav aria-label="Organisation" className="-mx-1 overflow-x-auto px-1 scrollbar-subtle sm:mx-0 sm:px-0">
      <div className="flex w-max min-w-full gap-1 rounded-pill bg-sbkm-navy/[0.06] p-1 dark:bg-white/10 sm:w-fit sm:min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === props.active;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-pill px-4 py-2 text-xs font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 sm:text-[13.5px]",
                isActive
                  ? "bg-sbkm-mint text-sbkm-navy shadow-sm"
                  : "text-sbkm-navy/60 hover:text-sbkm-navy dark:text-white/55 dark:hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
