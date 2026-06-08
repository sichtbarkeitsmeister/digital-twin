"use client";

import { formatDtReplyVia } from "@/lib/dt/reply-via";

export function DtChatDevViaPill(props: { via: string | null }) {
  if (process.env.NODE_ENV !== "development") return null;

  const label = formatDtReplyVia(props.via);
  if (!label) return null;

  const isN8n = props.via === "n8n";

  return (
    <p
      className="mt-1 text-center font-mono text-[10px] tracking-wide text-sbkm-ink-500 dark:text-white/40"
      aria-label={`Antwortweg: ${label}`}
    >
      <span className="rounded-md border border-dashed border-sbkm-navy/20 bg-sbkm-navy/[0.04] px-2 py-0.5 dark:border-white/15 dark:bg-white/5">
        via{" "}
        <span
          className={
            isN8n
              ? "font-semibold text-violet-600 dark:text-violet-300"
              : "font-semibold text-emerald-700 dark:text-emerald-300"
          }
        >
          {label}
        </span>
        <span className="text-sbkm-ink-400 dark:text-white/30"> · nur dev</span>
      </span>
    </p>
  );
}
