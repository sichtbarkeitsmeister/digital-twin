"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { writeSelectedOrganisationId } from "@/lib/shared/selected-organisation-storage";

export const DT_SEO_TAB_IDS = [
  "chat",
  "stats",
  "tasks",
  "reports",
  "analyse",
  "grounding",
  "settings",
] as const;
export type DtSeoTabId = (typeof DT_SEO_TAB_IDS)[number];

export const DT_TASK_STATUS_IDS = ["open", "in_progress", "done", "wont_fix"] as const;
export type DtTaskStatus = (typeof DT_TASK_STATUS_IDS)[number];

export function parseDtSeoTab(raw: string | null): DtSeoTabId {
  if (raw && (DT_SEO_TAB_IDS as readonly string[]).includes(raw)) {
    return raw as DtSeoTabId;
  }
  return "chat";
}

export function parseDtTaskStatus(raw: string | null): DtTaskStatus {
  if (raw && (DT_TASK_STATUS_IDS as readonly string[]).includes(raw)) {
    return raw as DtTaskStatus;
  }
  return "open";
}

export function useDtSeoWorkspaceUrl() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = useMemo(() => parseDtSeoTab(searchParams.get("tab")), [searchParams]);
  const taskStatus = useMemo(() => parseDtTaskStatus(searchParams.get("status")), [searchParams]);
  const taskFocus = searchParams.get("focus") === "1";

  const writeUrl = useCallback(
    (next: {
      org?: string | null;
      chat?: string | null;
      tab?: DtSeoTabId | null;
      taskStatus?: DtTaskStatus | null;
      taskFocus?: boolean | null;
    }) => {
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
      if ("tab" in next) {
        if (next.tab && next.tab !== "chat") params.set("tab", next.tab);
        else params.delete("tab");
        if (next.tab && next.tab !== "tasks") {
          params.delete("status");
          params.delete("focus");
        }
      }
      if ("taskStatus" in next) {
        if (next.taskStatus && next.taskStatus !== "open") params.set("status", next.taskStatus);
        else params.delete("status");
      }
      if ("taskFocus" in next) {
        if (next.taskFocus) params.set("focus", "1");
        else params.delete("focus");
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
    [pathname, router, searchParams],
  );

  return { writeUrl, searchParams, tab, taskStatus, taskFocus };
}
