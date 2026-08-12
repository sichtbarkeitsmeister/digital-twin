import { CalendarDays } from "lucide-react";

import { cn } from "@/components/dt/cn";

export function isMonthlySeoReport(report: {
  trigger_source?: string | null;
}): boolean {
  return report.trigger_source === "monthly_scheduler";
}

export function DtSeoMonthlyReportBadge(props: {
  report: { trigger_source?: string | null };
  className?: string;
}) {
  if (!isMonthlySeoReport(props.report)) return null;

  return (
    <span
      title="Automatisch vom monatlichen Scheduler erstellt"
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border border-sbkm-navy/25 bg-sbkm-navy px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm dark:border-sbkm-mint/40 dark:bg-sbkm-mint dark:text-sbkm-navy",
        props.className,
      )}
    >
      <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
      Monatlicher Report
    </span>
  );
}
