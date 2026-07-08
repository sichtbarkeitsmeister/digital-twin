"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

const FILTERS = [
  { id: "", label: "Alle" },
  { id: "sent", label: "Gesendet" },
  { id: "failed", label: "Fehlgeschlagen" },
  { id: "skipped", label: "Übersprungen" },
] as const;

export function AdminMailStatusFilters({ active }: { active?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => {
        const isActive = (active ?? "") === filter.id;
        const href =
          filter.id === ""
            ? "/dashboard/admin/mails"
            : `/dashboard/admin/mails?status=${filter.id}`;

        return (
          <Link
            key={filter.id || "all"}
            href={href}
            className={cn(
              "inline-flex h-8 items-center rounded-pill px-3 text-xs font-medium transition-colors duration-150",
              isActive
                ? "bg-sbkm-navy text-white shadow-sm dark:bg-sbkm-mint dark:text-sbkm-navy"
                : "border border-sbkm-navy/10 bg-white/60 text-secondary hover:bg-sbkm-navy/[0.06] dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/10",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}
