import { Suspense } from "react";

import { DtGlassCard, DtHeading } from "@/components/dt";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <p className="text-sm leading-normal text-sbkm-ink-600 dark:text-white/70">
      {params?.error
        ? `Fehlercode: ${params.error}`
        : "Ein unbekannter Fehler ist aufgetreten."}
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <DtGlassCard className="w-full max-w-[520px]" padding="lg">
      <DtHeading as="h1" variant="h4">
        Etwas ist schiefgelaufen.
      </DtHeading>
      <div className="mt-4">
        <Suspense>
          <ErrorContent searchParams={searchParams} />
        </Suspense>
      </div>
    </DtGlassCard>
  );
}
