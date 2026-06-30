"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Loader2, Play, Square, Timer, User } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";

type TimeEntryView = {
  id: string;
  userId: string;
  userEmail: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
};

type TimePayload = {
  entries: TimeEntryView[];
  totalSeconds: number;
  myRunningEntry: TimeEntryView | null;
};

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emailLabel(email: string | null): string {
  if (!email) return "Unbekannt";
  return email.split("@")[0] ?? email;
}

export function DtSeoTaskTimePanel(props: { taskId: string }) {
  const [payload, setPayload] = useState<TimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/dt/seo/tasks/${encodeURIComponent(props.taskId)}/time`);
    const json = (await res.json()) as { ok?: boolean; message?: string } & Partial<TimePayload>;
    if (json.ok) {
      setPayload({
        entries: json.entries ?? [],
        totalSeconds: json.totalSeconds ?? 0,
        myRunningEntry: json.myRunningEntry ?? null,
      });
    } else {
      toast.error(json.message ?? "Zeiteinträge konnten nicht geladen werden.");
    }
    setLoading(false);
  }, [props.taskId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const running = payload?.myRunningEntry ?? null;

  // Live ticking while a timer runs.
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!running) return;
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [running]);

  async function toggleTimer(action: "start" | "stop") {
    setBusy(true);
    const res = await fetch(`/api/dt/seo/tasks/${encodeURIComponent(props.taskId)}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string } & Partial<TimePayload>;
    setBusy(false);
    if (!json.ok) {
      toast.error(json.message ?? "Timer-Aktion fehlgeschlagen.");
      return;
    }
    setPayload({
      entries: json.entries ?? [],
      totalSeconds: json.totalSeconds ?? 0,
      myRunningEntry: json.myRunningEntry ?? null,
    });
    toast.success(action === "start" ? "Timer gestartet" : "Timer gestoppt");
  }

  const liveElapsed = running
    ? Math.max(0, Math.round((nowTick - new Date(running.startedAt).getTime()) / 1000))
    : 0;
  const liveTotal = payload
    ? running
      ? payload.entries.reduce((sum, e) => sum + (e.endedAt ? (e.durationSeconds ?? 0) : 0), 0) +
        liveElapsed
      : payload.totalSeconds
    : 0;

  if (loading) {
    return (
      <div className="grid gap-3">
        <div className="h-24 animate-dt-shimmer rounded-dt bg-sbkm-navy/5 dark:bg-white/5" />
        <div className="h-16 animate-dt-shimmer rounded-dt bg-sbkm-navy/5 dark:bg-white/5" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div
        className={cn(
          "relative overflow-hidden rounded-dt border p-4 transition-colors",
          running
            ? "border-sbkm-mint/40 bg-sbkm-mint/10 dark:bg-sbkm-mint/12"
            : "border-sbkm-navy/10 bg-sbkm-navy/[0.03] dark:border-white/10 dark:bg-white/[0.04]",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {running ? "Timer läuft" : "Gesamt erfasst"}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-sbkm-navy dark:text-white">
              {running ? formatDuration(liveElapsed) : formatDuration(liveTotal)}
            </p>
            {running ? (
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                Gesamt: {formatDuration(liveTotal)}
              </p>
            ) : null}
          </div>
          <DtPillButton
            type="button"
            variant={running ? "outline" : "mint"}
            disabled={busy}
            onClick={() => void toggleTimer(running ? "stop" : "start")}
            className={cn(
              "inline-flex items-center justify-center gap-2",
              running && "text-red-600 dark:text-red-400",
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : running ? (
              <Square className="h-4 w-4 fill-current" aria-hidden />
            ) : (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            )}
            {running ? "Stoppen" : "Timer starten"}
          </DtPillButton>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Verlauf
        </p>
        {payload && payload.entries.length > 0 ? (
          <motion.ul
            className="grid gap-2"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
          >
            {payload.entries.map((entry) => {
              const isRunning = entry.endedAt === null;
              const dur = isRunning
                ? Math.max(0, Math.round((nowTick - new Date(entry.startedAt).getTime()) / 1000))
                : entry.durationSeconds ?? 0;
              return (
                <motion.li
                  key={entry.id}
                  variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                  className="flex items-center justify-between gap-3 rounded-dt border border-sbkm-navy/8 bg-white/60 px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sbkm-mint/20 text-sbkm-navy dark:text-white">
                      <User className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-sbkm-navy dark:text-white">
                        {emailLabel(entry.userEmail)}
                      </p>
                      <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                        {formatDateTime(entry.startedAt)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-pill px-2.5 py-1 text-xs font-bold tabular-nums",
                      isRunning
                        ? "bg-sbkm-mint/25 text-sbkm-navy dark:text-white"
                        : "bg-sbkm-navy/8 text-sbkm-navy dark:bg-white/10 dark:text-white",
                    )}
                  >
                    {isRunning ? `${formatDuration(dur)} …` : formatDuration(dur)}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        ) : (
          <p className="rounded-dt border border-dashed border-sbkm-navy/15 px-3 py-6 text-center text-sm text-sbkm-ink-600 dark:border-white/15 dark:text-white/55">
            Noch keine Zeiten erfasst. Starte den Timer, wenn du an dieser Aufgabe arbeitest.
          </p>
        )}
      </div>
    </div>
  );
}
