"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function DashboardPrefetcher({
  isPlatformAdmin,
}: {
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const routes = [
      "/dashboard/inbox",
      "/dashboard/organisations",
      "/dashboard/organisations",
    ];

    if (isPlatformAdmin) {
      routes.push(
        "/dashboard/admin/organisations",
        "/dashboard/admin/team",
        "/dashboard/admin/mails",
        "/dashboard/surveys",
        "/dashboard/frageboegen",
        "/dashboard/frageboegen/neu",
      );
    }

    for (const href of routes) {
      router.prefetch(href);
    }
  }, [router, isPlatformAdmin]);

  return null;
}

