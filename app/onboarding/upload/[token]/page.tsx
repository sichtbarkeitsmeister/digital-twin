import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PublicOnboardingUpload } from "@/app/onboarding/upload/[token]/_components/public-onboarding-upload";
import { DtLogo } from "@/components/dt/dt-logo";
import { loadOnboardingByUploadToken } from "@/lib/dt/onboarding/store";

function PublicOnboardingUploadFallback() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <DtLogo size="sidebar" />
      <div className="rounded-dt border border-sbkm-navy/10 bg-white/55 p-6 text-sm text-sbkm-ink-600 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:text-white/70">
        Lädt …
      </div>
    </div>
  );
}

async function PublicOnboardingUploadContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await loadOnboardingByUploadToken(decodeURIComponent(token));
  if (!found) notFound();

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <DtLogo size="sidebar" />
      <PublicOnboardingUpload token={found.record.uploadToken} />
    </div>
  );
}

export default function PublicOnboardingUploadPage(props: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<PublicOnboardingUploadFallback />}>
      <PublicOnboardingUploadContent {...props} />
    </Suspense>
  );
}
