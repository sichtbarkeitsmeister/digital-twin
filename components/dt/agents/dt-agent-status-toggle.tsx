"use client";

import { cn } from "@/components/dt/cn";

export function DtAgentStatusToggle(props: {
  enabled: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.enabled}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.enabled)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
        "disabled:cursor-not-allowed disabled:opacity-50",
        props.compact ? "h-5 w-9" : "h-6 w-11",
        props.enabled ? "bg-sbkm-mint" : "bg-sbkm-navy/15 dark:bg-white/15",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200",
          props.compact
            ? cn("size-4 translate-x-0.5", props.enabled && "translate-x-[18px]")
            : cn("size-5 translate-x-0.5", props.enabled && "translate-x-[22px]"),
        )}
      />
    </button>
  );
}
