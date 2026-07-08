"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Mail, Users } from "lucide-react";

import { formatOrgDate, formatOrgRole } from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type OrganisationListItem = {
  organisationId: string;
  name: string;
  slug: string | null;
  orgRole: string;
  memberCount: number;
  pendingInviteCount: number;
  createdAt: string;
  pendingInvites: Array<{
    email: string;
    orgRole: string;
  }>;
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export function OrganisationListGrid({
  organisations,
}: {
  organisations: OrganisationListItem[];
}) {
  return (
    <motion.div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {organisations.map((org) => (
        <motion.article
          key={org.organisationId}
          variants={item}
          className="group relative overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent dark:via-white/10" />

          <div className="flex h-full flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 grid gap-1">
                  <h2 className="truncate text-base font-semibold tracking-tight text-primary">
                    {org.name}
                  </h2>
                  {org.slug ? (
                    <p className="truncate text-xs text-secondary">{org.slug}</p>
                  ) : (
                    <p className="text-xs text-secondary">
                      Erstellt {formatOrgDate(org.createdAt)}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant="outline">{formatOrgRole(org.orgRole)}</Badge>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-secondary">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 tabular-nums">
                <Users className="size-3.5" aria-hidden />
                {org.memberCount} Mitglieder
              </span>
              {org.pendingInviteCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 tabular-nums">
                  <Mail className="size-3.5" aria-hidden />
                  {org.pendingInviteCount} offen
                </span>
              ) : null}
            </div>

            {org.pendingInvites.length > 0 ? (
              <div className="grid gap-2 border-t border-border/60 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-secondary">
                  Ausstehende Einladungen
                </p>
                <ul className="grid gap-1.5">
                  {org.pendingInvites.slice(0, 2).map((invite) => (
                    <li
                      key={invite.email}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm"
                    >
                      <span className="truncate">{invite.email}</span>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {formatOrgRole(invite.orgRole)}
                      </Badge>
                    </li>
                  ))}
                  {org.pendingInviteCount > 2 ? (
                    <li className="text-xs text-secondary">
                      +{org.pendingInviteCount - 2} weitere
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : (
              <p className="border-t border-border/60 pt-3 text-sm text-secondary">
                Keine ausstehenden Einladungen.
              </p>
            )}

            <div className="mt-auto pt-1">
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="w-full transition-transform duration-150 active:scale-[0.98]"
              >
                <Link href={`/dashboard/organisations?org=${org.organisationId}`}>
                  Organisation öffnen
                  <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </div>
          </div>
        </motion.article>
      ))}
    </motion.div>
  );
}
