"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Building2,
  Calendar,
  Crown,
  ExternalLink,
  Search,
  X,
} from "lucide-react";

import { formatOrgDate } from "@/lib/dashboard/organisation-ui";
import type {
  PlatformAdminOrgRow,
  PlatformAdminStats,
} from "@/lib/dashboard/platform-admin-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PlatformAdminFilter =
  | "all"
  | "seo"
  | "no_owner"
  | "invites"
  | "new";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03 },
  },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

function StatusPill(props: {
  label: string;
  active?: boolean;
  muted?: boolean;
  variant?: "mint" | "navy" | "amber" | "outline";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        props.variant === "mint" &&
          "bg-sbkm-mint/20 text-sbkm-navy dark:bg-sbkm-mint/15 dark:text-sbkm-mint",
        props.variant === "navy" &&
          "bg-sbkm-navy/10 text-sbkm-navy dark:bg-white/10 dark:text-white",
        props.variant === "amber" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
        props.variant === "outline" &&
          "border border-border/80 text-secondary",
        !props.variant &&
          props.active &&
          "bg-sbkm-mint/20 text-sbkm-navy dark:bg-sbkm-mint/15 dark:text-sbkm-mint",
        !props.variant &&
          !props.active &&
          !props.muted &&
          "bg-muted text-secondary",
        props.muted && "text-secondary",
      )}
    >
      {props.label}
    </span>
  );
}

function matchesFilter(org: PlatformAdminOrgRow, filter: PlatformAdminFilter): boolean {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  switch (filter) {
    case "seo":
      return org.seoEnabled;
    case "no_owner":
      return !org.ownerEmail;
    case "invites":
      return org.pendingInviteCount > 0;
    case "new":
      return new Date(org.createdAt).getTime() >= thirtyDaysAgo;
    default:
      return true;
  }
}

export function PlatformAdminOrgHub(props: {
  organisations: PlatformAdminOrgRow[];
  stats: PlatformAdminStats;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlatformAdminFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.organisations.filter((org) => {
      if (!matchesFilter(org, filter)) return false;
      if (!q) return true;
      const haystack = [
        org.name,
        org.displayName ?? "",
        org.slug ?? "",
        org.ownerEmail ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [props.organisations, query, filter]);

  const filterChips: Array<{
    id: PlatformAdminFilter;
    label: string;
    count: number;
    show: boolean;
  }> = [
    { id: "all", label: "Alle", count: props.stats.totalOrgs, show: true },
    { id: "seo", label: "SEO", count: props.stats.seoActive, show: props.stats.seoActive > 0 },
    {
      id: "no_owner",
      label: "Ohne Inhaber",
      count: props.stats.withoutOwner,
      show: props.stats.withoutOwner > 0,
    },
    {
      id: "invites",
      label: "Einladungen",
      count: props.stats.pendingInvites,
      show: props.stats.pendingInvites > 0,
    },
    {
      id: "new",
      label: "Neu (30 T.)",
      count: props.stats.newOrgs30d,
      show: props.stats.newOrgs30d > 0,
    },
  ];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2">
        {filterChips
          .filter((chip) => chip.show)
          .map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-semibold transition-all duration-150",
                "hover:-translate-y-px active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
                filter === chip.id
                  ? "border-sbkm-navy/20 bg-sbkm-navy text-white dark:border-sbkm-mint/30 dark:bg-sbkm-mint dark:text-sbkm-navy"
                  : "border-border/80 bg-card text-secondary hover:border-border hover:text-primary",
              )}
            >
              {chip.label}
              <span className="tabular-nums opacity-80">{chip.count}</span>
            </button>
          ))}
        {filter !== "all" ? (
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="inline-flex items-center gap-1 rounded-pill px-2 py-1.5 text-xs font-medium text-secondary transition-colors hover:text-primary"
          >
            <X className="size-3" aria-hidden />
            Filter zurücksetzen
          </button>
        ) : null}
      </div>

      {props.stats.withoutOwner > 0 ? (
        <button
          type="button"
          onClick={() => setFilter("no_owner")}
          className="rounded-xl border border-amber-400/30 bg-amber-50/80 px-4 py-3 text-left text-sm text-amber-950 transition-colors hover:bg-amber-50 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/15"
        >
          <span className="font-semibold tabular-nums">{props.stats.withoutOwner}</span>{" "}
          Organisation{props.stats.withoutOwner === 1 ? "" : "en"} ohne Inhaber — klicken
          zum Filtern.
        </button>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-secondary"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nach Name, Slug, Anzeigename oder Inhaber suchen …"
          className="pl-9 pr-9"
          aria-label="Organisationen durchsuchen"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-secondary transition-colors hover:bg-muted hover:text-primary"
            aria-label="Suche zurücksetzen"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <Building2 className="mx-auto mb-3 size-6 text-secondary" />
          <p className="text-sm font-semibold tracking-tight text-primary">
            {query || filter !== "all" ? "Keine Treffer" : "Noch keine Organisationen"}
          </p>
          <p className="mt-1 text-sm text-secondary">
            {query || filter !== "all"
              ? "Passe Suche oder Filter an — oder setze beides zurück."
              : "Lege links die erste Organisation an."}
          </p>
          {query || filter !== "all" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Alles anzeigen
            </Button>
          ) : null}
        </div>
      ) : (
        <motion.div
          className="grid gap-2"
          variants={container}
          initial="hidden"
          animate="show"
          key={`${query}-${filter}`}
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((org) => (
              <motion.article
                key={org.id}
                variants={item}
                layout
                className="group relative overflow-hidden rounded-xl border border-border/80 bg-card/50 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-muted/15 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0 grid gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold tracking-tight text-primary">
                          {org.displayName ?? org.name}
                        </p>
                        {org.displayName && org.displayName !== org.name ? (
                          <span className="truncate text-xs text-secondary">{org.name}</span>
                        ) : null}
                        {org.slug ? (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {org.slug}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {org.seoEnabled ? (
                          <StatusPill label="SEO" variant="navy" />
                        ) : null}
                        <StatusPill
                          label={`${org.agentCount} Agent${org.agentCount === 1 ? "" : "en"}`}
                          muted={org.agentCount === 0}
                        />
                        <StatusPill
                          label={`${org.memberCount} Mitgl.`}
                          muted={org.memberCount === 0}
                        />
                        {org.pendingInviteCount > 0 ? (
                          <StatusPill
                            label={`${org.pendingInviteCount} Einladung${org.pendingInviteCount === 1 ? "" : "en"}`}
                            variant="amber"
                          />
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
                        {org.ownerEmail ? (
                          <span className="inline-flex min-w-0 items-center gap-1 truncate">
                            <Crown className="size-3 shrink-0" aria-hidden />
                            {org.ownerEmail}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <Crown className="size-3" aria-hidden />
                            Kein Inhaber
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3" aria-hidden />
                          {formatOrgDate(org.createdAt)}
                        </span>
                        {org.lastReportAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Bot className="size-3" aria-hidden />
                            Report {formatOrgDate(org.lastReportAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Bot className="size-3" aria-hidden />
                            Kein SEO-Report
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-8 transition-transform duration-150 active:scale-[0.98]"
                    >
                      <Link
                        href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(org.id)}&tab=chat`}
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        Chat
                      </Link>
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-8 transition-transform duration-150 active:scale-[0.98]"
                    >
                      <Link href={`/dashboard/organisations?org=${org.id}`}>
                        Verwalten
                        <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {query || filter !== "all" ? (
        <p className="text-xs tabular-nums text-secondary">
          {filtered.length} von {props.organisations.length} Organisationen
          {filter !== "all" ? ` · Filter: ${filterChips.find((c) => c.id === filter)?.label}` : ""}
        </p>
      ) : null}
    </div>
  );
}
