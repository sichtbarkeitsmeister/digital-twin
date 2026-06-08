"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import { reportStateLabel } from "@/lib/dt/seo/report-payload";
import type { DtSeoReportRow } from "@/lib/dt/types";

const POLL_MS = 15_000;

function durationHint(started: string | null, finished: string | null): string | null {
  if (!started || !finished) return null;
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "unter 1 Min.";
  return `ca. ${min} Min.`;
}

export function DtSeoReportsPanel(props: {
  organisationId: string;
  canTrigger: boolean;
}) {
  const [reports, setReports] = useState<DtSeoReportRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dt/seo/reports?org=${encodeURIComponent(props.organisationId)}`);
    const json = (await res.json()) as { ok?: boolean; reports?: DtSeoReportRow[] };
    if (json.ok && json.reports) setReports(json.reports as DtSeoReportRow[]);
  }, [props.organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const running = reports.some((r) => r.state === "queued" || r.state === "running");
    if (!running && !activeId) return;

    pollRef.current = setInterval(() => {
      void refresh();
      if (activeId) {
        void fetch(`/api/dt/seo/reports/${activeId}`)
          .then((r) => r.json())
          .then((j: { report?: DtSeoReportRow }) => {
            if (j.report?.state === "done" || j.report?.state === "error") {
              setActiveId(null);
              void refresh();
            }
          });
      }
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [reports, activeId, refresh]);

  async function triggerReport() {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/dt/seo/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: props.organisationId,
        recipientType: "kunde",
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      report?: DtSeoReportRow;
    };
    setBusy(false);
    if (!json.ok) {
      setStatus(json.message ?? "Report konnte nicht gestartet werden.");
      return;
    }
    if (json.report?.id) setActiveId(json.report.id);
    setStatus("SEO-Report gestartet — Status wird aktualisiert.");
    await refresh();
  }

  return (
    <div className="grid gap-4">
      {props.canTrigger ? (
        <DtPillButton type="button" disabled={busy} onClick={() => void triggerReport()}>
          SEO-Report erstellen
        </DtPillButton>
      ) : null}
      {status ? <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{status}</p> : null}

      <div className="grid gap-3">
        {reports.length === 0 ? (
          <p className="text-sm text-sbkm-ink-600">Noch keine Reports.</p>
        ) : (
          reports.map((r) => {
            const href = `/dashboard/verwaltung/seo/reports/${r.id}?org=${encodeURIComponent(props.organisationId)}`;
            const runtime = durationHint(r.started_at, r.finished_at);
            return (
              <Link
                key={r.id}
                href={href}
                className={cn(
                  "block rounded-dt transition-all duration-200",
                  "hover:-translate-y-0.5 hover:shadow-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
                )}
              >
                <DtGlassCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
                      {new Date(r.created_at).toLocaleString("de-DE")}
                    </p>
                    <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                      {r.recipient_type} · {r.recipient_email}
                      {runtime ? ` · ${runtime}` : null}
                    </p>
                    {r.state_message ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{r.state_message}</p>
                    ) : null}
                    {r.state === "done" ? (
                      <p className="mt-1 text-xs font-medium text-sbkm-mint">Details ansehen</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={
                        r.state === "done"
                          ? "secondary"
                          : r.state === "error"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {reportStateLabel(r.state)}
                    </Badge>
                    <ChevronRight
                      className="h-4 w-4 text-sbkm-ink-400 dark:text-white/40"
                      aria-hidden
                    />
                  </div>
                </DtGlassCard>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
