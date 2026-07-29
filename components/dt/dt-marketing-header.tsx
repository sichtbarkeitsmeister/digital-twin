import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";

import { AuthButton } from "@/components/auth-button";
import { DtLogo } from "@/components/dt/dt-logo";
import { DtMarketingHeaderClient } from "@/components/dt/dt-marketing-header-client";
import { DtPillButton } from "@/components/dt/dt-pill-button";

function AuthActionsFallback() {
  return <div className="h-9 w-24 animate-pulse rounded-pill bg-sbkm-navy/10" />;
}

export function DtMarketingHeader() {
  return (
    <DtMarketingHeaderClient
      authSlot={
        <Suspense fallback={<AuthActionsFallback />}>
          <AuthButton />
        </Suspense>
      }
    />
  );
}

export function DtAuthHeader() {
  return (
    <header className="flex items-center justify-between border-b border-sbkm-navy/[0.08] bg-white/45 px-5 py-2.5 backdrop-blur-[28px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-sbkm-ink-900/55 sm:px-14">
      <DtLogo size="auth" />
      <DtPillButton
        asChild
        variant="ghost"
        size="sm"
        className="hover:bg-sbkm-navy/[0.08] dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Zurück zur Startseite
        </Link>
      </DtPillButton>
    </header>
  );
}
