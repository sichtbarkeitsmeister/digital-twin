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
      "/dashboard/members",
    ];

    if (isPlatformAdmin) {
      routes.push("/dashboard/admin/organisations", "/dashboard/surveys", "/dashboard/surveys/new");
    }

    for (const href of routes) {
      router.prefetch(href);
    }
  }, [router, isPlatformAdmin]);

  return null;
}

