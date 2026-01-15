import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl px-5">
        <nav className="flex h-16 w-full items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="font-semibold tracking-tight">
              DigitalTwin
            </Link>
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <Link
                href="/#produkt"
                className="text-secondary hover:text-primary transition-colors"
              >
                Produkt
              </Link>
              <Link
                href="/#so-funktionierts"
                className="text-secondary hover:text-primary transition-colors"
              >
                So funktioniert’s
              </Link>
              <Link
                href="/#zugang"
                className="text-secondary hover:text-primary transition-colors"
              >
                Zugang
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </nav>
      </div>
    </header>
  );
}

