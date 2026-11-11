"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/components/dt/cn";
import { isSeoWorkspacePath } from "@/lib/dt/seo/dashboard-path";

export function isDashboardChatFocusPath(pathname: string): boolean {
  return isSeoWorkspacePath(pathname);
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
          ? "h-full min-h-0 gap-0 overflow-hidden"
          : // Below lg the bottom padding keeps the floating help button off the last content.
            "min-h-0 flex-1 gap-6 overflow-y-auto overscroll-y-contain px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 scrollbar-subtle sm:px-8 sm:pt-7 lg:pb-7",
      )}
    >
      <div
        className={cn(
          chatFocus
            ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : reportDetail
              ? "min-w-0"
              : // Phones: no wrapper card — pages bring their own cards and need the width.
                "sm:rounded-dt sm:border sm:border-sbkm-navy/10 sm:bg-white/55 sm:p-6 sm:shadow-dt sm:backdrop-blur-[32px] sm:backdrop-saturate-[180%] sm:dark:border-white/10 sm:dark:bg-white/[0.06]",
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
