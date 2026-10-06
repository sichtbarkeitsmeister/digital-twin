import { CheckCircle2 } from "lucide-react";

import { cn } from "@/components/dt/cn";
import { contentStateMeta, type ContentStateTone } from "@/lib/dt/content/presentation";

const toneClass: Record<ContentStateTone, string> = {
  grey: "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
  yellow: "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-100",
  orange: "bg-orange-500 text-white shadow-[0_4px_14px_rgba(249,115,22,0.35)] dark:bg-orange-500",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
};

export function DtContentStatusBadge(props: {
  state: string;
  released?: boolean;
  className?: string;
}) {
  const meta = contentStateMeta(props.state);
  const released = meta.tone === "green" && props.released;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-[11px] font-bold tracking-wide",
        toneClass[meta.tone],
        props.className,
      )}
    >
      {meta.tone === "blue" ? (
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-sky-500" />
        </span>
      ) : null}
      {meta.label}
      {released ? (
        <CheckCircle2 className="size-3.5" aria-label="Freigegeben" />
      ) : null}
    </span>
  );
}
