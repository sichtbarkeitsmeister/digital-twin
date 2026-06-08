"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  readSelectedOrganisationId,
  writeSelectedOrganisationId,
} from "@/lib/shared/selected-organisation-storage";

export function PersistedOrganisationUrlSync(props: {
  allowedOrganisationIds: string[];
  paramName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramName = props.paramName ?? "org";
  const allowedKey = useMemo(
    () => props.allowedOrganisationIds.join("|"),
    [props.allowedOrganisationIds],
  );

  useEffect(() => {
    const allowed = new Set(props.allowedOrganisationIds);
    if (allowed.size === 0) return;

    const currentOrg = searchParams.get(paramName);
    if (currentOrg && allowed.has(currentOrg)) {
      writeSelectedOrganisationId(currentOrg);
      return;
    }

    if (currentOrg) return;

    const stored = readSelectedOrganisationId();
    if (!stored || !allowed.has(stored)) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, stored);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [allowedKey, paramName, pathname, router, searchParams, props.allowedOrganisationIds]);

  return null;
}
