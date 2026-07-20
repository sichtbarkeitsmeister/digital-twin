import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { DtLogo } from "@/components/dt/dt-logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl px-5">
        <nav className="flex h-16 w-full items-center justify-between">
          <div className="flex items-center gap-5">
            <DtLogo href="/" size="header" />
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
