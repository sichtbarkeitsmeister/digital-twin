"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  Loader2,
  Radar,
  RefreshCw,
  Search,
} from "lucide-react";
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
import type { GroundingCommand, GroundingEntityPage, GroundingReleaseStatus } from "@/lib/dt/seo/grounding-pages";
import { DtSeoGroundingEntities } from "@/components/dt/seo/dt-seo-grounding-entities";
import { DtSeoGroundingRulesCard } from "@/components/dt/seo/dt-seo-grounding-rules-card";

type LlmsTxtStatus =
  | {
      found: true;
      url: string;
      lastModified: string | null;
      bytes: number;
    }
  | {
      found: false;
      message: string;
      tried?: string[];
    };

type GroundingPayload = {
  organisationId: string;
  url: string | null;
  uploadedAt: string | null;
  dateModified?: string | null;
  lastReviewed?: string | null;
  reviewedBy?: string | null;
  releaseStatus?: GroundingReleaseStatus | null;
  standardVersion?: string | null;
  customerSlug?: string | null;
  notes: string | null;
  llmsTxtUrl?: string | null;
  entities?: GroundingEntityPage[];
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
  if (status === "review_missing") {
    return {
      label: "Prüfung offen",
      variant: "outline",
      className: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    };
  }
  if (status === "overdue") {
    return { label: "Überfällig", variant: "destructive" };
  }
  if (status === "due_soon") {
    return {
      label: "Frühwarnung",
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
  onOpenChat?: (chatId: string, draft: string) => void;
}) {
  const [data, setData] = useState<GroundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState("");
  const [dateModified, setDateModified] = useState("");
  const [lastReviewed, setLastReviewed] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [releaseStatus, setReleaseStatus] = useState<"" | GroundingReleaseStatus>("");
  const [standardVersion, setStandardVersion] = useState("");
  const [customerSlug, setCustomerSlug] = useState("");
  const [url, setUrl] = useState("");
  const [llmsTxtUrl, setLlmsTxtUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [entities, setEntities] = useState<GroundingEntityPage[]>([]);
  const [lastDetection, setLastDetection] = useState<string | null>(null);
  const [starting, setStarting] = useState<GroundingCommand | null>(null);

  function applyGrounding(grounding: GroundingPayload) {
    setData(grounding);
    setUploadedAt(toDateInputValue(grounding.uploadedAt));
    setDateModified(toDateInputValue(grounding.dateModified));
    setLastReviewed(toDateInputValue(grounding.lastReviewed));
    setReviewedBy(grounding.reviewedBy ?? "");
    setReleaseStatus(grounding.releaseStatus ?? "");
    setStandardVersion(grounding.standardVersion ?? "");
    setCustomerSlug(grounding.customerSlug ?? "");
    setUrl(grounding.url ?? "");
    setLlmsTxtUrl(grounding.llmsTxtUrl ?? "");
    setNotes(grounding.notes ?? "");
    setEntities(grounding.entities ?? []);
  }
  const [llmsTxt, setLlmsTxt] = useState<LlmsTxtStatus | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const autoParam = props.canEdit ? "&auto=1" : "";
      const res = await fetch(
        `/api/dt/seo/grounding?org=${encodeURIComponent(props.organisationId)}${autoParam}`,
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        grounding?: GroundingPayload;
        discoveredUrl?: string | null;
        discoveryMessage?: string | null;
        discoverySource?: "footer" | "path_probe" | null;
        autoApplied?: boolean;
        llmsTxt?: LlmsTxtStatus;
      };
      if (!res.ok || !json.ok || !json.grounding) {
        setError(json.message ?? "Grounding-Page konnte nicht geladen werden.");
        setData(null);
        return;
      }
      applyGrounding({
        ...json.grounding,
        url: json.grounding.url ?? json.discoveredUrl ?? null,
        llmsTxtUrl:
          json.grounding.llmsTxtUrl ??
          (json.llmsTxt?.found ? json.llmsTxt.url : null) ??
          null,
      });
      setLlmsTxt(json.llmsTxt ?? null);
      if (json.autoApplied && json.grounding.uploadedAt) {
        const via =
          json.discoverySource === "footer" ? "Footer-Link" : "automatisch erkannt";
        setLastDetection(`${formatDeDate(json.grounding.uploadedAt)} · ${via}`);
        toast.success("Grounding Page gefunden und Datum übernommen.");
      } else if (!json.grounding.url && json.discoveredUrl) {
        setUrl(json.discoveredUrl);
      } else if (!json.grounding.url && json.discoveryMessage) {
        setLastDetection(json.discoveryMessage);
      }
    } catch {
      setError("Grounding-Page konnte nicht geladen werden.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [props.canEdit, props.organisationId]);

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
          dateModified: dateModified ? dateModified : null,
          lastReviewed: lastReviewed ? lastReviewed : null,
          reviewedBy: reviewedBy.trim() || null,
          releaseStatus: releaseStatus || null,
          standardVersion: standardVersion.trim() || null,
          customerSlug: customerSlug.trim() || null,
          url: url.trim() || null,
          llmsTxtUrl: llmsTxtUrl.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        grounding?: GroundingPayload;
        llmsTxt?: LlmsTxtStatus;
      };
      if (!res.ok || !json.ok || !json.grounding) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      applyGrounding({
        ...json.grounding,
        llmsTxtUrl:
          json.grounding.llmsTxtUrl ??
          (json.llmsTxt?.found ? json.llmsTxt.url : null) ??
          null,
      });
      if (json.llmsTxt) setLlmsTxt(json.llmsTxt);
      toast.success("Grounding-Page aktualisiert.");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function detectFromPage(apply: boolean) {
    if (!props.canEdit) return;
    const targetUrl = url.trim();
    if (!targetUrl) {
      toast.error("Bitte zuerst die URL der Grounding Page eintragen.");
      return;
    }
    setDetecting(true);
    setLastDetection(null);
    try {
      const res = await fetch("/api/dt/seo/grounding/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          url: targetUrl,
          apply,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        detection?: {
          detectedAt: string | null;
          appliesToUpload?: boolean;
          sourceLabel: string;
          finalUrl?: string;
          lastReviewed?: { at: string; sourceLabel: string } | null;
          dateModified?: { at: string; sourceLabel: string } | null;
          reviewedBy?: { name: string; sourceLabel: string } | null;
        };
        grounding?: GroundingPayload;
      };
      if (!res.ok || !json.ok || !json.detection) {
        toast.error(json.message ?? "Datum konnte nicht gelesen werden.");
        return;
      }
      const parts = [json.detection.sourceLabel];
      if (json.detection.appliesToUpload && json.detection.detectedAt) {
        setUploadedAt(toDateInputValue(json.detection.detectedAt));
      }
      if (json.detection.dateModified?.at) {
        setDateModified(toDateInputValue(json.detection.dateModified.at));
        parts.push(`dateModified: ${json.detection.dateModified.sourceLabel}`);
      }
      if (json.detection.lastReviewed?.at) {
        setLastReviewed(toDateInputValue(json.detection.lastReviewed.at));
        parts.push(`Prüfung: ${json.detection.lastReviewed.sourceLabel}`);
      }
      if (json.detection.reviewedBy?.name) {
        setReviewedBy(json.detection.reviewedBy.name);
        parts.push(`Prüfer: ${json.detection.reviewedBy.sourceLabel}`);
      }
      if (json.detection.finalUrl) setUrl(json.detection.finalUrl);
      setLastDetection(parts.join(" · "));
      if (json.grounding) {
        applyGrounding(json.grounding);
        toast.success("Daten von der Seite gelesen und gespeichert.");
      } else {
        toast.success("Daten von der Seite gelesen — bitte Speichern.");
      }
    } catch {
      toast.error("Datum konnte nicht gelesen werden.");
    } finally {
      setDetecting(false);
    }
  }

  function markUploadedToday() {
    setUploadedAt(new Date().toISOString().slice(0, 10));
  }

  async function startCommand(command: GroundingCommand) {
    if (!props.canEdit) return;
    setStarting(command);
    try {
      const res = await fetch("/api/dt/seo/grounding/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, command }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        chatId?: string;
        draft?: string;
      };
      if (!res.ok || !json.ok || !json.chatId) {
        toast.error(json.message ?? "Auftrag konnte nicht gestartet werden.");
        return;
      }
      props.onOpenChat?.(json.chatId, json.draft ?? "");
    } catch {
      toast.error("Auftrag konnte nicht gestartet werden.");
    } finally {
      setStarting(null);
    }
  }

  async function saveEntities(next: GroundingEntityPage[]) {
    if (!props.canEdit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dt/seo/grounding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          entityPages: next,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        grounding?: GroundingPayload;
      };
      if (!res.ok || !json.ok || !json.grounding) {
        toast.error(json.message ?? "Entitätsseiten konnten nicht gespeichert werden.");
        return;
      }
      applyGrounding(json.grounding);
      toast.success("Entitätsseiten gespeichert.");
    } catch {
      toast.error("Entitätsseiten konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 pb-8">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-sbkm-navy dark:text-white">
          Grounding Pages
        </h2>
        <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
          Hub und Entitätsseiten. Die Fälligkeit liegt {GROUNDING_PAGE_INTERVAL_MONTHS} Monate nach
          der letzten menschlichen Prüfung (lastReviewed), nicht nach dem Upload. Ab{" "}
          {GROUNDING_PAGE_WARN_DAYS} Tage vorher gilt die Frühwarnung. Der Auftrag schreibt jede
          Zielgruppe einzeln in „Anfragen & Lösungen“. Die Regeln dafür stehen darunter und gelten
          für alle Organisationen.
        </p>
      </div>

      <DtSeoGroundingRulesCard canEdit={props.canEdit} />

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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
                  Zuletzt geprüft
                </p>
                <p className="mt-1 text-sm font-semibold text-sbkm-navy dark:text-white">
                  {formatDeDate(schedule?.lastReviewed ?? data?.lastReviewed)}
                </p>
              </div>
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
                  Nächste Prüfung
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
                    ? "Die letzte menschliche Prüfung liegt mehr als drei Monate zurück."
                    : "Frühwarnung: die nächste Prüfung ist in weniger als zwei Wochen fällig."}
                </p>
              </div>
            ) : schedule?.status === "ok" ? (
              <div className="flex gap-2 rounded-xl bg-sbkm-mint/15 px-3 py-2.5 text-sm text-sbkm-navy dark:text-sbkm-mint">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>Im Rhythmus — keine Aktion nötig.</p>
              </div>
            ) : schedule?.status === "review_missing" ? (
              <div className="flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Prüfung offen. Das Upload-Datum startet die Fälligkeit nicht. lastReviewed setzen,
                  sobald ein Mensch die Fakten freigegeben hat.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 rounded-xl bg-sbkm-navy/5 px-3 py-2.5 text-sm text-sbkm-ink-600 dark:bg-white/5 dark:text-white/60">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Noch keine Grounding Page erfasst. URL eintragen und „Von Seite lesen“ nutzen —
                  oder den Auftrag „Erstellen“ starten.
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

          {props.canEdit ? (
            <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
              <div>
                <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
                  Grounding Page erstellen
                </h3>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Startet einen SEO-Chat mit den Regeln oben. Wunschkunden-Profile liegen dem
                  Auftrag bei. Unterlagen kannst du an die erste Nachricht hängen. „Erstellen“ ist
                  ein Neubau, auch wenn schon eine URL hinterlegt ist.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <DtPillButton
                  type="button"
                  size="sm"
                  disabled={Boolean(starting) || saving}
                  onClick={() => void startCommand("erstelle")}
                  className="gap-1.5"
                >
                  {starting === "erstelle" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <FilePlus2 className="size-4" aria-hidden />
                  )}
                  Erstellen
                </DtPillButton>
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(starting) || saving}
                  onClick={() => void startCommand("aktualisiere")}
                  className="gap-1.5"
                >
                  {starting === "aktualisiere" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden />
                  )}
                  Aktualisieren
                </DtPillButton>
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(starting) || saving}
                  onClick={() => void startCommand("pruefe")}
                  className="gap-1.5"
                >
                  {starting === "pruefe" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="size-4" aria-hidden />
                  )}
                  Prüfen
                </DtPillButton>
              </div>
            </DtGlassCard>
          ) : null}

          <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">llms.txt</h3>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Wird meist zusammen mit der Grounding Page ausgeliefert — hier separat geprüft.
                </p>
              </div>
              <Badge
                variant={llmsTxt?.found ? "secondary" : "outline"}
                className={cn(
                  llmsTxt?.found &&
                    "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint",
                )}
              >
                {llmsTxt == null ? "…" : llmsTxt.found ? "Gefunden" : "Fehlt"}
              </Badge>
            </div>

            {(data?.url || url) ? (
              <a
                href={data?.url || url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
              >
                Grounding Page öffnen
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                URL der llms.txt
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  value={llmsTxtUrl}
                  disabled={!props.canEdit || saving || detecting}
                  placeholder="https://…/llms.txt"
                  onChange={(e) => setLlmsTxtUrl(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
                {llmsTxtUrl.trim() ? (
                  <a
                    href={llmsTxtUrl.trim()}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex size-10 items-center justify-center rounded-xl border border-sbkm-navy/15 text-sbkm-navy hover:bg-sbkm-mint/15 dark:border-white/15 dark:text-sbkm-mint"
                    title="llms.txt öffnen"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                ) : null}
              </div>
            </label>

            {llmsTxt?.found ? (
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Erreichbar · Last-Modified: {formatDeDate(llmsTxt.lastModified)}
                {llmsTxt.bytes > 0 ? ` · ${Math.round(llmsTxt.bytes / 1024)} KB` : ""}
              </p>
            ) : (
              <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
                {llmsTxt?.message ?? "Noch nicht geprüft."}
              </p>
            )}
          </DtGlassCard>

          <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
            <div>
              <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
                Upload erfassen
              </h3>
              <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                Ideal: URL hinterlegen und Datum automatisch von der Seite lesen (Last-Modified /
                Meta / JSON-LD). Manuell bleibt möglich.
              </p>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                URL der Grounding Page
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  value={url}
                  disabled={!props.canEdit || saving || detecting}
                  placeholder="https://…"
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
                {url.trim() ? (
                  <a
                    href={url.trim()}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex size-10 items-center justify-center rounded-xl border border-sbkm-navy/15 text-sbkm-navy hover:bg-sbkm-mint/15 dark:border-white/15 dark:text-sbkm-mint"
                    title="Grounding Page öffnen"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                ) : null}
              </div>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Kurzname für Dateien
              </span>
              <input
                value={customerSlug}
                disabled={!props.canEdit || saving || detecting}
                placeholder="z. B. existenzstand"
                onChange={(e) => setCustomerSlug(e.target.value.toLowerCase())}
                className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  Zuletzt geprüft
                </span>
                <input
                  type="date"
                  value={lastReviewed}
                  disabled={!props.canEdit || saving || detecting}
                  onChange={(e) => setLastReviewed(e.target.value)}
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm font-semibold text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  dateModified
                </span>
                <input
                  type="date"
                  value={dateModified}
                  disabled={!props.canEdit || saving || detecting}
                  onChange={(e) => setDateModified(e.target.value)}
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm font-semibold text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Prüfer
              </span>
              <input
                value={reviewedBy}
                disabled={!props.canEdit || saving || detecting}
                placeholder="Person oder Organisation"
                onChange={(e) => setReviewedBy(e.target.value)}
                className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  Freigabe
                </span>
                <select
                  value={releaseStatus}
                  disabled={!props.canEdit || saving || detecting}
                  onChange={(e) =>
                    setReleaseStatus(e.target.value as "" | GroundingReleaseStatus)
                  }
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                >
                  <option value="">Nicht gesetzt</option>
                  <option value="draft">Entwurf</option>
                  <option value="released">Freigegeben</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  Standardversion
                </span>
                <input
                  value={standardVersion}
                  disabled={!props.canEdit || saving || detecting}
                  placeholder="z. B. v1.6"
                  onChange={(e) => setStandardVersion(e.target.value)}
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Hochgeladen am
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={uploadedAt}
                  disabled={!props.canEdit || saving || detecting}
                  onChange={(e) => setUploadedAt(e.target.value)}
                  className="h-10 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm font-semibold text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
                />
                {props.canEdit ? (
                  <>
                    <DtPillButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || detecting || !url.trim()}
                      onClick={() => void detectFromPage(true)}
                      className="gap-1.5"
                    >
                      {detecting ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Radar className="size-4" aria-hidden />
                      )}
                      Von Seite lesen
                    </DtPillButton>
                    <DtPillButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving || detecting}
                      onClick={markUploadedToday}
                    >
                      Heute
                    </DtPillButton>
                  </>
                ) : null}
              </div>
              {lastDetection ? (
                <p className="text-xs text-sbkm-mint">Erkannt: {lastDetection}</p>
              ) : null}
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                Notiz (optional)
              </span>
              <textarea
                value={notes}
                disabled={!props.canEdit || saving || detecting}
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
                  disabled={saving || detecting}
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

          <DtSeoGroundingEntities
            canEdit={props.canEdit}
            saving={saving || detecting}
            entities={entities}
            onSave={(next) => void saveEntities(next)}
          />
        </>
      )}
    </div>
  );
}
