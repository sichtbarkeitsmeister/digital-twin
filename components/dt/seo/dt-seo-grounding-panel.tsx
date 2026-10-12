"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Radar,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import type { GroundingPageStatus } from "@/lib/dt/seo/grounding-page-schedule";
import {
  GROUNDING_PAGE_INTERVAL_MONTHS,
  GROUNDING_PAGE_WARN_DAYS,
} from "@/lib/dt/seo/grounding-page-schedule";
import type {
  DtGroundingPageView,
  DtGroundingSummary,
} from "@/lib/dt/seo/grounding-pages";

type LlmsTxtStatus =
  | { found: true; url: string; lastModified: string | null; bytes: number }
  | { found: false; message: string; tried?: string[] };

type GroundingPayload = {
  websiteUrl: string | null;
  llmsTxtUrl: string | null;
  llmsTxt: LlmsTxtStatus;
  pages: DtGroundingPageView[];
  summary: DtGroundingSummary;
  discoveredUrl: string | null;
  discoveryMessage: string | null;
  discoverySource: "footer" | "path_probe" | null;
  autoApplied: boolean;
};

type PagesResponse = {
  ok?: boolean;
  message?: string;
  page?: DtGroundingPageView;
  pages?: DtGroundingPageView[];
  summary?: DtGroundingSummary;
  detectionMessage?: string | null;
  detection?: { detectedAt: string; sourceLabel: string; finalUrl?: string };
};

const INPUT_CLASS =
  "h-10 min-w-0 rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white";
const LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50";
const LINK_CLASS =
  "inline-flex items-center gap-1.5 text-sm font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint";

function formatDeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusBadge(status: GroundingPageStatus): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
  className?: string;
} {
  if (status === "missing") return { label: "Nicht erfasst", variant: "outline" };
  if (status === "overdue") return { label: "Überfällig", variant: "destructive" };
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

function ExternalIconLink(props: { href: string; title: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-sbkm-navy/15 text-sbkm-navy hover:bg-sbkm-mint/15 dark:border-white/15 dark:text-sbkm-mint"
      title={props.title}
    >
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}

function FactTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-sbkm-navy/10 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/45">
        {props.label}
      </p>
      <p className="mt-1 text-sm font-semibold text-sbkm-navy dark:text-white">{props.value}</p>
      {props.hint ? (
        <p className="mt-0.5 text-[11px] text-sbkm-ink-600 dark:text-white/50">{props.hint}</p>
      ) : null}
    </div>
  );
}

async function readJson(res: Response): Promise<PagesResponse> {
  return (await res.json().catch(() => ({}))) as PagesResponse;
}

// ---------------------------------------------------------------------------
// Page card
// ---------------------------------------------------------------------------

function GroundingPageCard(props: {
  organisationId: string;
  page: DtGroundingPageView;
  canEdit: boolean;
  onPages: (pages: DtGroundingPageView[], summary: DtGroundingSummary) => void;
}) {
  const { page } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "detect" | "approve" | "delete" | null>(null);
  const [url, setUrl] = useState(page.url);
  const [entityName, setEntityName] = useState(page.entityName ?? "");
  const [slug, setSlug] = useState(page.slug ?? "");
  const [uploadedAt, setUploadedAt] = useState(toDateInputValue(page.uploadedAt));
  const [dateModified, setDateModified] = useState(toDateInputValue(page.dateModified));
  const [lastReviewed, setLastReviewed] = useState(toDateInputValue(page.lastReviewed));
  const [reviewedBy, setReviewedBy] = useState(page.reviewedBy ?? "");
  const [standardVersion, setStandardVersion] = useState(page.standardVersion ?? "");
  const [notes, setNotes] = useState(page.notes ?? "");
  const [lastDetection, setLastDetection] = useState<string | null>(null);

  useEffect(() => {
    setUrl(page.url);
    setEntityName(page.entityName ?? "");
    setSlug(page.slug ?? "");
    setUploadedAt(toDateInputValue(page.uploadedAt));
    setDateModified(toDateInputValue(page.dateModified));
    setLastReviewed(toDateInputValue(page.lastReviewed));
    setReviewedBy(page.reviewedBy ?? "");
    setStandardVersion(page.standardVersion ?? "");
    setNotes(page.notes ?? "");
  }, [page]);

  const badge = statusBadge(page.schedule.status);
  const title =
    page.kind === "hub" ? "Hub · Haupt-Grounding-Page" : page.entityName || page.slug || "Entitätsseite";

  async function patch(body: Record<string, unknown>, kind: typeof busy, successMessage: string) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/dt/seo/grounding/pages/${page.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.pages || !json.summary) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return false;
      }
      props.onPages(json.pages, json.summary);
      toast.success(successMessage);
      return true;
    } catch {
      toast.error("Speichern fehlgeschlagen.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function save() {
    void patch(
      {
        url: url.trim(),
        entityName: page.kind === "hub" ? undefined : entityName.trim() || null,
        slug: page.kind === "hub" ? undefined : slug.trim() || null,
        uploadedAt: uploadedAt || null,
        dateModified: dateModified || null,
        lastReviewed: lastReviewed || null,
        reviewedBy: reviewedBy.trim() || null,
        standardVersion: standardVersion.trim() || null,
        notes: notes.trim() || null,
      },
      "save",
      "Grounding Page gespeichert.",
    );
  }

  function approve() {
    const reviewer = reviewedBy.trim();
    if (!reviewer) {
      toast.error("Bitte zuerst den Prüfer (Person oder Organisation) eintragen.");
      return;
    }
    const day = lastReviewed || todayInputValue();
    setLastReviewed(day);
    void patch(
      { reviewedBy: reviewer, lastReviewed: day },
      "approve",
      "Freigabe dokumentiert — Seite gilt als geprüft (v1.7).",
    );
  }

  async function detect() {
    setBusy("detect");
    setLastDetection(null);
    try {
      const res = await fetch("/api/dt/seo/grounding/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          pageId: page.id,
          url: url.trim() || undefined,
          apply: true,
        }),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.detection) {
        toast.error(json.message ?? "Datum konnte nicht gelesen werden.");
        return;
      }
      setLastDetection(
        `${formatDeDate(json.detection.detectedAt)} · ${json.detection.sourceLabel}`,
      );
      if (json.pages && json.summary) props.onPages(json.pages, json.summary);
      toast.success("Live-Daten von der Seite gelesen und gespeichert.");
    } catch {
      toast.error("Datum konnte nicht gelesen werden.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Diese Grounding Page wirklich aus dem Tool entfernen? Die Live-Seite bleibt unberührt.")) {
      return;
    }
    setBusy("delete");
    try {
      const res = await fetch(`/api/dt/seo/grounding/pages/${page.id}`, { method: "DELETE" });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.pages || !json.summary) {
        toast.error(json.message ?? "Entfernen fehlgeschlagen.");
        return;
      }
      props.onPages(json.pages, json.summary);
      toast.success("Grounding Page entfernt.");
    } catch {
      toast.error("Entfernen fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = !props.canEdit || busy != null;

  return (
    <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{page.kind === "hub" ? "Hub" : "Entitätsseite"}</Badge>
            <Badge
              variant={page.reviewStatus === "approved" ? "secondary" : "outline"}
              className={cn(
                page.reviewStatus === "approved" &&
                  "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint",
              )}
            >
              {page.reviewStatus === "approved" ? "Freigegeben" : "Entwurf"}
            </Badge>
            {page.standardVersion ? (
              <Badge variant="outline">Standard v{page.standardVersion}</Badge>
            ) : null}
          </div>
          <h3 className="truncate text-sm font-bold text-sbkm-navy dark:text-white">{title}</h3>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{page.schedule.statusLabel}</p>
        </div>
        <Badge variant={badge.variant} className={cn(badge.className)}>
          {badge.label}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FactTile
          label="Zuletzt geprüft (lastReviewed)"
          value={formatDeDate(page.lastReviewed)}
          hint={page.reviewedBy ? `Prüfer: ${page.reviewedBy}` : "Keine Prüfung dokumentiert"}
        />
        <FactTile
          label="Nächste Aktualisierung"
          value={formatDeDate(page.schedule.nextDueAt)}
          hint={page.schedule.basis === "uploaded_at" ? "Vorläufig nach Upload-Datum" : undefined}
        />
        <FactTile
          label="Geändert (dateModified)"
          value={formatDeDate(page.dateModified)}
          hint={`Hochgeladen: ${formatDeDate(page.uploadedAt)}`}
        />
      </div>

      {page.modifiedAfterReview ? (
        <div className="flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Die Seite wurde nach der letzten Prüfung geändert. Bei substanziellen Änderungen ist eine
            neue menschliche Faktenprüfung nötig.
          </p>
        </div>
      ) : page.schedule.status === "overdue" || page.schedule.status === "due_soon" ? (
        <div
          className={cn(
            "flex gap-2 rounded-xl px-3 py-2.5 text-sm",
            page.schedule.status === "overdue"
              ? "bg-red-500/10 text-red-800 dark:text-red-200"
              : "bg-amber-500/10 text-amber-900 dark:text-amber-100",
          )}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {page.schedule.status === "overdue"
              ? "Die letzte Prüfung liegt mehr als drei Monate zurück — „aktualisiere“ im Chat starten, dann Prüfung dokumentieren."
              : "In weniger als zwei Wochen ist die dreimonatige Aktualisierung fällig."}
          </p>
        </div>
      ) : page.schedule.status === "missing" ? (
        <div className="flex gap-2 rounded-xl bg-sbkm-navy/5 px-3 py-2.5 text-sm text-sbkm-ink-600 dark:bg-white/5 dark:text-white/60">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Noch kein Prüf- oder Upload-Datum. „Von Seite lesen“ nutzen oder manuell setzen.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <a href={page.url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Seite öffnen
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <span className="truncate text-xs text-sbkm-ink-600 dark:text-white/50">{page.url}</span>
      </div>

      {props.canEdit ? (
        <div className="flex flex-wrap gap-2">
          <DtPillButton
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void detect()}
            className="gap-1.5"
          >
            {busy === "detect" ? (
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
            disabled={busy != null}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Bearbeiten schließen" : "Bearbeiten"}
          </DtPillButton>
        </div>
      ) : null}
      {lastDetection ? <p className="text-xs text-sbkm-mint">Erkannt: {lastDetection}</p> : null}

      {open && props.canEdit ? (
        <div className="grid gap-3 border-t border-sbkm-navy/10 pt-4 dark:border-white/10">
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>URL</span>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                disabled={disabled}
                onChange={(e) => setUrl(e.target.value)}
                className={cn(INPUT_CLASS, "flex-1")}
              />
              {url.trim() ? <ExternalIconLink href={url.trim()} title="Seite öffnen" /> : null}
            </div>
          </label>

          {page.kind !== "hub" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Entitätsname</span>
                <input
                  type="text"
                  value={entityName}
                  disabled={disabled}
                  placeholder="z. B. Veneers"
                  onChange={(e) => setEntityName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Slug</span>
                <input
                  type="text"
                  value={slug}
                  disabled={disabled}
                  placeholder="z. B. veneers"
                  onChange={(e) => setSlug(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>Hochgeladen am</span>
              <input
                type="date"
                value={uploadedAt}
                disabled={disabled}
                onChange={(e) => setUploadedAt(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>dateModified</span>
              <input
                type="date"
                value={dateModified}
                disabled={disabled}
                onChange={(e) => setDateModified(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>Standardversion</span>
              <input
                type="text"
                value={standardVersion}
                disabled={disabled}
                placeholder="1.7"
                onChange={(e) => setStandardVersion(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="rounded-xl border border-sbkm-navy/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs font-bold text-sbkm-navy dark:text-white">
              Menschliche Faktenprüfung (Standard v1.7)
            </p>
            <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
              Prüfer und Datum müssen mit dem sichtbaren Prüfhinweis und reviewedBy / lastReviewed
              im JSON-LD der Seite übereinstimmen. Das Prüfdatum ist nie in der Zukunft.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Prüfer (reviewedBy)</span>
                <input
                  type="text"
                  value={reviewedBy}
                  disabled={disabled}
                  placeholder="Person oder Organisation"
                  onChange={(e) => setReviewedBy(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className={LABEL_CLASS}>Geprüft am (lastReviewed)</span>
                <input
                  type="date"
                  value={lastReviewed}
                  max={todayInputValue()}
                  disabled={disabled}
                  onChange={(e) => setLastReviewed(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={approve}
                className="gap-1.5"
              >
                {busy === "approve" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden />
                )}
                Freigabe dokumentieren
              </DtPillButton>
              {lastReviewed ? (
                <DtPillButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setLastReviewed("");
                    void patch(
                      { lastReviewed: null },
                      "save",
                      "Prüfdatum entfernt — Seite ist wieder Entwurf.",
                    );
                  }}
                >
                  Prüfung zurücksetzen
                </DtPillButton>
              ) : null}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>Notiz (optional)</span>
            <textarea
              value={notes}
              disabled={disabled}
              rows={3}
              placeholder="z. B. was geändert wurde, Befunde…"
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <DtPillButton type="button" size="sm" disabled={disabled} onClick={save}>
              {busy === "save" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Speichern…
                </>
              ) : (
                "Speichern"
              )}
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void remove()}
              className="gap-1.5 text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              Aus dem Tool entfernen
            </DtPillButton>
          </div>
        </div>
      ) : null}
    </DtGlassCard>
  );
}

// ---------------------------------------------------------------------------
// Add page form
// ---------------------------------------------------------------------------

function AddGroundingPageForm(props: {
  organisationId: string;
  kind: "hub" | "entity";
  initialUrl?: string;
  onPages: (pages: DtGroundingPageView[], summary: DtGroundingSummary) => void;
  onDone?: () => void;
}) {
  const [url, setUrl] = useState(props.initialUrl ?? "");
  const [entityName, setEntityName] = useState("");
  const [detect, setDetect] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.initialUrl) setUrl(props.initialUrl);
  }, [props.initialUrl]);

  async function submit() {
    const target = url.trim();
    if (!target) {
      toast.error("Bitte die URL der Seite eintragen.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/dt/seo/grounding/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          kind: props.kind,
          url: target,
          entityName: props.kind === "entity" ? entityName.trim() || null : undefined,
          detect,
        }),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.pages || !json.summary) {
        toast.error(json.message ?? "Anlegen fehlgeschlagen.");
        return;
      }
      props.onPages(json.pages, json.summary);
      if (json.detectionMessage) {
        toast.warning(`Seite angelegt. ${json.detectionMessage}`);
      } else {
        toast.success(props.kind === "hub" ? "Hub angelegt." : "Entitätsseite angelegt.");
      }
      setUrl("");
      setEntityName("");
      props.onDone?.();
    } catch {
      toast.error("Anlegen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-3", props.kind === "entity" && "sm:grid-cols-[1fr_minmax(0,220px)]")}>
        <label className="grid gap-1.5">
          <span className={LABEL_CLASS}>
            {props.kind === "hub" ? "URL des Hubs" : "URL der Entitätsseite"}
          </span>
          <input
            type="url"
            value={url}
            disabled={busy}
            placeholder={props.kind === "hub" ? "https://…/grounding/" : "https://…/grounding/leistung/"}
            onChange={(e) => setUrl(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {props.kind === "entity" ? (
          <label className="grid gap-1.5">
            <span className={LABEL_CLASS}>Entitätsname</span>
            <input
              type="text"
              value={entityName}
              disabled={busy}
              placeholder="z. B. Veneers"
              onChange={(e) => setEntityName(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-sbkm-navy dark:text-white">
        <input
          type="checkbox"
          checked={detect}
          disabled={busy}
          onChange={(e) => setDetect(e.target.checked)}
          className="size-4 accent-sbkm-mint"
        />
        Daten direkt von der Live-Seite lesen (lastReviewed, Prüfer, dateModified, Version)
      </label>
      <div className="flex flex-wrap gap-2">
        <DtPillButton type="button" size="sm" disabled={busy} onClick={() => void submit()} className="gap-1.5">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {props.kind === "hub" ? "Hub anlegen" : "Entitätsseite anlegen"}
        </DtPillButton>
        {props.onDone ? (
          <DtPillButton type="button" size="sm" variant="ghost" disabled={busy} onClick={props.onDone}>
            Abbrechen
          </DtPillButton>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function DtSeoGroundingPanel(props: { organisationId: string; canEdit: boolean }) {
  const [data, setData] = useState<GroundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmsTxtUrl, setLlmsTxtUrl] = useState("");
  const [savingLlms, setSavingLlms] = useState(false);
  const [addingEntity, setAddingEntity] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const autoParam = props.canEdit ? "&auto=1" : "";
      const res = await fetch(
        `/api/dt/seo/grounding?org=${encodeURIComponent(props.organisationId)}${autoParam}`,
      );
      const json = (await res.json()) as GroundingPayload & { ok?: boolean; message?: string };
      if (!res.ok || !json.ok || !json.pages) {
        setError(json.message ?? "Grounding-Page konnte nicht geladen werden.");
        setData(null);
        return;
      }
      setData(json);
      setLlmsTxtUrl(json.llmsTxtUrl ?? (json.llmsTxt.found ? json.llmsTxt.url : ""));
      if (json.autoApplied) {
        toast.success("Grounding Page gefunden und Live-Daten übernommen.");
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

  const onPages = useCallback((pages: DtGroundingPageView[], summary: DtGroundingSummary) => {
    setData((prev) => (prev ? { ...prev, pages, summary } : prev));
  }, []);

  const summary = data?.summary;
  const badge = useMemo(() => statusBadge(summary?.status ?? "missing"), [summary?.status]);
  const hub = data?.pages.find((p) => p.kind === "hub") ?? null;
  const entities = data?.pages.filter((p) => p.kind !== "hub") ?? [];

  async function saveLlmsTxtUrl() {
    if (!props.canEdit) return;
    setSavingLlms(true);
    try {
      const res = await fetch("/api/dt/seo/grounding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          llmsTxtUrl: llmsTxtUrl.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        llmsTxtUrl?: string | null;
        llmsTxt?: LlmsTxtStatus;
      };
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      setData((prev) =>
        prev
          ? { ...prev, llmsTxtUrl: json.llmsTxtUrl ?? null, llmsTxt: json.llmsTxt ?? prev.llmsTxt }
          : prev,
      );
      toast.success("llms.txt-URL gespeichert.");
    } catch {
      toast.error("Speichern fehlgeschlagen.");
    } finally {
      setSavingLlms(false);
    }
  }

  const llmsTxt = data?.llmsTxt ?? null;
  const llmsNewerThanHub =
    Boolean(llmsTxt?.found && llmsTxt.lastModified && hub?.dateModified) &&
    (llmsTxt as { lastModified: string }).lastModified.slice(0, 10) >
      (hub?.dateModified ?? "").slice(0, 10);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 pb-8">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-sbkm-navy dark:text-white">
          Grounding Pages
        </h2>
        <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
          Hub und Entitätsseiten nach Grounding Page Standard v1.7. Fällig ist jede Seite{" "}
          {GROUNDING_PAGE_INTERVAL_MONTHS} Monate nach der letzten menschlichen Faktenprüfung
          (lastReviewed), Frühwarnung {GROUNDING_PAGE_WARN_DAYS} Tage vorher. Der Twin sucht den
          Grounding-Link im Footer, prüft <code className="text-[0.85em]">llms.txt</code> und liest
          Prüfer, Prüfdatum und dateModified von der Live-Seite.
        </p>
      </div>

      {loading ? (
        <DtGlassCard variant="subtle" className="flex items-center gap-2 p-4 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Lade Grounding Pages …
        </DtGlassCard>
      ) : error || !data ? (
        <DtGlassCard variant="subtle" className="p-4 text-sm text-destructive">
          {error ?? "Grounding-Page konnte nicht geladen werden."}
        </DtGlassCard>
      ) : (
        <>
          <DtGlassCard variant="subtle" className="grid gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className={LABEL_CLASS}>Gesamtstatus</p>
                <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                  {summary?.statusLabel ?? "—"}
                </p>
              </div>
              <Badge variant={badge.variant} className={cn(badge.className)}>
                {badge.label}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <FactTile label="Seiten" value={String(summary?.total ?? 0)} hint={`${summary?.hubs ?? 0} Hub · ${summary?.entities ?? 0} Entitäten`} />
              <FactTile label="Freigegeben" value={String((summary?.total ?? 0) - (summary?.drafts ?? 0))} hint={`${summary?.drafts ?? 0} Entwurf`} />
              <FactTile label="Überfällig" value={String(summary?.overdue ?? 0)} hint={`${summary?.dueSoon ?? 0} bald fällig`} />
              <FactTile label="Nach Prüfung geändert" value={String(summary?.modifiedAfterReview ?? 0)} />
            </div>
            {summary?.status === "ok" ? (
              <div className="flex gap-2 rounded-xl bg-sbkm-mint/15 px-3 py-2.5 text-sm text-sbkm-navy dark:text-sbkm-mint">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>Im Rhythmus — keine Aktion nötig.</p>
              </div>
            ) : null}
            {llmsNewerThanHub ? (
              <div className="flex gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Befund: Die llms.txt ist neuer als die Grounding Page (dateModified). Beide sollten
                  synchron sein.
                </p>
              </div>
            ) : null}
          </DtGlassCard>

          {hub ? (
            <GroundingPageCard
              organisationId={props.organisationId}
              page={hub}
              canEdit={props.canEdit}
              onPages={onPages}
            />
          ) : (
            <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
              <div>
                <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">Hub anlegen</h3>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  {data.discoveredUrl
                    ? `Im ${data.discoverySource === "footer" ? "Footer" : "Standardpfad"} gefunden: ${data.discoveredUrl}`
                    : (data.discoveryMessage ?? "Noch keine Haupt-Grounding-Page erfasst.")}
                </p>
              </div>
              {props.canEdit ? (
                <AddGroundingPageForm
                  organisationId={props.organisationId}
                  kind="hub"
                  initialUrl={data.discoveredUrl ?? ""}
                  onPages={onPages}
                />
              ) : (
                <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                  Nur Plattform-Admins können Grounding Pages erfassen.
                </p>
              )}
            </DtGlassCard>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
              Entitätsseiten ({entities.length})
            </h3>
            {props.canEdit && !addingEntity ? (
              <DtPillButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAddingEntity(true)}
                className="gap-1.5"
              >
                <Plus className="size-4" aria-hidden />
                Entitätsseite hinzufügen
              </DtPillButton>
            ) : null}
          </div>

          {addingEntity && props.canEdit ? (
            <DtGlassCard variant="subtle" className="p-4 sm:p-5">
              <AddGroundingPageForm
                organisationId={props.organisationId}
                kind="entity"
                onPages={onPages}
                onDone={() => setAddingEntity(false)}
              />
            </DtGlassCard>
          ) : null}

          {entities.length === 0 && !addingEntity ? (
            <DtGlassCard variant="subtle" className="p-4 text-sm text-sbkm-ink-600 dark:text-white/55">
              Keine Entitätsseiten erfasst. Eine eigene Seite entsteht nur, wenn Zielkunden gezielt
              nach der Entität fragen und genug belegbare Fakten vorliegen — sonst bleibt sie eine
              entity-card im Hub.
            </DtGlassCard>
          ) : null}

          {entities.map((page) => (
            <GroundingPageCard
              key={page.id}
              organisationId={props.organisationId}
              page={page}
              canEdit={props.canEdit}
              onPages={onPages}
            />
          ))}

          <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">llms.txt</h3>
                <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
                  Eine Datei je Domain — listet Hub und alle Entitätsseiten. Hier separat geprüft.
                </p>
              </div>
              <Badge
                variant={llmsTxt?.found ? "secondary" : "outline"}
                className={cn(llmsTxt?.found && "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint")}
              >
                {llmsTxt == null ? "…" : llmsTxt.found ? "Gefunden" : "Fehlt"}
              </Badge>
            </div>

            <label className="grid gap-1.5">
              <span className={LABEL_CLASS}>URL der llms.txt</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  value={llmsTxtUrl}
                  disabled={!props.canEdit || savingLlms}
                  placeholder="https://…/llms.txt"
                  onChange={(e) => setLlmsTxtUrl(e.target.value)}
                  className={cn(INPUT_CLASS, "flex-1")}
                />
                {llmsTxtUrl.trim() ? (
                  <ExternalIconLink href={llmsTxtUrl.trim()} title="llms.txt öffnen" />
                ) : null}
                {props.canEdit ? (
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingLlms}
                    onClick={() => void saveLlmsTxtUrl()}
                  >
                    {savingLlms ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Speichern"}
                  </DtPillButton>
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
        </>
      )}
    </div>
  );
}
