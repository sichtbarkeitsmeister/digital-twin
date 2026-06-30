"use client";

import { motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type { DtChatListScope } from "@/lib/dt/db";

const TABS: { id: DtChatListScope; label: string; shortLabel?: string }[] = [
  { id: "mine", label: "Meine" },
  { id: "team", label: "Team" },
  { id: "all", label: "Alle" },
];

const ORG_TAB = {
  id: "org" as DtChatListScope,
  label: "Organisation",
  shortLabel: "Org.",
};

export function DtChatScopeTabs(props: {
  scope: DtChatListScope;
  onScopeChange: (scope: DtChatListScope) => void;
  showOrgTab?: boolean;
  compact?: boolean;
}) {
  const tabs = props.showOrgTab ? [...TABS, ORG_TAB] : TABS;

  return (
    <div
      className={cn(
        "relative flex w-full gap-0.5 rounded-pill border border-sbkm-navy/12 bg-white/60 p-0.5 dark:border-white/12 dark:bg-white/5",
        props.compact ? "mt-2" : "mt-4",
      )}
      role="tablist"
      aria-label="Chat-Bereich"
    >
      {tabs.map((tab) => {
        const active = props.scope === tab.id;
        const label =
          props.compact && tab.shortLabel ? tab.shortLabel : tab.label;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={tab.label}
            onClick={() => props.onScopeChange(tab.id)}
            className={cn(
              "relative min-w-0 flex-1 rounded-pill px-1 font-semibold transition-colors duration-150",
              props.compact ? "py-1 text-[11px]" : "py-2 text-xs",
              active
                ? "text-sbkm-navy"
                : "text-sbkm-ink-600 hover:text-sbkm-navy dark:text-white/55 dark:hover:text-white",
            )}
          >
            {active ? (
              <motion.span
                layoutId="dt-chat-scope-indicator"
                className="absolute inset-0 rounded-pill bg-sbkm-mint shadow-sm"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            ) : null}
            <span className="relative z-10 block truncate text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
