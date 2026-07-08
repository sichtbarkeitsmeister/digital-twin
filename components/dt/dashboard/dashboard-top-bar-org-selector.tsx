"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SeoTopBarOrgSelector } from "@/components/dt/seo/seo-top-bar-org-selector";
import { DtSelect } from "@/components/dt/dt-select";
import {
  isManageOrgBarPath,
  isOrganisationDashboardPath,
  isSeoDashboardPath,
} from "@/lib/dt/seo/dashboard-path";
import {
  readSelectedOrganisationId,
  writeSelectedOrganisationId,
} from "@/lib/shared/selected-organisation-storage";

type ManageOrganisation = { id: string; name: string };

function MembershipTopBarOrgSelector() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [organisations, setOrganisations] = useState<ManageOrganisation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/dt/organisations/mine");
        const json = (await res.json()) as {
          ok?: boolean;
          organisations?: ManageOrganisation[];
        };
        if (cancelled) return;
        if (json.ok && json.organisations) {
          setOrganisations(json.organisations);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const allowedIds = useMemo(
    () => new Set(organisations.map((organisation) => organisation.id)),
    [organisations],
  );

  const orgId = useMemo(() => {
    const fromUrl = searchParams.get("org");
    if (fromUrl && allowedIds.has(fromUrl)) return fromUrl;
    const stored = readSelectedOrganisationId();
    if (stored && allowedIds.has(stored)) return stored;
    return organisations[0]?.id ?? "";
  }, [searchParams, allowedIds, organisations]);

  const syncOrgToUrl = useCallback(
    (nextOrgId: string) => {
      if (!nextOrgId || !allowedIds.has(nextOrgId)) return;

      writeSelectedOrganisationId(nextOrgId);
      const params = new URLSearchParams(searchParams.toString());
      params.set("org", nextOrgId);
      const qs = params.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [allowedIds, pathname, router, searchParams],
  );

  useEffect(() => {
    if (loading || !orgId || searchParams.get("org") === orgId) return;
    syncOrgToUrl(orgId);
  }, [loading, orgId, searchParams, syncOrgToUrl]);

  if (loading) {
    return (
      <div
        className="h-9 w-full min-w-[12rem] max-w-sm animate-pulse rounded-pill border border-sbkm-navy/10 bg-white/60 dark:border-white/10 dark:bg-white/10"
        aria-hidden
      />
    );
  }

  if (organisations.length === 0) {
    return (
      <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
        Organisation
      </p>
    );
  }

  return (
    <DtSelect
      className="w-full min-w-[12rem] max-w-sm"
      label={undefined}
      srLabel="Organisation"
      size="sm"
      triggerClassName="w-full"
      fullWidth
      menuMaxHeight="max-h-72"
      elevated
      value={orgId}
      onValueChange={syncOrgToUrl}
      disabled={organisations.length <= 1}
      options={organisations.map((organisation) => ({
        value: organisation.id,
        label: organisation.name,
      }))}
    />
  );
}

function ManageTopBarOrgSelector() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [organisations, setOrganisations] = useState<ManageOrganisation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/dt/organisations/manage");
        const json = (await res.json()) as {
          ok?: boolean;
          organisations?: ManageOrganisation[];
        };
        if (cancelled) return;
        if (json.ok && json.organisations) {
          setOrganisations(json.organisations);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const allowedIds = useMemo(
    () => new Set(organisations.map((organisation) => organisation.id)),
    [organisations],
  );

  const orgId = useMemo(() => {
    const fromUrl = searchParams.get("org");
    if (fromUrl && allowedIds.has(fromUrl)) return fromUrl;
    const stored = readSelectedOrganisationId();
    if (stored && allowedIds.has(stored)) return stored;
    return organisations[0]?.id ?? "";
  }, [searchParams, allowedIds, organisations]);

  const syncOrgToUrl = useCallback(
    (nextOrgId: string) => {
      if (!nextOrgId || !allowedIds.has(nextOrgId)) return;

      writeSelectedOrganisationId(nextOrgId);
      const params = new URLSearchParams(searchParams.toString());
      params.set("org", nextOrgId);
      const qs = params.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [allowedIds, pathname, router, searchParams],
  );

  useEffect(() => {
    if (loading || !orgId || searchParams.get("org") === orgId) return;
    syncOrgToUrl(orgId);
  }, [loading, orgId, searchParams, syncOrgToUrl]);

  if (loading) {
    return (
      <div
        className="h-9 w-full min-w-[12rem] max-w-sm animate-pulse rounded-pill border border-sbkm-navy/10 bg-white/60 dark:border-white/10 dark:bg-white/10"
        aria-hidden
      />
    );
  }

  if (organisations.length === 0) {
    return (
      <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
        Organisation
      </p>
    );
  }

  return (
    <DtSelect
      className="w-full min-w-[12rem] max-w-sm"
      label={undefined}
      srLabel="Organisation"
      size="sm"
      triggerClassName="w-full"
      fullWidth
      menuMaxHeight="max-h-72"
      elevated
      value={orgId}
      onValueChange={syncOrgToUrl}
      disabled={organisations.length <= 1}
      options={organisations.map((organisation) => ({
        value: organisation.id,
        label: organisation.name,
      }))}
    />
  );
}

export function DashboardTopBarOrgSelector() {
  const pathname = usePathname();

  if (isSeoDashboardPath(pathname)) {
    return <SeoTopBarOrgSelector />;
  }

  if (isOrganisationDashboardPath(pathname)) {
    return <MembershipTopBarOrgSelector />;
  }

  if (isManageOrgBarPath(pathname)) {
    return <ManageTopBarOrgSelector />;
  }

  return null;
}
