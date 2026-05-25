"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/dt/cn";
import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtIconButton } from "@/components/dt/dt-icon-button";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

export function DtThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!mounted) return <div className="h-10 w-10" />;

  const active = theme ?? "system";
  const ActiveIcon = options.find((o) => o.value === active)?.icon ?? Laptop;

  return (
    <div ref={wrapperRef} className="relative">
      <DtIconButton
        aria-label="Theme-Modus"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ActiveIcon className="h-5 w-5" strokeWidth={1.7} />
      </DtIconButton>

      {open ? (
        <DtGlassCard
          variant="solid"
          padding="none"
          className="absolute right-0 top-[calc(100%+10px)] z-50 min-w-[200px] animate-dt-menu-pop p-1.5 shadow-dt-menu dark:bg-sbkm-ink-900/95"
        >
          {options.map(({ value, label, icon: Icon }) => {
            const isActive = active === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] font-bold text-sbkm-navy transition-colors hover:bg-sbkm-navy/[0.06] dark:text-white dark:hover:bg-white/10",
                  isActive && "bg-sbkm-mint/20 dark:bg-sbkm-mint/15",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] text-sbkm-mint",
                    isActive && "text-sbkm-navy dark:text-sbkm-mint",
                  )}
                  strokeWidth={1.7}
                />
                <span className="flex-1">{label}</span>
                <Check
                  className={cn(
                    "h-3.5 w-3.5 text-sbkm-mint transition-opacity",
                    isActive ? "opacity-100 text-sbkm-navy dark:text-sbkm-mint" : "opacity-0",
                  )}
                  strokeWidth={2.4}
                />
              </button>
            );
          })}
        </DtGlassCard>
      ) : null}
    </div>
  );
}
