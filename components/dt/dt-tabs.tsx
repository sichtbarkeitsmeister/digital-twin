"use client";

import { cn } from "@/components/dt/cn";

type DtTabsProps = {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function DtTabs({ tabs, active, onChange, className }: DtTabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "mb-7 flex rounded-pill bg-sbkm-navy/[0.06] p-1 dark:bg-white/10",
        className,
      )}
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
              "flex-1 rounded-pill px-4 py-2.5 text-[13.5px] font-bold transition-all duration-200 ease-dt",
              isActive
                ? "bg-sbkm-navy text-white"
                : "bg-transparent text-sbkm-navy dark:text-white",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
