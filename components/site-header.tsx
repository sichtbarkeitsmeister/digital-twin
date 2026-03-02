import Link from "next/link";
import Image from "next/image";
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
              <span className="relative h-7 w-44 sm:h-8 sm:w-52">
                <Image
                  src={logoLight}
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 640px) 208px, 176px"
                  className="object-contain dark:hidden"
                />
                <Image
                  src={logoDark}
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 640px) 208px, 176px"
                  className="hidden object-contain dark:block"
                />
              </span>
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

