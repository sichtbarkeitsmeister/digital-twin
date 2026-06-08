"use client";

import { usePathname } from "next/navigation";

import { DashboardHero } from "@/app/dashboard/_components/dashboard-top-bar";
import { cn } from "@/components/dt/cn";

const CHAT_FOCUS_PATHS = ["/dashboard/verwaltung/seo"] as const;

export function isDashboardChatFocusPath(pathname: string): boolean {
  if (pathname.includes("/seo/reports/")) return false;
  return CHAT_FOCUS_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isSeoReportDetailPath(pathname: string): boolean {
  return pathname.includes("/seo/reports/");
}

export function DashboardMainArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chatFocus = isDashboardChatFocusPath(pathname);
  const reportDetail = isSeoReportDetailPath(pathname);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1700px] flex-1 flex-col",
        chatFocus
          ? "h-full min-h-0 gap-0 overflow-hidden px-3 py-3 sm:px-5 sm:py-4"
          : "min-h-0 flex-1 gap-6 overflow-y-auto overscroll-y-contain px-4 py-6 scrollbar-subtle sm:px-8 sm:py-7",
      )}
    >
      {!chatFocus && !reportDetail ? <DashboardHero /> : null}

      <div
        className={cn(
          chatFocus
            ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : reportDetail
              ? "min-w-0"
              : "rounded-dt border border-sbkm-navy/10 bg-white/55 p-5 shadow-dt backdrop-blur-[32px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-white/[0.06] sm:p-6",
        )}
      >
        {children}
      </div>

      {!chatFocus && !reportDetail ? (
        <footer className="flex flex-col gap-2 border-t border-sbkm-navy/[0.08] pt-6 text-xs text-sbkm-ink-600 dark:border-white/10 dark:text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <span>© DigitalTwin · planbar, messbar, ohne Blackbox.</span>
          <span>
            Powered by <strong className="text-sbkm-navy dark:text-white">sbkm.</strong>
          </span>
        </footer>
      ) : null}
    </div>
  );
}
