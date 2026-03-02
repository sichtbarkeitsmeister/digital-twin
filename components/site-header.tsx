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
            <Link href="/" className="flex items-center" aria-label="DigitalTwin">
              <span className="sr-only">DigitalTwin</span>
              {/* TEMP: images disabled for testing */}
              <span className="text-sm font-semibold tracking-tight">DigitalTwin</span>
            </Link>
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

