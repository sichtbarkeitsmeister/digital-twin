"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { cn } from "@/components/dt/cn";

type DtTabsProps = {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
  layoutId?: string;
};

export function DtTabs({ tabs, active, onChange, className, layoutId = "dt-tabs-pill" }: DtTabsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={cn(
        "mb-7 -mx-1 overflow-x-auto px-1 scrollbar-subtle sm:mx-0 sm:overflow-visible sm:px-0",
        className,
      )}
    >
      <div
        role="tablist"
        className="relative flex w-max min-w-full rounded-pill bg-sbkm-navy/[0.06] p-1 dark:bg-white/10 sm:w-full"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative shrink-0 rounded-pill px-3 py-2 text-xs font-bold transition-colors duration-150 sm:flex-1 sm:px-4 sm:py-2.5 sm:text-[13.5px]",
                isActive
                  ? "text-sbkm-navy"
                  : "text-sbkm-navy/60 hover:text-sbkm-navy dark:text-white/50 dark:hover:text-white",
              )}
            >
              {isActive ? (
                mounted ? (
                  <motion.span
                    layoutId={layoutId}
                    className="absolute inset-0 rounded-pill bg-sbkm-mint shadow-sm"
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  />
                ) : (
                  <span className="absolute inset-0 rounded-pill bg-sbkm-mint shadow-sm" />
                )
              ) : null}
              <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
