"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DtSelect } from "@/components/dt/dt-select";
import { isSeoWorkspacePath } from "@/lib/dt/seo/dashboard-path";
import { useDtSeoWorkspaceUrl } from "@/lib/dt/seo/workspace-url";
import type { DtSeoOrganisation } from "@/lib/dt/load-seo-organisations";
import {
  readSelectedOrganisationId,
  writeSelectedOrganisationId,
} from "@/lib/shared/selected-organisation-storage";

export function SeoTopBarOrgSelector() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { writeUrl, tab } = useDtSeoWorkspaceUrl();
  const onWorkspace = isSeoWorkspacePath(pathname);

  const [organisations, setOrganisations] = useState<DtSeoOrganisation[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/dt/seo/organisations");
        const json = (await res.json()) as {
          ok?: boolean;
          organisations?: DtSeoOrganisation[];
          isPlatformAdmin?: boolean;
        };
        if (cancelled) return;
        if (json.ok && json.organisations) {
          setOrganisations(json.organisations);
          setIsPlatformAdmin(Boolean(json.isPlatformAdmin));
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

      if (onWorkspace) {
        writeUrl({
          org: nextOrgId,
          chat: null,
          tab,
        });
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      params.set("org", nextOrgId);
      const qs = params.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [allowedIds, onWorkspace, pathname, router, searchParams, writeUrl, tab],
  );

  useEffect(() => {
    if (loading || !orgId || searchParams.get("org") === orgId) return;
    syncOrgToUrl(orgId);
  }, [loading, orgId, searchParams, syncOrgToUrl]);

  const handleOrgChange = useCallback(
    (id: string) => {
      syncOrgToUrl(id);
    },
    [syncOrgToUrl],
  );

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
        SEO
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
      onValueChange={handleOrgChange}
      disabled={organisations.length <= 1}
      options={organisations.map((organisation) => ({
        value: organisation.id,
        label: organisation.name,
        description:
          !organisation.seoEnabled && isPlatformAdmin
            ? "SEO deaktiviert"
            : organisation.slug ?? undefined,
      }))}
    />
  );
}
