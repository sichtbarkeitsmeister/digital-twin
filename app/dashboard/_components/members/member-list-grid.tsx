"use client";

import { motion } from "framer-motion";
import { Crown, Shield, User } from "lucide-react";

import {
  formatOrgDate,
  formatOrgRole,
  memberDisplayName,
  memberInitials,
} from "@/lib/dashboard/organisation-ui";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MemberListItem = {
  userId: string;
  email: string | null;
  orgRole: string;
  createdAt: string;
  isSelf: boolean;
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

function roleIcon(role: string) {
  if (role === "owner") return Crown;
  if (role === "admin") return Shield;
  return User;
}

export function MemberListGrid({ members }: { members: MemberListItem[] }) {
  return (
    <motion.div
      className="grid gap-2"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {members.map((member) => {
        const RoleIcon = roleIcon(member.orgRole);
        const label = memberDisplayName(member.email);

        return (
          <motion.div
            key={member.userId}
            variants={item}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  member.orgRole === "owner"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-secondary",
                )}
              >
                {memberInitials(member.email)}
              </div>
              <div className="min-w-0 grid gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-primary">
                    {label}
                  </span>
                  {member.isSelf ? (
                    <Badge variant="secondary">Du</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-secondary">
                  Beigetreten {formatOrgDate(member.createdAt)}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="inline-flex shrink-0 items-center gap-1 tabular-nums"
            >
              <RoleIcon className="size-3" aria-hidden />
              {formatOrgRole(member.orgRole)}
            </Badge>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
