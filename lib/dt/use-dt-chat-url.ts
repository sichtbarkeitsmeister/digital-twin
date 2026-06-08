"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { DtChatListScope } from "@/lib/dt/db";
import { writeSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";

export type DtChatUrlState = {
  org: string | null;
  chat: string | null;
  scope: DtChatListScope | null;
};

export function readDtChatUrlState(
  searchParams: URLSearchParams,
  options?: { includeScope?: boolean },
): DtChatUrlState {
  const scopeRaw = searchParams.get("scope");
  const scope =
    scopeRaw === "mine" || scopeRaw === "team" || scopeRaw === "all" ? scopeRaw : null;
  return {
    org: searchParams.get("org"),
    chat: searchParams.get("chat"),
    scope: options?.includeScope !== false ? scope : null,
  };
}

export function useDtChatUrlWriter(options: { includeScope?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const writeUrl = useCallback(
    (next: Partial<DtChatUrlState>) => {
      const params = new URLSearchParams(searchParams.toString());

      if ("org" in next) {
        if (next.org) {
          params.set("org", next.org);
          writeSelectedOrganisationId(next.org);
        } else {
          params.delete("org");
        }
      }
      if ("chat" in next) {
        if (next.chat) params.set("chat", next.chat);
        else params.delete("chat");
      }
      if (options.includeScope !== false && "scope" in next) {
        if (next.scope) params.set("scope", next.scope);
        else params.delete("scope");
      }

      const qs = params.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      const currentUrl =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "";
      if (nextUrl === currentUrl) return;

      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams, options.includeScope],
  );

  return { writeUrl, searchParams };
}
