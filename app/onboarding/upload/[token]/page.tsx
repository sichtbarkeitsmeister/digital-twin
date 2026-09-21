import { notFound } from "next/navigation";

import { PublicOnboardingUpload } from "@/app/onboarding/upload/[token]/_components/public-onboarding-upload";
import { DtLogo } from "@/components/dt/dt-logo";
import { loadOnboardingByUploadToken } from "@/lib/dt/onboarding/store";

export default async function PublicOnboardingUploadPage({
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
