"use client";

import { motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type { DtChatListScope } from "@/lib/dt/db";

const TABS: { id: DtChatListScope; label: string }[] = [
  { id: "mine", label: "Meine" },
  { id: "team", label: "Team" },
  { id: "all", label: "Alle" },
];

export function DtChatScopeTabs(props: {
  scope: DtChatListScope;
  onScopeChange: (scope: DtChatListScope) => void;
}) {
  return (
    <div
      className="relative mt-3 flex rounded-pill border border-sbkm-navy/12 bg-white/60 p-0.5 dark:border-white/12 dark:bg-white/5"
      role="tablist"
      aria-label="Chat-Bereich"
    >
      {TABS.map((tab) => {
        const active = props.scope === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => props.onScopeChange(tab.id)}
            className={cn(
              "relative flex-1 rounded-pill px-2 py-1.5 text-xs font-bold transition-colors duration-150",
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
            <span className="relative z-10">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
