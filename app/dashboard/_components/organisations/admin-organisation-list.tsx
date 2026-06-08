"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Calendar,
  Crown,
  Mail,
  Search,
  Users,
  X,
} from "lucide-react";

import { formatOrgDate } from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AdminOrganisationListItem = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  memberCount: number;
  pendingInviteCount: number;
  ownerEmail: string | null;
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.035 },
  },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export function AdminOrganisationList({
  organisations,
}: {
  organisations: AdminOrganisationListItem[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return organisations;
    return organisations.filter((org) => {
      const haystack = [
        org.name,
        org.slug ?? "",
        org.ownerEmail ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [organisations, query]);

  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-secondary"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nach Name, Slug oder Inhaber suchen …"
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
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <Building2 className="mx-auto mb-2 size-5 text-secondary" />
          <p className="text-sm font-medium text-primary">
            {query ? "Keine Treffer" : "Keine Organisationen gefunden"}
          </p>
          <p className="mt-1 text-sm text-secondary">
            {query
              ? "Passe den Suchbegriff an oder setze die Suche zurück."
              : "Lege oben die erste Organisation an."}
          </p>
        </div>
      ) : (
        <motion.div
          className="grid gap-2"
          variants={container}
          initial="hidden"
          animate="show"
          key={query}
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((org) => (
              <motion.div
                key={org.id}
                variants={item}
                layout
                className="group flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 px-3 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-muted/20 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold tracking-tight text-primary">
                        {org.name}
                      </p>
                      {org.slug ? (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {org.slug}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Users className="size-3" aria-hidden />
                        {org.memberCount} Mitglieder
                      </span>
                      {org.pendingInviteCount > 0 ? (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Mail className="size-3" aria-hidden />
                          {org.pendingInviteCount} offen
                        </span>
                      ) : null}
                      {org.ownerEmail ? (
                        <span className="inline-flex min-w-0 items-center gap-1 truncate">
                          <Crown className="size-3 shrink-0" aria-hidden />
                          {org.ownerEmail}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          Kein Inhaber
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3" aria-hidden />
                        {formatOrgDate(org.createdAt)}
                      </span>
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
                    <Link href={`/dashboard/members?org=${org.id}`}>
                      Mitglieder
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 transition-transform duration-150 active:scale-[0.98]"
                  >
                    <Link href={`/dashboard/organisations/${org.id}`}>
                      Verwalten
                      <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </Link>
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {query && filtered.length > 0 ? (
        <p className="text-xs tabular-nums text-secondary">
          {filtered.length} von {organisations.length} Organisationen
        </p>
      ) : null}
    </div>
  );
}
