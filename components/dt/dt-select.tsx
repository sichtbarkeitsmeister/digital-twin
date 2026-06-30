"use client";

import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/components/dt/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type DtSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

const triggerBase =
  "flex h-10 items-center justify-between gap-2 rounded-pill border border-sbkm-navy/15 bg-white/80 px-3 text-sm font-semibold text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 hover:border-sbkm-mint/35 hover:bg-white focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 active:scale-[0.99] dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/[0.14]";

const menuContentBase =
  "relative z-50 min-w-[12rem] max-h-[min(280px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overflow-x-hidden rounded-xl border border-sbkm-navy/10 bg-white/95 p-1.5 text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.12)] backdrop-blur-xl scrollbar-subtle before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent dark:border-white/10 dark:bg-sbkm-navy/95 dark:text-white dark:before:via-white/15";

const menuItemBase =
  "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition-colors focus:bg-sbkm-mint/15 data-[highlighted]:bg-sbkm-mint/15 dark:focus:bg-white/10 dark:data-[highlighted]:bg-white/10";

export function DtSelect(props: {
  value: string;
  onValueChange: (value: string) => void;
  options: DtSelectOption[];
  label?: string;
  labelClassName?: string;
  srLabel?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  fullWidth?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Max height of the open menu (scrolls when list is longer). */
  menuMaxHeight?: string;
  /** Render above modals/drawers (z-index 110). */
  elevated?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  collisionPadding?: number;
  size?: "default" | "sm";
}) {
  const selected = props.options.find((o) => o.value === props.value);
  const sm = props.size === "sm";

  return (
    <div className={cn("grid min-w-0", sm ? "gap-0" : "gap-1", props.fullWidth && "w-full max-w-full", props.className)}>
      {props.label ? (
        <span
          className={cn(
            "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50",
            props.labelClassName,
          )}
        >
          {props.label}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={props.disabled}>
          <button
            type="button"
            disabled={props.disabled}
            className={cn(
              triggerBase,
              sm && "h-8 px-2.5 text-xs font-semibold shadow-none",
              props.fullWidth && "w-full",
              props.triggerClassName,
              props.disabled && "cursor-wait opacity-50",
            )}
            aria-label={props.srLabel ?? props.label ?? "Auswahl"}
          >
            <span className="min-w-0 truncate text-left">
              {selected?.label ?? props.placeholder ?? "Auswählen …"}
            </span>
            <ChevronDown
              className={cn(
                "shrink-0 text-sbkm-ink-500 dark:text-white/50",
                sm ? "h-3.5 w-3.5" : "h-4 w-4",
              )}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={props.side ?? "bottom"}
          sideOffset={props.sideOffset ?? 6}
          collisionPadding={props.collisionPadding ?? 12}
          className={cn(
            menuContentBase,
            props.elevated && "z-[110]",
            props.menuMaxHeight,
            props.fullWidth && "w-[var(--radix-dropdown-menu-trigger-width)]",
            props.contentClassName,
          )}
        >
          {props.options.map((opt) => {
            const isSelected = opt.value === props.value;
            return (
              <DropdownMenuItem
                key={opt.value}
                disabled={opt.disabled}
                onSelect={() => props.onValueChange(opt.value)}
                className={cn(
                  menuItemBase,
                  isSelected && "bg-sbkm-mint/20 dark:bg-sbkm-mint/25",
                  opt.disabled && "opacity-50",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description ? (
                    <span className="mt-0.5 block truncate text-xs font-normal text-sbkm-ink-600 dark:text-white/50">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
                {isSelected ? (
                  <Check className="h-4 w-4 shrink-0 text-sbkm-mint" aria-hidden />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
