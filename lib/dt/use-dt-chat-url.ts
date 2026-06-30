"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { DtChatListScope } from "@/lib/dt/db";
import { writeSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";

export type DtChatUrlState = {
  org: string | null;
  chat: string | null;
  scope: DtChatListScope | null;
  owner: string | null;
};

export function readDtChatUrlState(
  searchParams: URLSearchParams,
  options?: { includeScope?: boolean; includeOwner?: boolean },
): DtChatUrlState {
  const scopeRaw = searchParams.get("scope");
  const scope =
    scopeRaw === "mine" || scopeRaw === "team" || scopeRaw === "all" ? scopeRaw : null;
  const ownerRaw = searchParams.get("owner");
  return {
    org: searchParams.get("org"),
    chat: searchParams.get("chat"),
    scope: options?.includeScope !== false ? scope : null,
    owner: options?.includeOwner ? ownerRaw : null,
  };
}

export function useDtChatUrlWriter(options: { includeScope?: boolean; includeOwner?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const writeUrl = useCallback(
    (next: Partial<DtChatUrlState>) => {
      const base =
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString();
      const params = new URLSearchParams(base);

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
      if (options.includeOwner && "owner" in next) {
        if (next.owner) params.set("owner", next.owner);
        else params.delete("owner");
      }

      const qs = params.toString();
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      const currentUrl =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "";
      if (nextUrl === currentUrl) return;

      // Avoid router.replace — it re-fetches the RSC page and resets chat state.
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", nextUrl);
        return;
      }

      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams, options.includeScope, options.includeOwner],
  );

  return { writeUrl, searchParams };
}
