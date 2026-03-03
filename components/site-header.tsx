import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import logoLight from "@/lib/public/digital-twin-logo-sbkm-simple.png";
import logoDark from "@/lib/public/digital-twin-logo-sbkm-mint-simple.png";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl px-5">
        <nav className="flex h-16 w-full items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="flex items-center" aria-label="DigitalTwin">
              <span className="sr-only">DigitalTwin</span>
              <img
                src={logoLight.src}
                width={logoLight.width}
                height={logoLight.height}
                alt=""
                loading="eager"
                decoding="async"
                className="h-7 w-auto object-contain dark:hidden sm:h-8"
              />
              <img
                src={logoDark.src}
                width={logoDark.width}
                height={logoDark.height}
                alt=""
                loading="eager"
                decoding="async"
                className="hidden h-7 w-auto object-contain dark:block sm:h-8"
              />
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

