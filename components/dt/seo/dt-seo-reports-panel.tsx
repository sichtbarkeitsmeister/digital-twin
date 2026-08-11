"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, Mail, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSeoOwnerDeliveryBadge } from "@/components/dt/seo/dt-seo-owner-delivery-badge";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/dt/cn";
import {
  evaluateSeoReportReadiness,
  type SeoReportReadiness,
} from "@/lib/dt/seo/report-readiness";
import { reportStateLabel } from "@/lib/dt/seo/report-payload";
import type { DtSeoReportRow } from "@/lib/dt/types";

function reportBadgeVariant(state: string): "secondary" | "destructive" | "outline" {
  if (state === "done") return "secondary";
  if (state === "error" || state === "cancelled") return "destructive";
  return "outline";
}

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
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sendToOwner, setSendToOwner] = useState(false);
  const [reportRecipientEmail, setReportRecipientEmail] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<SeoReportReadiness | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/dt/seo/reports?org=${encodeURIComponent(props.organisationId)}`);
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        reports?: DtSeoReportRow[];
      };
      if (!res.ok || !json.ok) {
        setStatus(`Fehler: ${json.message ?? "Reports konnten nicht geladen werden."}`);
        return;
      }
      if (json.reports) setReports(json.reports as DtSeoReportRow[]);
    } catch {
      setStatus("Fehler: Reports konnten nicht geladen werden.");
    }
  }, [props.organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!dialogOpen) return;
    void fetch(`/api/dt/org-config/${encodeURIComponent(props.organisationId)}`)
      .then((r) => r.json())
      .then(
        (json: {
          ok?: boolean;
          config?: {
            report_recipient_email?: string | null;
            website_url?: string | null;
            ga4_account?: string | null;
            gsc_account?: string | null;
            organisation_slug?: string | null;
          };
        }) => {
          const email = json.config?.report_recipient_email?.trim() || null;
          setReportRecipientEmail(email);
          if (!email) setSendToOwner(false);
          setReadiness(
            evaluateSeoReportReadiness({
              organisationSlug: json.config?.organisation_slug,
              websiteUrl: json.config?.website_url,
              ga4Account: json.config?.ga4_account,
              gscAccount: json.config?.gsc_account,
            }),
          );
        },
      );
  }, [dialogOpen, props.organisationId]);

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
            const state = j.report?.state;
            if (state === "done" || state === "error" || state === "cancelled") {
              setActiveId(null);
              if (state === "error" || state === "cancelled") {
                const msg = j.report?.state_message?.trim();
                setStatus(
                  msg
                    ? msg.startsWith("Fehler:")
                      ? msg
                      : `Fehler: ${msg}`
                    : state === "cancelled"
                      ? "Fehler: Report abgebrochen."
                      : "Fehler: Report-Erstellung fehlgeschlagen.",
                );
              }
              void refresh();
            }
          })
          .catch(() => {
            setStatus("Fehler: Report-Status konnte nicht geladen werden.");
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
        sendToOwner,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      report?: DtSeoReportRow;
    };
    setBusy(false);
    setDialogOpen(false);
    if (!json.ok) {
      setStatus(json.message ?? "Report konnte nicht gestartet werden.");
      return;
    }
    if (json.report?.id) setActiveId(json.report.id);
    setStatus(
      sendToOwner
        ? "SEO-Report gestartet — er wird nach Fertigstellung an die Report-E-Mail gesendet."
        : "SEO-Report gestartet — Status wird aktualisiert.",
    );
    await refresh();
  }

  async function stopReport(reportId: string) {
    setStoppingId(reportId);
    const res = await fetch(`/api/dt/seo/reports/${encodeURIComponent(reportId)}/stop`, {
      method: "POST",
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setStoppingId(null);
    if (!json.ok) {
      toast.error(json.message ?? "Report konnte nicht gestoppt werden.");
      await refresh();
      return;
    }
    toast.success("Report abgebrochen.");
    if (activeId === reportId) setActiveId(null);
    await refresh();
  }

  async function deleteReport(reportId: string) {
    if (!window.confirm("Report wirklich löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setDeletingId(reportId);
    const res = await fetch(`/api/dt/seo/reports/${encodeURIComponent(reportId)}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setDeletingId(null);
    if (!json.ok) {
      toast.error(json.message ?? "Report konnte nicht gelöscht werden.");
      await refresh();
      return;
    }
    toast.success("Report gelöscht.");
    if (activeId === reportId) setActiveId(null);
    setReports((prev) => prev.filter((r) => r.id !== reportId));
    await refresh();
  }

  return (
    <div className="grid gap-4">
      {props.canTrigger ? (
        <DtPillButton
          type="button"
          disabled={busy}
          onClick={() => {
            setStatus(null);
            setReadiness(null);
            setDialogOpen(true);
          }}
        >
          SEO-Report erstellen
        </DtPillButton>
      ) : null}
      {status ? (
        <p
          className={
            status.startsWith("Fehler")
              ? "text-sm text-red-600 dark:text-red-400"
              : "text-sm text-sbkm-ink-600 dark:text-white/60"
          }
          role={status.startsWith("Fehler") ? "alert" : undefined}
        >
          {status}
        </p>
      ) : null}

      <AnimatePresence>
        {dialogOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-sbkm-navy/50 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="seo-report-dialog-title"
            onClick={() => !busy && setDialogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md rounded-dt border border-sbkm-navy/10 bg-white p-6 shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <h2
                  id="seo-report-dialog-title"
                  className="text-lg font-semibold tracking-tight text-sbkm-navy dark:text-white"
                >
                  SEO-Report erstellen
                </h2>
                <button
                  type="button"
                  aria-label="Schließen"
                  disabled={busy}
                  onClick={() => setDialogOpen(false)}
                  className="rounded-full p-1 text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/5 hover:text-sbkm-navy disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <p className="mt-2 text-sm text-sbkm-ink-600 dark:text-white/60">
                Der Report wird im Hintergrund erstellt. Du kannst ihn optional automatisch an die
                Report-E-Mail aus den SEO-Einstellungen senden lassen.
              </p>

              {readiness && readiness.issues.length > 0 ? (
                <div
                  className={cn(
                    "mt-4 rounded-dt border p-3 text-sm",
                    readiness.ok
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                      : "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200",
                  )}
                  role={readiness.ok ? "status" : "alert"}
                >
                  <p className="font-semibold">
                    {readiness.ok ? "Hinweise vor dem Start" : "Report kann noch nicht gestartet werden"}
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    {readiness.issues.map((issue) => (
                      <li key={issue.code}>{issue.message}</li>
                    ))}
                  </ul>
                  <Link
                    href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(props.organisationId)}&tab=settings`}
                    className="mt-2 inline-flex text-xs font-semibold underline underline-offset-2"
                  >
                    Zu den SEO-Einstellungen
                  </Link>
                </div>
              ) : null}

              <label
                className={cn(
                  "mt-5 flex items-start gap-3 rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.03] p-3 dark:border-white/10 dark:bg-white/5",
                  !reportRecipientEmail ? "opacity-60" : "cursor-pointer",
                )}
              >
                <Checkbox
                  checked={sendToOwner}
                  disabled={!reportRecipientEmail}
                  onCheckedChange={(v) => setSendToOwner(v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm text-sbkm-navy dark:text-white">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    Per E-Mail senden
                  </span>
                  <span className="mt-0.5 block text-xs text-sbkm-ink-600 dark:text-white/55">
                    {reportRecipientEmail
                      ? `Nach Fertigstellung an ${reportRecipientEmail}.`
                      : "Bitte zuerst eine Report-E-Mail in den SEO-Einstellungen hinterlegen."}
                  </span>
                </span>
              </label>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialogOpen(false)}
                  className="rounded-pill px-4 py-2 text-sm font-medium text-sbkm-ink-600 transition-colors hover:bg-sbkm-navy/5 disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
                >
                  Abbrechen
                </button>
                <DtPillButton
                  type="button"
                  disabled={busy || (readiness != null && !readiness.ok)}
                  onClick={() => void triggerReport()}
                >
                  {busy ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Wird gestartet…
                    </span>
                  ) : (
                    "Report starten"
                  )}
                </DtPillButton>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-3">
        {reports.length === 0 ? (
          <p className="text-sm text-sbkm-ink-600">Noch keine Reports.</p>
        ) : (
          reports.map((r) => {
            const href = `/dashboard/verwaltung/seo/reports/${r.id}?org=${encodeURIComponent(props.organisationId)}`;
            const runtime = durationHint(r.started_at, r.finished_at);
            const inProgress = r.state === "queued" || r.state === "running";
            const isErrorish = r.state === "error" || r.state === "cancelled";
            return (
              <DtGlassCard
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <Link
                  href={href}
                  className="min-w-0 flex-1 rounded-dt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45"
                >
                  <p className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
                    {new Date(r.created_at).toLocaleString("de-DE")}
                  </p>
                  <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                    {r.recipient_type} · {r.recipient_email}
                    {runtime ? ` · ${runtime}` : null}
                  </p>
                  {isErrorish ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {r.state_message?.trim()
                        ? r.state_message.startsWith("Fehler:")
                          ? r.state_message
                          : `Fehler: ${r.state_message}`
                        : r.state === "cancelled"
                          ? "Fehler: Report abgebrochen."
                          : "Fehler: Report-Erstellung fehlgeschlagen."}
                    </p>
                  ) : null}
                  {r.state === "done" ? (
                    <p className="mt-1 text-xs font-medium text-sbkm-mint">Details ansehen</p>
                  ) : null}
                </Link>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <DtSeoOwnerDeliveryBadge report={r} />
                  {inProgress && props.canTrigger ? (
                    <button
                      type="button"
                      disabled={stoppingId === r.id || deletingId === r.id}
                      onClick={() => void stopReport(r.id)}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors duration-150 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                    >
                      {stoppingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                      )}
                      Stoppen
                    </button>
                  ) : null}
                  {props.canTrigger ? (
                    <button
                      type="button"
                      disabled={deletingId === r.id || stoppingId === r.id}
                      onClick={() => void deleteReport(r.id)}
                      aria-label="Report löschen"
                      title="Löschen"
                      className="inline-flex items-center justify-center rounded-pill border border-red-300/80 bg-white p-1.5 text-red-600 transition-colors duration-150 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60"
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  ) : null}
                  <Badge variant={reportBadgeVariant(r.state)}>{reportStateLabel(r.state)}</Badge>
                  <Link href={href} aria-label="Report öffnen">
                    <ChevronRight
                      className="h-4 w-4 text-sbkm-ink-400 dark:text-white/40"
                      aria-hidden
                    />
                  </Link>
                </div>
              </DtGlassCard>
            );
          })
        )}
      </div>
    </div>
  );
}
