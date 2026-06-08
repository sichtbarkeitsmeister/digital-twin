import { Suspense } from "react";
import { redirect } from "next/navigation";

import { DtSeoReportDetail } from "@/components/dt/seo/dt-seo-report-detail";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/dt/org-access";

export default async function SeoReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { reportId } = await params;
  const sp = await searchParams;
  const platformAdmin = await isPlatformAdmin(supabase, user.id);

  return (
    <Suspense
      fallback={
        <p className="text-sm text-sbkm-ink-600 dark:text-white/70">Report wird geladen …</p>
      }
    >
      <DtSeoReportDetail
        reportId={reportId}
        organisationIdFromUrl={sp.org ?? null}
        isPlatformAdmin={platformAdmin}
      />
    </Suspense>
  );
}
