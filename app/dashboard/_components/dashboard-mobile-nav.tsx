"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Laptop, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";

import { DashboardLogoLink } from "@/app/dashboard/_components/dashboard-logo-link";
import { cn } from "@/components/dt/cn";
import { DtIconButton } from "@/components/dt/dt-icon-button";

const DRAWER_ID = "dashboard-mobile-nav";
/** Tailwind `lg` — from here on the desktop sidebar takes over. */
const DESKTOP_QUERY = "(min-width: 1024px)";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type MobileNavContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  if (!ctx) {
    throw new Error("DashboardMobileNav components need DashboardMobileNavProvider");
  }
  return ctx;
}

export function DashboardMobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const value = useMemo(() => ({ open, setOpen, triggerRef }), [open]);

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

/** Hamburger for the top bar — only rendered visibly below `lg`. */
export function DashboardMobileNavTrigger({ className }: { className?: string }) {
  const { open, setOpen, triggerRef } = useMobileNav();

  return (
    <DtIconButton
      ref={triggerRef}
      aria-label="Menü öffnen"
      aria-expanded={open}
      aria-controls={DRAWER_ID}
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className={cn("shrink-0 lg:hidden", className)}
    >
      <Menu className="h-5 w-5" strokeWidth={1.9} aria-hidden />
    </DtIconButton>
  );
}

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

/** Inline theme switch: below `sm` the top bar has no room for DtThemeToggle. */
function DrawerThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const active = theme ?? "system";

  return (
    <div
      role="group"
      aria-label="Theme-Modus"
      className="grid grid-cols-3 gap-1 rounded-pill border border-sbkm-navy/10 bg-white/50 p-1 dark:border-white/10 dark:bg-white/[0.06]"
    >
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => setTheme(value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-pill px-2 text-xs font-bold text-sbkm-navy transition-colors dark:text-white",
              isActive
                ? "bg-sbkm-mint/40 dark:bg-sbkm-mint/20"
                : "hover:bg-sbkm-navy/[0.06] dark:hover:bg-white/10",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Slide-over navigation for viewports below `lg`. `children` is the very same
 * <DashboardSidebar> the desktop aside renders — the nav lists live in one place.
 */
export function DashboardMobileNavDrawer({ children }: { children: React.ReactNode }) {
  const { open, setOpen, triggerRef } = useMobileNav();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Navigating away closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  // The desktop sidebar takes over at `lg`.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setOpen]);

  // While open: lock page scroll, trap focus, close on Escape, restore focus after.
  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement;

      if (!panel.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open, setOpen, triggerRef]);

  const duration = reduceMotion ? 0 : 0.24;

  return (
    <AnimatePresence>
      {open ? (
        <div key="dashboard-mobile-nav" className="fixed inset-0 z-[150] lg:hidden">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-sbkm-navy/45 backdrop-blur-[2px] dark:bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration }}
            onClick={close}
          />
          <motion.div
            ref={panelRef}
            id={DRAWER_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[85vw] max-w-[320px] flex-col border-r border-sbkm-navy/[0.08] bg-white/45 pl-[env(safe-area-inset-left)] shadow-dt backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55"
            initial={reduceMotion ? { opacity: 0 } : { x: "-100%" }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "-100%" }}
            transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
            // A link to the page we are already on does not change the pathname.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a[href]")) close();
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sbkm-navy/[0.08] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-white/10">
              <DashboardLogoLink size="sidebar" />
              <DtIconButton ref={closeRef} aria-label="Menü schließen" onClick={close}>
                <X className="h-5 w-5" strokeWidth={1.9} aria-hidden />
              </DtIconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 scrollbar-subtle">
              {children}
            </div>
            <div className="shrink-0 border-t border-sbkm-navy/[0.08] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/10 sm:hidden">
              <DrawerThemeSwitch />
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
