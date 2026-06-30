import { Mail } from "lucide-react";

import { cn } from "@/components/dt/cn";
import {
  resolveOwnerDeliveryStatus,
  type OwnerDeliveryStatus,
} from "@/lib/dt/seo/report-payload";

const toneClass: Record<OwnerDeliveryStatus["tone"], string> = {
  sent: "border-sbkm-mint/30 bg-sbkm-mint/10 text-sbkm-mint dark:border-sbkm-mint/25 dark:bg-sbkm-mint/15",
  pending:
    "border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200",
  scheduled:
    "border-sbkm-navy/15 bg-sbkm-navy/[0.04] text-sbkm-ink-600 dark:border-white/15 dark:bg-white/5 dark:text-white/55",
};

export function DtSeoOwnerDeliveryBadge(props: {
  report: {
    send_to_owner?: boolean;
    owner_sent_at?: string | null;
    state: string;
  };
  className?: string;
}) {
  const status = resolveOwnerDeliveryStatus(props.report);
  if (!status) return null;

  return (
    <span
      title={status.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        toneClass[status.tone],
        props.className,
      )}
    >
      <Mail className="h-3 w-3 shrink-0" aria-hidden />
      {status.label}
    </span>
  );
}
