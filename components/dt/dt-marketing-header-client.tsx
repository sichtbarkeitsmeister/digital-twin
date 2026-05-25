"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/components/dt/cn";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtNavLink } from "@/components/dt/dt-nav-link";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtThemeToggle } from "@/components/dt/dt-theme-toggle";

const navItems = [
  { href: "#pipeline", label: "Wie es funktioniert" },
  { href: "#trust", label: "Ergebnisse" },
  { href: "/dashboard", label: "Demo ansehen" },
];

export function DtMarketingHeaderClient({
  authSlot,
}: {
  authSlot: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < 80) setHidden(false);
      else if (delta > 4 && !menuOpen) setHidden(true);
      else if (delta < -4) setHidden(false);
      if (Math.abs(delta) > 2) lastY = y;
      ticking = false;
    }

    function onScrollRequest() {
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScrollRequest, { passive: true });
    return () => window.removeEventListener("scroll", onScrollRequest);
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 flex items-center justify-between border-b border-sbkm-navy/[0.08] bg-white/45 px-5 py-2.5 backdrop-blur-[28px] backdrop-saturate-[180%] transition-[transform,opacity] duration-[380ms] ease-dt dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-14",
          hidden && !menuOpen && "-translate-y-[110%] opacity-0",
        )}
      >
        <DtLogo size="header" />

        <nav className="hidden items-center gap-7 lg:flex">
          {navItems.map((item) => (
            <DtNavLink key={item.href} href={item.href}>
              {item.label}
            </DtNavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <DtThemeToggle />
          <div className="hidden sm:block">{authSlot}</div>
          <button
            type="button"
            className="inline-grid h-11 w-11 place-items-center rounded-pill bg-white/60 text-sbkm-navy hover:bg-sbkm-navy/10 dark:bg-white/10 dark:text-white lg:hidden"
            aria-label="Menü öffnen"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        </div>
      </header>

      <div
        className={cn(
          "fixed inset-0 z-[60] flex flex-col bg-white/85 px-6 pb-8 pt-[18px] backdrop-blur-[32px] backdrop-saturate-[180%] transition-[opacity,transform] duration-200 ease-dt dark:bg-sbkm-ink-900/92 lg:hidden",
          menuOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-3 opacity-0",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Hauptmenü"
      >
        <div className="flex items-center justify-between border-b border-sbkm-navy/10 pb-6 dark:border-white/10">
          <DtLogo href="/" size="header" />
          <button
            type="button"
            className="inline-grid h-11 w-11 place-items-center rounded-pill bg-sbkm-navy/10 text-sbkm-navy dark:bg-white/10 dark:text-white"
            aria-label="Menü schließen"
            onClick={() => setMenuOpen(false)}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <nav className="mt-2 flex flex-1 flex-col">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="border-b border-sbkm-navy/[0.08] py-[18px] font-display text-[clamp(1.6rem,6vw,2.2rem)] font-medium uppercase leading-[1.05] tracking-[-0.005em] text-sbkm-navy dark:border-white/10 dark:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5 pt-6">
          <DtPillButton asChild size="full">
            <Link href="/auth/sign-up" onClick={() => setMenuOpen(false)}>
              Zugang anfordern
            </Link>
          </DtPillButton>
          <DtPillButton asChild variant="outline" size="full">
            <Link href="/auth/login" onClick={() => setMenuOpen(false)}>
              Anmelden
            </Link>
          </DtPillButton>
        </div>
      </div>
    </>
  );
}
