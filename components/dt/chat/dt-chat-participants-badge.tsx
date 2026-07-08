"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Users } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/components/dt/cn";
import type { DtChatParticipant } from "@/lib/dt/oversight";

function participantInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return (label.trim().slice(0, 1) || "?").toUpperCase();
}

export function DtChatParticipantsBadge(props: {
  participants: DtChatParticipant[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const count = props.participants.length;
  const panelVisible = open || hovering;

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (count === 0) return null;

  return (
    <div
      ref={rootRef}
      className={cn("relative shrink-0", props.className)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        type="button"
        aria-expanded={panelVisible}
        aria-controls={panelId}
        aria-label={`${count} Personen in diesem Chat`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-pill border border-sbkm-navy/12 bg-white/70 px-2.5 text-xs font-semibold text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition duration-150 hover:border-sbkm-mint/35 hover:bg-sbkm-mint/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:border-white/12 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/10",
          panelVisible && "border-sbkm-mint/40 bg-sbkm-mint/12 dark:border-sbkm-mint/30",
        )}
      >
        <span className="flex -space-x-1.5">
          {props.participants.slice(0, 3).map((participant) => (
            <span
              key={participant.id}
              className="inline-flex size-5 items-center justify-center rounded-full bg-sbkm-mint/35 text-[9px] font-bold uppercase text-sbkm-navy ring-2 ring-white dark:bg-sbkm-mint/25 dark:text-white dark:ring-sbkm-ink-900"
            >
              {participantInitials(participant.label)}
            </span>
          ))}
        </span>
        <Users className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="tabular-nums">{count}</span>
      </button>

      <AnimatePresence>
        {panelVisible ? (
          <motion.div
            id={panelId}
            role="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+0.35rem)] z-[120] w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-sbkm-navy/12 bg-white/95 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(46,46,80,0.14)] backdrop-blur-md dark:border-white/12 dark:bg-sbkm-ink-900/95"
          >
            <div className="border-b border-sbkm-navy/8 px-3 py-2 dark:border-white/8">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sbkm-ink-500 dark:text-white/45">
                Mitgewirkt
              </p>
              <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
                {count === 1 ? "1 Person" : `${count} Personen`} mit Nachrichten
              </p>
            </div>
            <ul className="max-h-56 overflow-y-auto p-1.5 scrollbar-subtle">
              {props.participants.map((participant) => (
                <li
                  key={participant.id}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sbkm-navy/[0.04] dark:hover:bg-white/[0.05]"
                >
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-sbkm-mint/25 text-[10px] font-bold uppercase text-sbkm-navy dark:bg-sbkm-mint/15 dark:text-sbkm-mint">
                    {participantInitials(participant.label)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-sbkm-navy dark:text-white">
                      {participant.label}
                    </p>
                    <p className="truncate text-xs text-sbkm-ink-500 dark:text-white/50">
                      {participant.email ?? "Keine E-Mail hinterlegt"}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-[11px] text-sbkm-ink-500 dark:text-white/45">
                    {participant.messageCount}×
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
