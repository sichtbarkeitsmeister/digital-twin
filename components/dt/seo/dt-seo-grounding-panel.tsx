"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import type {
  GroundingPageSchedule,
  GroundingPageStatus,
} from "@/lib/dt/seo/grounding-page-schedule";
import {
  GROUNDING_PAGE_INTERVAL_MONTHS,
  GROUNDING_PAGE_WARN_DAYS,
} from "@/lib/dt/seo/grounding-page-schedule";

type GroundingPayload = {
  organisationId: string;
  url: string | null;
  uploadedAt: string | null;
  notes: string | null;
  schedule: GroundingPageSchedule;
};

function formatDeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function statusBadge(status: GroundingPageStatus): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
  className?: string;
} {
  if (status === "missing") {
    return { label: "Nicht erfasst", variant: "outline" };
  }
  if (status === "overdue") {
    return { label: "Überfällig", variant: "destructive" };
  }
  if (status === "due_soon") {
    return {
      label: "Bald fällig",
      variant: "outline",
      className: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    };
  }
  return {
    label: "Aktuell",
    variant: "secondary",
    className: "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint",
  };
}

export function DtSeoGroundingPanel(props: {
  organisationId: string;
  canEdit: boolean;
}) {
  const [data, setData] = useState<GroundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dt/seo/grounding?org=${encodeURIComponent(props.organisationId)}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        grounding?: GroundingPayload;
      };
      if (!res.ok || !json.ok || !json.grounding) {
        setError(json.message ?? "Grounding-Page konnte nicht geladen werden.");
        setData(null);
        return;
      }
      setData(json.grounding);
      setUploadedAt(toDateInputValue(json.grounding.uploadedAt));
      setUrl(json.grounding.url ?? "");
      setNotes(json.grounding.notes ?? "");
    } catch {
      setError("Grounding-Page konnte nicht geladen werden.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [props.organisationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const schedule = data?.schedule;
  const badge = useMemo(
    () => statusBadge(schedule?.status ?? "missing"),
    [schedule?.status],
  );

  async function save() {
    if (!props.canEdit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dt/seo/grounding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          uploadedAt: uploadedAt ? uploadedAt : null,
          url: url.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        grounding?: GroundingPayload;
      };
      if (!res.ok || !json.ok || !json.grounding) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      setData(json.grounding);
      setUploadedAt(toDateInputValue(json.grounding.uploadedAt));
      setUrl(json.grounding.url ?? "");
      setNotes(json.grounding.notes ?? "");
      toast.success("Grounding-Page aktualisiert.");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  function markUploadedToday() {
    setUploadedAt(new Date().toISOString().slice(0, 10));
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 pb-8">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-sbkm-navy dark:text-white">
          Grounding Page
        </h2>
        <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
          Alle {GROUNDING_PAGE_INTERVAL_MONTHS} Monate aktualisieren. Ab{" "}
          {GROUNDING_PAGE_WARN_DAYS} Tage vor Fälligkeit erscheint ein Hinweis — die
          Automatisierung kommt später; hier tracken wir Upload und Termin.
        </p>
      </div>

      {loading ? (
        <DtGlassCard variant="subtle" className="flex items-center gap-2 p-4 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Lade Grounding-Page …
        </DtGlassCard>
      ) : error ? (
        <DtGlassCard variant="subtle" className="p-4 text-sm text-destructive">
          {error}
        </DtGlassCard>
      ) : (
        <>
          <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  Status
                </p>
                <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                  {schedule?.statusLabel ?? "—"}
                </p>
              </div>
              <Badge variant={badge.variant} className={cn(badge.className)}>
                {badge.label}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                  Hochgeladen
                </p>
                <p className="mt-1 text-sm font-semibold text-sbkm-navy dark:text-white">
                  {formatDeDate(schedule?.uploadedAt ?? data?.uploadedAt)}
                </p>
              </div>
              <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                  Nächste Aktualisierung
                </p>
                <p className="mt-1 text-sm font-semibold text-sbkm-navy dark:text-white">
                  {formatDeDate(schedule?.nextDueAt)}
                </p>
              </div>
              <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                  Frühwarnung ab
                </p>
                <p className="mt-1 text-sm font-semibold text-sbkm-navy dark:text-white">
                  {formatDeDate(schedule?.warnAt)}
                </p>
              </div>
            </div>

            {schedule?.status === "due_soon" || schedule?.status === "overdue" ? (
              <div
                className={cn(
                  "flex gap-2 rounded-xl px-3 py-2.5 text-sm",
                  schedule.status === "overdue"
                    ? "bg-red-500/10 text-red-800 dark:text-red-200"
                    : "bg-amber-500/10 text-amber-900 dark:text-amber-100",
                )}
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  {schedule.status === "overdue"
                    ? "Die Grounding Page ist älter als drei Monate — bitte aktualisieren und das Upload-Datum hier setzen."
                    : "In weniger als zwei Wochen ist die dreimonatige Aktualisierung fällig."}
                </p>
              </div>
            ) : schedule?.status === "ok" ? (
              <div className="flex gap-2 rounded-xl bg-sbkm-mint/15 px-3 py-2.5 text-sm text-sbkm-navy dark:text-sbkm-mint">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>Im Rhythmus — keine Aktion nötig.</p>
              </div>
            ) : (
              <div className="flex gap-2 rounded-xl bg-sbkm-navy/5 px-3 py-2.5 text-sm text-sbkm-ink-600 dark:bg-white/5 dark:text-white/60">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Noch kein Upload-Datum hinterlegt. Sobald die Page live ist, Datum (und optional
                  URL) speichern.
                </p>
              </div>
            )}

            {data?.url ? (
              <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                Grounding Page öffnen
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </DtGlassCard>

          <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
            <div>
              <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
                Upload erfassen
              </h3>
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                Manuell, bis die Automatisierung greift. Speichern setzt den 3-Monats-Takt neu.
              </p>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Hochgeladen am
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={uploadedAt}
                  disabled={!props.canEdit || saving}
                  onChange={(e) => setUploadedAt(e.target.value)}
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm font-semibold text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
                {props.canEdit ? (
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={markUploadedToday}
                  >
                    Heute
                  </DtPillButton>
                ) : null}
              </div>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                URL (optional)
              </span>
              <input
                type="url"
                value={url}
                disabled={!props.canEdit || saving}
                placeholder="https://…"
                onChange={(e) => setUrl(e.target.value)}
                className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Notiz (optional)
              </span>
              <textarea
                value={notes}
                disabled={!props.canEdit || saving}
                rows={3}
                placeholder="z. B. wo gehostet, was geändert wurde…"
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
              />
            </label>

            {props.canEdit ? (
              <div className="flex flex-wrap gap-2">
                <DtPillButton
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Speichern…
                    </>
                  ) : (
                    "Speichern"
                  )}
                </DtPillButton>
                {uploadedAt ? (
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setUploadedAt("");
                      void (async () => {
                        setSaving(true);
                        try {
                          const res = await fetch("/api/dt/seo/grounding", {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              organisationId: props.organisationId,
                              uploadedAt: null,
                              url: url.trim() || null,
                              notes: notes.trim() || null,
                            }),
                          });
                          const json = (await res.json()) as {
                            ok?: boolean;
                            message?: string;
                            grounding?: GroundingPayload;
                          };
                          if (!json.ok || !json.grounding) {
                            toast.error(json.message ?? "Zurücksetzen fehlgeschlagen.");
                            return;
                          }
                          setData(json.grounding);
                          toast.success("Upload-Datum entfernt.");
                        } finally {
                          setSaving(false);
                        }
                      })();
                    }}
                  >
                    Datum löschen
                  </DtPillButton>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Nur Plattform-Admins können den Upload erfassen.
              </p>
            )}
          </DtGlassCard>
        </>
      )}
    </div>
  );
}
