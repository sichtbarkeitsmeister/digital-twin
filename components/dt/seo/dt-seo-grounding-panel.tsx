"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  MessagesSquare,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  Square,
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
import type { DtGroundingRunState } from "@/lib/dt/types";
import { DtSeoGroundingRulesCard } from "@/components/dt/seo/dt-seo-grounding-rules-card";

/**
 * Overview of the organisation's Grounding Pages (Hub + Entitätsseiten + llms.txt).
 * Pages are planned, created and updated in the SEO chat with the „Grounding Page“
 * switch on; the agent reports them back here via update_grounding_page. What stays
 * here is what only a person can do: read the live page, document the human fact
 * review (Standard v1.7) and remove a page from the tool.
 */

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
  jobId?: string | null;
};

type RunAction = "start" | "continue" | "answer" | "stop" | "reset" | "restart" | "rebuild";

const POLL_MS = 10_000;
const TEXTAREA_CLASS =
  "min-h-[96px] rounded-xl border border-sbkm-navy/15 bg-white/80 px-3 py-2 text-sm text-sbkm-navy outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white";

/** Default planned URL of the Hub: `<website>/grounding/`. */
function defaultHubUrl(websiteUrl: string | null): string {
  if (!websiteUrl) return "";
  try {
    return `${new URL(websiteUrl).origin}/grounding/`;
  } catch {
    return "";
  }
}

function runBadge(state: DtGroundingRunState): {
  label: string;
  className: string;
} {
  switch (state) {
    case "laeuft":
      return { label: "Entwurf läuft", className: "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-100" };
    case "braucht_sie":
      return { label: "Braucht Sie", className: "border-orange-400/60 bg-orange-500/10 text-orange-900 dark:text-orange-100" };
    case "in_arbeit":
      return { label: "Pausiert", className: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100" };
    case "fertig":
      return { label: "Entwurf fertig", className: "border-sbkm-mint/60 bg-sbkm-mint/20 text-sbkm-navy dark:text-sbkm-mint" };
    default:
      return { label: "Kein Entwurf", className: "border-sbkm-navy/15 bg-white/60 text-sbkm-ink-600 dark:border-white/15 dark:bg-white/5 dark:text-white/60" };
  }
}

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

function OpenChatButton(props: { onClick?: () => void; label: string; size?: "sm" | "md" }) {
  if (!props.onClick) return null;
  return (
    <DtPillButton
      type="button"
      size={props.size ?? "sm"}
      onClick={props.onClick}
      className="gap-1.5"
    >
      <MessagesSquare className="size-4" aria-hidden />
      {props.label}
    </DtPillButton>
  );
}

async function readJson(res: Response): Promise<PagesResponse> {
  return (await res.json().catch(() => ({}))) as PagesResponse;
}

// ---------------------------------------------------------------------------
// Draft (the Grounding agent's four steps)
// ---------------------------------------------------------------------------

function GroundingDraft(props: {
  organisationId: string;
  page: DtGroundingPageView;
  canEdit: boolean;
  onPages: (pages: DtGroundingPageView[], summary: DtGroundingSummary) => void;
  onCreateEntity: (candidate: { name: string; url: string; schemaType: string }) => Promise<boolean>;
}) {
  const { page } = props;
  const run = page.run;
  const [busy, setBusy] = useState<RunAction | null>(null);
  const [answers, setAnswers] = useState("");
  const [rebuildNote, setRebuildNote] = useState("");
  const [showRebuild, setShowRebuild] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  if (!run) return null;
  const badge = runBadge(run.state);
  const exportBase = `/api/dt/seo/grounding/pages/${page.id}/export?org=${encodeURIComponent(props.organisationId)}`;

  async function act(action: RunAction, text?: string, successMessage?: string) {
    setBusy(action);
    try {
      const res = await fetch(`/api/dt/seo/grounding/pages/${page.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, action, text }),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.pages || !json.summary) {
        toast.error(json.message ?? "Aktion fehlgeschlagen.");
        return false;
      }
      props.onPages(json.pages, json.summary);
      if (successMessage) toast.success(successMessage);
      return true;
    } catch {
      toast.error("Aktion fehlgeschlagen.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const disabled = !props.canEdit || busy != null;
  const highIssues = run.findings.filter((f) => f.severity === "high");

  return (
    <div className="grid gap-3 rounded-xl border border-sbkm-navy/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-xs font-bold text-sbkm-navy dark:text-white">
            Entwurf (Grounding-Agent, {run.stepCount} Schritte)
          </p>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">{run.detail ?? run.label}</p>
        </div>
        <Badge variant="outline" className={cn(badge.className)}>
          {badge.label}
        </Badge>
      </div>

      <ol className="flex flex-wrap gap-1.5 text-[11px]">
        {run.steps.map((s) => (
          <li
            key={s.step}
            className={cn(
              "rounded-pill border px-2 py-0.5",
              s.status === "done" || s.status === "waiting"
                ? "border-sbkm-mint/60 bg-sbkm-mint/15 text-sbkm-navy dark:text-sbkm-mint"
                : s.status === "running"
                  ? "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-100"
                  : s.status === "error"
                    ? "border-red-400/50 bg-red-500/10 text-red-800 dark:text-red-200"
                    : "border-sbkm-navy/10 text-sbkm-ink-600 dark:border-white/10 dark:text-white/50",
            )}
          >
            {s.step} {s.name}
          </li>
        ))}
        {run.costEur > 0 ? (
          <li className="rounded-pill border border-sbkm-navy/10 px-2 py-0.5 text-sbkm-ink-600 dark:border-white/10 dark:text-white/50">
            {run.cost}
          </li>
        ) : null}
      </ol>

      {run.state === "in_arbeit" && run.error ? (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">{run.error}</p>
      ) : null}

      {run.state === "braucht_sie" && run.questions.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-xs font-bold text-sbkm-navy dark:text-white">Fragen, die nur Sie beantworten können</p>
          <ol className="grid gap-1.5 text-sm text-sbkm-navy dark:text-white">
            {run.questions.map((q, i) => (
              <li key={`${i}-${q.question}`} className="rounded-xl bg-orange-500/10 px-3 py-2">
                <span className="font-semibold">
                  {i + 1}. {q.question}
                </span>
                {q.why ? <span className="block text-xs text-sbkm-ink-600 dark:text-white/55">{q.why}</span> : null}
                {q.placeholder ? (
                  <span className="block text-xs text-sbkm-ink-600 dark:text-white/55">Beispiel: {q.placeholder}</span>
                ) : null}
              </li>
            ))}
          </ol>
          <textarea
            value={answers}
            disabled={disabled}
            rows={4}
            placeholder="Antworten in der Reihenfolge der Fragen, z. B. „1. GmbH, gegründet 2019. 2. Nur Hamburg und Umland.“"
            onChange={(e) => setAnswers(e.target.value)}
            className={TEXTAREA_CLASS}
          />
          <div className="flex flex-wrap gap-2">
            <DtPillButton
              type="button"
              size="sm"
              disabled={disabled || !answers.trim()}
              onClick={() => void act("answer", answers, "Antworten gespeichert – die Seite wird gebaut.").then((ok) => ok && setAnswers(""))}
              className="gap-1.5"
            >
              {busy === "answer" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Antworten senden und Seite bauen
            </DtPillButton>
            <DtPillButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void act("answer", "", "Ohne Antworten weiter – unbelegte Fakten bleiben weg.")}
            >
              Ohne Antworten weiter
            </DtPillButton>
          </div>
        </div>
      ) : null}

      {run.state === "fertig" ? (
        <div className="grid gap-2">
          {run.summary ? (
            <p className="rounded-xl bg-sbkm-mint/15 px-3 py-2 text-xs text-sbkm-navy dark:text-white">{run.summary}</p>
          ) : null}
          {highIssues.length > 0 ? (
            <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              <p className="font-bold">Vor der Freigabe klären:</p>
              <ul className="mt-1 grid gap-1">
                {highIssues.map((f, i) => (
                  <li key={`${i}-${f.title}`}>
                    <span className="font-semibold">{f.title}:</span> {f.problem} → {f.proposal}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {run.hasHtml ? (
              <a href={`${exportBase}&format=html`} className={LINK_CLASS}>
                <Download className="size-3.5" aria-hidden />
                HTML-Datei herunterladen
              </a>
            ) : null}
            <a href={`${exportBase}&format=llms`} className={LINK_CLASS}>
              <Download className="size-3.5" aria-hidden />
              llms.txt
            </a>
          </div>
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            Datei auf der Website unter {page.url} einfügen, Footer-Link „Fakten“ setzen, die Fakten als Mensch prüfen
            und dann oben „Freigabe dokumentieren“ (Prüfer + Datum). Erst danach Prüfhinweis und reviewedBy/lastReviewed auf
            der Seite ergänzen und die Standard-Zeile auf v1.7 setzen.
          </p>
        </div>
      ) : null}

      {run.facts ? (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setShowFacts((v) => !v)}
            className="w-fit text-xs font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint"
          >
            {showFacts ? "Faktenbasis ausblenden" : `Faktenbasis anzeigen (${run.facts.coreFacts.length} Kerndaten, ${run.facts.sections.length} Abschnitte)`}
          </button>
          {showFacts ? (
            <div className="grid gap-2 rounded-xl bg-white/60 p-3 text-xs text-sbkm-navy dark:bg-white/[0.04] dark:text-white">
              {run.facts.definition ? <p>{run.facts.definition}</p> : null}
              {run.facts.placement ? <p>{run.facts.placement}</p> : null}
              {run.facts.coreFacts.length > 0 ? (
                <dl className="grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr]">
                  {run.facts.coreFacts.map((f, i) => (
                    <div key={`${i}-${f.label}`} className="contents">
                      <dt className="font-semibold">{f.label}</dt>
                      <dd>
                        {f.value}
                        {f.asOf ? ` (Stand ${f.asOf})` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {run.facts.sections.length > 0 ? <p>Abschnitte: {run.facts.sections.join(" · ")}</p> : null}
              {run.facts.openQuestions.length > 0 ? (
                <p className="text-sbkm-ink-600 dark:text-white/55">Offene Fragen: {run.facts.openQuestions.join(" · ")}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {page.kind === "hub" && run.facts && run.facts.candidates.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-xs font-bold text-sbkm-navy dark:text-white">Vorgeschlagene Entitätsseiten</p>
          <ul className="grid gap-1.5">
            {run.facts.candidates.map((c) => (
              <li
                key={c.url || c.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-xs dark:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sbkm-navy dark:text-white">
                    {c.name} <span className="font-normal text-sbkm-ink-600 dark:text-white/55">· {c.schema_type} · Priorität {c.priority}</span>
                  </p>
                  <p className="text-sbkm-ink-600 dark:text-white/55">{c.reason}</p>
                  {c.url ? <p className="truncate text-sbkm-ink-600 dark:text-white/45">{c.url}</p> : null}
                </div>
                {props.canEdit ? (
                  <DtPillButton
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={creating != null || !c.url}
                    onClick={() => {
                      setCreating(c.name);
                      void props
                        .onCreateEntity({ name: c.name, url: c.url, schemaType: c.schema_type })
                        .finally(() => setCreating(null));
                    }}
                    className="gap-1.5"
                  >
                    {creating === c.name ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                    Anlegen
                  </DtPillButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.canEdit ? (
        <div className="flex flex-wrap gap-2">
          {run.state === "nicht_begonnen" ? (
            <DtPillButton type="button" size="sm" disabled={disabled} onClick={() => void act("start", undefined, "Entwurf gestartet.")} className="gap-1.5">
              {busy === "start" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Entwurf erstellen
            </DtPillButton>
          ) : null}
          {run.state === "in_arbeit" ? (
            <DtPillButton type="button" size="sm" disabled={disabled} onClick={() => void act("continue", undefined, "Entwurf läuft weiter.")} className="gap-1.5">
              {busy === "continue" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Weiterlaufen lassen
            </DtPillButton>
          ) : null}
          {run.state === "laeuft" ? (
            <DtPillButton type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void act("stop", undefined, "Entwurf gestoppt.")} className="gap-1.5">
              {busy === "stop" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Square className="size-4" aria-hidden />}
              Stoppen
            </DtPillButton>
          ) : null}
          {run.state === "fertig" || run.state === "in_arbeit" || run.state === "braucht_sie" ? (
            <>
              {run.facts ? (
                <DtPillButton type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setShowRebuild((v) => !v)}>
                  {showRebuild ? "Anmerkung schließen" : "Mit Anmerkung neu bauen"}
                </DtPillButton>
              ) : null}
              <DtPillButton
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm("Entwurf verwerfen und von vorn beginnen? Die Live-Seite und die Prüfdaten bleiben.")) {
                    void act("restart", undefined, "Entwurf neu gestartet.");
                  }
                }}
              >
                Neu erstellen
              </DtPillButton>
            </>
          ) : null}
        </div>
      ) : null}

      {showRebuild && props.canEdit ? (
        <div className="grid gap-2">
          <textarea
            value={rebuildNote}
            disabled={disabled}
            rows={3}
            placeholder="Was soll anders werden? z. B. „Abschnitt Geschichte weglassen, Öffnungszeiten ergänzen: Mo–Fr 8–17 Uhr (Stand 2026-10).“"
            onChange={(e) => setRebuildNote(e.target.value)}
            className={TEXTAREA_CLASS}
          />
          <div>
            <DtPillButton
              type="button"
              size="sm"
              disabled={disabled || !rebuildNote.trim()}
              onClick={() =>
                void act("rebuild", rebuildNote, "Seite wird mit Ihrer Anmerkung neu gebaut.").then((ok) => {
                  if (ok) {
                    setRebuildNote("");
                    setShowRebuild(false);
                  }
                })
              }
              className="gap-1.5"
            >
              {busy === "rebuild" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Neu bauen (ab Schritt 3)
            </DtPillButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page card (overview + the human-only actions)
// ---------------------------------------------------------------------------

function GroundingPageCard(props: {
  organisationId: string;
  page: DtGroundingPageView;
  canEdit: boolean;
  onPages: (pages: DtGroundingPageView[], summary: DtGroundingSummary) => void;
  onCreateEntity: (candidate: { name: string; url: string; schemaType: string }) => Promise<boolean>;
}) {
  const { page } = props;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState<"detect" | "approve" | "reset" | "delete" | null>(null);
  const [lastReviewed, setLastReviewed] = useState(toDateInputValue(page.lastReviewed));
  const [reviewedBy, setReviewedBy] = useState(page.reviewedBy ?? "");
  const [lastDetection, setLastDetection] = useState<string | null>(null);

  useEffect(() => {
    setLastReviewed(toDateInputValue(page.lastReviewed));
    setReviewedBy(page.reviewedBy ?? "");
  }, [page]);

  const badge = statusBadge(page.schedule.status);
  const title =
    page.kind === "hub" ? "Hub · Haupt-Grounding-Page" : page.entityName || page.slug || "Entitätsseite";
  const noteLine = page.notes?.trim().split("\n").filter(Boolean).at(-1) ?? null;

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

  async function approve() {
    const reviewer = reviewedBy.trim();
    if (!reviewer) {
      toast.error("Bitte den Prüfer (Person oder Organisation) eintragen.");
      return;
    }
    const day = lastReviewed || todayInputValue();
    setLastReviewed(day);
    const ok = await patch(
      { reviewedBy: reviewer, lastReviewed: day },
      "approve",
      "Freigabe dokumentiert — Seite gilt als geprüft (v1.7).",
    );
    if (ok) setReviewOpen(false);
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
              ? "Die letzte Prüfung liegt mehr als drei Monate zurück — im SEO-Chat „aktualisiere“ starten, dann die Prüfung hier dokumentieren."
              : "In weniger als zwei Wochen ist die dreimonatige Aktualisierung fällig."}
          </p>
        </div>
      ) : page.schedule.status === "missing" ? (
        <div className="flex gap-2 rounded-xl bg-sbkm-navy/5 px-3 py-2.5 text-sm text-sbkm-ink-600 dark:bg-white/5 dark:text-white/60">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Noch kein Prüf- oder Upload-Datum. „Von Seite lesen“ holt es von der Live-Seite.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <a href={page.url} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          Seite öffnen
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <span className="truncate text-xs text-sbkm-ink-600 dark:text-white/50">{page.url}</span>
      </div>

      {noteLine ? (
        <p className="line-clamp-2 text-xs text-sbkm-ink-600 dark:text-white/50" title={page.notes ?? undefined}>
          {noteLine}
        </p>
      ) : null}

      <GroundingDraft
        organisationId={props.organisationId}
        page={page}
        canEdit={props.canEdit}
        onPages={props.onPages}
        onCreateEntity={props.onCreateEntity}
      />

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
            variant="outline"
            disabled={busy != null}
            onClick={() => setReviewOpen((v) => !v)}
            className="gap-1.5"
          >
            <ShieldCheck className="size-4" aria-hidden />
            {reviewOpen ? "Freigabe schließen" : "Freigabe dokumentieren"}
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
            Entfernen
          </DtPillButton>
        </div>
      ) : null}
      {lastDetection ? <p className="text-xs text-sbkm-mint">Erkannt: {lastDetection}</p> : null}

      {reviewOpen && props.canEdit ? (
        <div className="rounded-xl border border-sbkm-navy/10 bg-white/50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-xs font-bold text-sbkm-navy dark:text-white">
            Menschliche Faktenprüfung (Standard v1.7)
          </p>
          <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">
            Erst nach der Prüfung eintragen. Prüfer und Datum müssen mit dem sichtbaren Prüfhinweis
            und reviewedBy / lastReviewed im JSON-LD der Seite übereinstimmen. Das Prüfdatum ist nie
            in der Zukunft.
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
              disabled={disabled}
              onClick={() => void approve()}
              className="gap-1.5"
            >
              {busy === "approve" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )}
              Freigabe speichern
            </DtPillButton>
            {page.lastReviewed ? (
              <DtPillButton
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setLastReviewed("");
                  void patch(
                    { lastReviewed: null },
                    "reset",
                    "Prüfdatum entfernt — Seite ist wieder Entwurf.",
                  );
                }}
              >
                Prüfung zurücksetzen
              </DtPillButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </DtGlassCard>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function DtSeoGroundingPanel(props: {
  organisationId: string;
  canEdit: boolean;
  /** Opens the SEO chat with the „Grounding Page“ switch on. */
  onOpenChat?: () => void;
}) {
  const [data, setData] = useState<GroundingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmsTxtUrl, setLlmsTxtUrl] = useState("");
  const [savingLlms, setSavingLlms] = useState(false);
  const [hubUrl, setHubUrl] = useState("");
  const [creatingHub, setCreatingHub] = useState(false);
  const [addingEntity, setAddingEntity] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [entityUrl, setEntityUrl] = useState("");
  const [creatingEntity, setCreatingEntity] = useState(false);

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
      setHubUrl((prev) => prev || json.discoveredUrl || defaultHubUrl(json.websiteUrl));
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

  // While a draft runs in the background, re-read the pages (without auto discovery).
  const anyRunning = Boolean(data?.pages.some((p) => p.run?.state === "laeuft"));
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/dt/seo/grounding?org=${encodeURIComponent(props.organisationId)}`);
        const json = (await res.json().catch(() => null)) as (GroundingPayload & { ok?: boolean }) | null;
        if (json?.ok && json.pages && json.summary) onPages(json.pages, json.summary);
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, props.organisationId, onPages]);

  const createPage = useCallback(
    async (input: { kind: "hub" | "entity"; url: string; entityName?: string; slug?: string; schemaType?: string; start: boolean }) => {
      const res = await fetch("/api/dt/seo/grounding/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: props.organisationId,
          kind: input.kind,
          url: input.url,
          entityName: input.kind === "entity" ? input.entityName ?? null : undefined,
          slug: input.kind === "entity" ? input.slug ?? null : undefined,
          standardVersion: null,
          detect: false,
        }),
      });
      const json = await readJson(res);
      if (!res.ok || !json.ok || !json.pages || !json.summary || !json.page) {
        toast.error(json.message ?? "Anlegen fehlgeschlagen.");
        return false;
      }
      onPages(json.pages, json.summary);
      if (!input.start) {
        toast.success(input.kind === "hub" ? "Hub angelegt." : "Entitätsseite angelegt.");
        return true;
      }
      const run = await fetch(`/api/dt/seo/grounding/pages/${json.page.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, action: "start" }),
      });
      const runJson = await readJson(run);
      if (!run.ok || !runJson.ok || !runJson.pages || !runJson.summary) {
        toast.warning(`Seite angelegt. ${runJson.message ?? "Der Entwurf konnte nicht gestartet werden."}`);
        return true;
      }
      onPages(runJson.pages, runJson.summary);
      toast.success(input.kind === "hub" ? "Hub angelegt – der Entwurf läuft." : "Entitätsseite angelegt – der Entwurf läuft.");
      return true;
    },
    [props.organisationId, onPages],
  );

  const onCreateEntity = useCallback(
    async (candidate: { name: string; url: string; schemaType: string }) => {
      const slug = candidate.name
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return createPage({ kind: "entity", url: candidate.url, entityName: candidate.name, slug, schemaType: candidate.schemaType, start: false });
    },
    [createPage],
  );

  const summary = data?.summary;
  const badge = useMemo(() => statusBadge(summary?.status ?? "missing"), [summary?.status]);
  const hub = data?.pages.find((p) => p.kind === "hub") ?? null;
  const entities = data?.pages.filter((p) => p.kind !== "hub") ?? [];
  const chatAvailable = props.canEdit && Boolean(props.onOpenChat);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-sbkm-navy dark:text-white">
            Grounding Pages
          </h2>
          <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
            Hub, Entitätsseiten und <code className="text-[0.85em]">llms.txt</code> nach Grounding Page
            Standard v1.7. Der Grounding-Agent erstellt jede Seite in vier Schritten im Hintergrund
            (Fakten sammeln, Faktencheck, Seite bauen, Endprüfung) und liefert die HTML-Datei zum
            Einfügen. Fällig ist jede Seite {GROUNDING_PAGE_INTERVAL_MONTHS} Monate nach der letzten
            menschlichen Faktenprüfung (lastReviewed), Frühwarnung {GROUNDING_PAGE_WARN_DAYS} Tage
            vorher.
          </p>
        </div>
        {chatAvailable ? (
          <OpenChatButton onClick={props.onOpenChat} label="Im SEO-Chat besprechen" size="md" />
        ) : null}
      </div>

      <DtSeoGroundingRulesCard canEdit={props.canEdit} />

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
              onCreateEntity={onCreateEntity}
            />
          ) : (
            <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
              <div>
                <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
                  Noch kein Hub erfasst
                </h3>
                <p className="mt-0.5 text-sm text-sbkm-ink-600 dark:text-white/60">
                  {data.discoveredUrl
                    ? `Im ${data.discoverySource === "footer" ? "Footer" : "Standardpfad"} gefunden: ${data.discoveredUrl}.`
                    : (data.discoveryMessage ??
                      "Auf der Website wurde keine Grounding Page gefunden.")}{" "}
                  Der Grounding-Agent sammelt die Fakten in vier Schritten (Fakten sammeln, Faktencheck,
                  Seite bauen, Endprüfung) und liefert die Haupt-Grounding-Page als HTML-Datei zum Einfügen
                  auf der Website.
                </p>
              </div>
              {props.canEdit ? (
                <div className="grid gap-2">
                  <label className="grid gap-1.5">
                    <span className={LABEL_CLASS}>Geplante URL des Hubs</span>
                    <input
                      type="url"
                      value={hubUrl}
                      disabled={creatingHub}
                      placeholder="https://…/grounding/"
                      onChange={(e) => setHubUrl(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <DtPillButton
                      type="button"
                      size="sm"
                      disabled={creatingHub || !hubUrl.trim()}
                      onClick={() => {
                        setCreatingHub(true);
                        void createPage({ kind: "hub", url: hubUrl.trim(), start: true }).finally(() => setCreatingHub(false));
                      }}
                      className="gap-1.5"
                    >
                      {creatingHub ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                      Hub anlegen und Entwurf erstellen
                    </DtPillButton>
                    {chatAvailable ? <OpenChatButton onClick={props.onOpenChat} label="Erst im Chat besprechen" /> : null}
                  </div>
                </div>
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
              <DtPillButton type="button" size="sm" variant="outline" onClick={() => setAddingEntity(true)} className="gap-1.5">
                <Plus className="size-4" aria-hidden />
                Entitätsseite hinzufügen
              </DtPillButton>
            ) : null}
          </div>

          {addingEntity && props.canEdit ? (
            <DtGlassCard variant="subtle" className="grid gap-3 p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={LABEL_CLASS}>Entitätsname</span>
                  <input
                    type="text"
                    value={entityName}
                    disabled={creatingEntity}
                    placeholder="z. B. AVGS-Beratung"
                    onChange={(e) => setEntityName(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={LABEL_CLASS}>Geplante URL</span>
                  <input
                    type="url"
                    value={entityUrl}
                    disabled={creatingEntity}
                    placeholder={hub ? `${hub.url.replace(/\/+$/, "")}/avgs-beratung/` : "https://…/grounding/leistung/"}
                    onChange={(e) => setEntityUrl(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <DtPillButton
                  type="button"
                  size="sm"
                  disabled={creatingEntity || !entityName.trim() || !entityUrl.trim()}
                  onClick={() => {
                    setCreatingEntity(true);
                    void onCreateEntity({ name: entityName.trim(), url: entityUrl.trim(), schemaType: "" })
                      .then((ok) => {
                        if (ok) {
                          setEntityName("");
                          setEntityUrl("");
                          setAddingEntity(false);
                        }
                      })
                      .finally(() => setCreatingEntity(false));
                  }}
                  className="gap-1.5"
                >
                  {creatingEntity ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                  Anlegen
                </DtPillButton>
                <DtPillButton type="button" size="sm" variant="ghost" disabled={creatingEntity} onClick={() => setAddingEntity(false)}>
                  Abbrechen
                </DtPillButton>
              </div>
            </DtGlassCard>
          ) : null}

          {entities.length === 0 && !addingEntity ? (
            <DtGlassCard variant="subtle" className="p-4 text-sm text-sbkm-ink-600 dark:text-white/55">
              Keine Entitätsseiten erfasst. Eine eigene Seite entsteht nur, wenn Zielkunden gezielt
              nach der Entität fragen und genug belegbare Fakten vorliegen — sonst bleibt sie eine
              entity-card im Hub. Der Hub-Entwurf schlägt passende Entitätsseiten vor; sie lassen sich
              dort mit einem Klick anlegen.
            </DtGlassCard>
          ) : null}

          {entities.map((page) => (
            <GroundingPageCard
              key={page.id}
              organisationId={props.organisationId}
              page={page}
              canEdit={props.canEdit}
              onPages={onPages}
              onCreateEntity={onCreateEntity}
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
