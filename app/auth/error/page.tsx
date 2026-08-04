import Link from "next/link";
import { Suspense } from "react";

import { DtGlassCard, DtHeading, DtPillButton } from "@/components/dt";
import { translateAuthError } from "@/lib/auth/error-messages";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <p className="text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
      {translateAuthError(params?.error)}
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <DtGlassCard className="w-full max-w-[520px]" padding="lg">
      <DtHeading as="h1" variant="h4">
        Anmeldung nicht möglich
      </DtHeading>
      <div className="mt-4 grid gap-4">
        <Suspense>
          <ErrorContent searchParams={searchParams} />
        </Suspense>
        <DtPillButton asChild size="full">
          <Link href="/auth/login">Neuen Anmeldelink anfordern</Link>
        </DtPillButton>
      </div>
    </DtGlassCard>
  );
}
