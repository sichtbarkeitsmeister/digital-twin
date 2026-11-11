"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtAgentStatusToggle } from "@/components/dt/agents/dt-agent-status-toggle";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { downloadContentExport } from "@/components/dt/content/download";
import { DtContentQuestionsPanel } from "@/components/dt/content/dt-content-questions-panel";
import { DtContentStatusBadge } from "@/components/dt/content/dt-content-status-badge";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import { CLIENT_WISHES_TEXT_MAX } from "@/lib/dt/content/client-wishes";
import { findingKey, findingTargetBlock, findingTargetBlocks, markNewSentences } from "@/lib/dt/content/finding-target";
import { freshnessSendBackLine, freshnessSourceLabel, isWebUrl } from "@/lib/dt/content/freshness";
import { htmlToPlainText, parseBlocksFromHtml } from "@/lib/dt/content/render";
import {
  CONTENT_PAGE_TYPE_LABELS,
  CONTENT_PAGE_TYPE_OPTIONS,
  type ContentPageType,
} from "@/lib/dt/content/page-types";
import { CONTENT_STEP_AKTUALITAET, CONTENT_STEP_COUNT } from "@/lib/dt/content/pipeline/steps";
import {
  CONTENT_APPROVE_OPEN_ITEMS_CONFIRM,
  CONTENT_SKIP_NOTE,
  approveNeedsConfirm,
  contentActionLabel,
  contentSkipWarnings,
  contentStepLogLine,
  contentStepStatusLabel,
  extractContentBlocks,
  formatEur,
} from "@/lib/dt/content/presentation";
import type {
  ContentAction,
  ContentFinding,
  ContentJob,
  ContentPagePatchResult,
  ContentPageRunThroughResult,
  ContentReview,
  ContentStep,
} from "@/lib/dt/content/types";

const textareaClass =
  "min-h-[120px] w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-3 py-2.5 text-sm leading-relaxed text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 placeholder:text-sbkm-ink-500 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40";

const sectionTitleClass =
  "flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55";

const JOB_POLL_MS = 4_000;

const FULLSCREEN_KEY = "dt-content-drawer-fullscreen";

const findingButtonClass =
  "rounded-pill border border-sbkm-navy/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-sbkm-navy transition-colors hover:border-sbkm-navy/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/[0.06] dark:text-white";

function severityClass(severity: string): string {
  switch (severity) {
    case "high":
    case "critical":
      return "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200";
    case "medium":
      return "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-100";
    default:
      return "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70";
  }
}

function openFindings(review: ContentReview): ContentFinding[] {
  const seen = new Set<string>();
  const out: ContentFinding[] = [];
  for (const f of [...review.findings, ...review.final_findings, ...review.unresolved]) {
    const key = `${f.title}|${f.block_id ?? ""}|${f.problem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** The Aktualitätsprüfung ran on this page (or left something behind): the drawer shows its section. */
function showFreshness(review: ContentReview): boolean {
  const step = review.steps.find((s) => s.step === CONTENT_STEP_AKTUALITAET);
  const { freshness } = review;
  return (
    step?.status === "done" ||
    step?.status === "waiting" ||
    freshness.updates.length > 0 ||
    freshness.sendbacks > 0 ||
    freshness.pending_sections.length > 0
  );
}

type Mode =
  | { kind: "edit"; action: ContentAction }
  | { kind: "rerun"; action: ContentAction }
  /** „Abschnitt überarbeiten lassen“, or an open point's „Vorschlag umsetzen“ / „Eigene Angabe“. */
  | { kind: "revise"; finding: ContentFinding | null; ask: "instruction" | "proposal" | "info" }
  | null;

/** A revised Abschnitt waiting for „Übernehmen“. */
type RevisionPreviewData = {
  before: { id: string; heading: string | null; level: number; html: string };
  after: { id: string; heading: string | null; level: number; html: string };
  watermark: boolean;
  cost_eur: number;
};

/** Actions that sit on the right of the footer: the two exports and the two destructive ones. */
const RIGHT_ACTIONS = new Set<string>(["export", "export_txt", "reset", "delete"]);

export function DtContentPageDrawer(props: {
  organisationId: string;
  page: { slug: string; name: string } | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { organisationId, page, open, onClose } = props;
  const onChangedRef = useRef(props.onChanged);
  useEffect(() => {
    onChangedRef.current = props.onChanged;
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const [review, setReview] = useState<ContentReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [blockId, setBlockId] = useState("");
  const [blockText, setBlockText] = useState("");
  const [note, setNote] = useState("");
  const [reviseText, setReviseText] = useState("");
  const [revisePreview, setRevisePreview] = useState<RevisionPreviewData | null>(null);
  /** „Vorschlag übernehmen“: the open points (by key) whose proposals „Jetzt umsetzen“ works in together. */
  const [chosen, setChosen] = useState<string[]>([]);
  /** While „Jetzt umsetzen“ runs: Abschnitt n of total. */
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  /** „Zusätzliche Wünsche für diese Seite“ as typed; null while it equals the stored text. */
  const [pageWishes, setPageWishes] = useState<string | null>(null);
  /** „Vollbild“: the window over the whole screen instead of the wide panel; remembered in this browser. */
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    try {
      setFullscreen(window.localStorage.getItem(FULLSCREEN_KEY) === "1");
    } catch {
      // No storage (private window): the wide panel.
    }
  }, []);
  function toggleFullscreen() {
    setFullscreen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(FULLSCREEN_KEY, next ? "1" : "0");
      } catch {
        // Not remembered, still switched.
      }
      return next;
    });
  }

  const base = page
    ? `/api/dt/content/pages/${encodeURIComponent(page.slug)}`
    : null;

  const loadReview = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    setError(null);
    const res = await contentApi<ContentReview>(`${base}/review?${contentQuery(organisationId)}`);
    if (res.ok) {
      setReview(res.data);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [base, organisationId]);

  useEffect(() => {
    if (!open || !page) return;
    setReview(null);
    setMode(null);
    setNote("");
    setReviseText("");
    setRevisePreview(null);
    setJobId(null);
    setPageWishes(null);
    void loadReview();
  }, [open, page, loadReview]);

  useEffect(() => {
    if (!jobId || !open) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const res = await contentApi<ContentJob>(
        `/api/dt/content/jobs/${encodeURIComponent(jobId)}?${contentQuery(organisationId)}`,
      );
      if (cancelled || !res.ok || res.data.state === "running") return;
      setJobId(null);
      if (res.data.state === "error") {
        toast.error(res.data.error || "Der Durchlauf ist fehlgeschlagen.");
      }
      void loadReview();
      onChangedRef.current();
    }, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, open, organisationId, loadReview]);

  // Opened on a page that is already running (no job id known): refresh until it pauses.
  const reviewRunning = review?.public.state === "laeuft";
  useEffect(() => {
    if (!open || jobId || !reviewRunning) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadReview();
    }, JOB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, jobId, reviewRunning, loadReview]);

  const handleClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  const blocks = useMemo(() => extractContentBlocks(review?.html ?? ""), [review?.html]);
  const findings = useMemo(() => (review ? openFindings(review) : []), [review]);
  /** The Abschnitt each open point is about, when the text shows it („Vorschlag übernehmen“ needs one). */
  const findingTargets = useMemo(() => {
    const parsed = parseBlocksFromHtml(review?.html ?? "");
    return new Map(findings.map((f) => [findingKey(f), findingTargetBlocks(f, parsed)] as const));
  }, [findings, review?.html]);
  // Chosen points that are gone (done, or the page changed) drop out of the choice.
  const chosenNow = chosen.filter((key) => findingTargets.has(key));
  const questions = useMemo(() => review?.questions ?? [], [review]);
  // Open points and the Abschnitte a question is about are marked in the text.
  const highlightIds = useMemo(
    () => [
      ...new Set(
        [...questions.map((q) => q.block_id), ...findings.map((f) => f.block_id)].filter((id): id is string => Boolean(id)),
      ),
    ],
    [findings, questions],
  );
  const actions = useMemo(
    () => (review?.actions ?? []).filter((a) => contentActionLabel(a.kind)),
    [review?.actions],
  );

  function startEdit(action: ContentAction) {
    const first = highlightIds[0] ?? blocks[0]?.id ?? "";
    setBlockId(first);
    setBlockText(blocks.find((b) => b.id === first)?.text ?? "");
    setMode({ kind: "edit", action });
  }

  /** „Abschnitt überarbeiten lassen“; from an open point with its Abschnitt chosen when the point names one. */
  function startRevise(finding: ContentFinding | null, ask: "instruction" | "proposal" | "info") {
    const parsed = parseBlocksFromHtml(review?.html ?? "");
    const target = finding ? findingTargetBlock(finding, parsed) : null;
    setBlockId(target ?? highlightIds[0] ?? blocks[0]?.id ?? "");
    setReviseText("");
    setRevisePreview(null);
    setMode({ kind: "revise", finding, ask });
  }

  async function requestRevision() {
    if (!base || mode?.kind !== "revise" || !blockId) return;
    setBusy("revise");
    setRevisePreview(null);
    const text = reviseText.trim();
    const res = await contentApi<RevisionPreviewData>(`${base}/revise`, {
      method: "POST",
      body: {
        organisationId,
        block_id: blockId,
        finding_key: mode.finding ? findingKey(mode.finding) : null,
        info: mode.ask === "info" ? text : null,
        instruction: mode.ask === "info" ? null : text || null,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRevisePreview(res.data);
  }

  async function applyRevisionPreview() {
    if (!base || mode?.kind !== "revise" || !revisePreview) return;
    setBusy("revise_apply");
    const text = reviseText.trim();
    const res = await contentApi<{ review: ContentReview }>(`${base}/revise/apply`, {
      method: "POST",
      body: {
        organisationId,
        block_id: revisePreview.before.id,
        before: { heading: revisePreview.before.heading, html: revisePreview.before.html },
        after: { heading: revisePreview.after.heading, html: revisePreview.after.html },
        finding_key: mode.finding ? findingKey(mode.finding) : null,
        info: mode.ask === "info" ? text : null,
        instruction: mode.ask === "info" ? null : text || null,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    setMode(null);
    setRevisePreview(null);
    setReviseText("");
    toast.success("Abschnitt übernommen");
    onChangedRef.current();
  }

  function toggleChosen(finding: ContentFinding) {
    const key = findingKey(finding);
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /**
   * „Jetzt umsetzen“: the chosen proposals, one call per Abschnitt (several points on one
   * Abschnitt go together), each taken over at once. A point whose result fails the checks stays
   * open and chosen, with the reason in a message.
   */
  async function applyChosen() {
    if (!base || chosenNow.length === 0) return;
    // A point about several Abschnitte goes into each one's call and is removed with the last.
    const groups = new Map<string, string[]>();
    for (const key of chosenNow) {
      for (const target of findingTargets.get(key) ?? []) groups.set(target, [...(groups.get(target) ?? []), key]);
    }
    const parsed = parseBlocksFromHtml(review?.html ?? "");
    const order = parsed.map((b) => b.id).filter((id) => groups.has(id));
    const lastOf = new Map<string, string>();
    for (const id of order) for (const key of groups.get(id)!) lastOf.set(key, id);
    // A point whose earlier Abschnitt failed stays open, even when its last one works.
    const failedKeys = new Set<string>();
    setBusy("apply_chosen");
    setApplying({ done: 0, total: order.length });
    const failed: string[] = [];
    let changed = false;
    for (const [i, id] of order.entries()) {
      const keys = groups.get(id)!;
      const res = await contentApi<{ review: ContentReview }>(`${base}/revise/auto`, {
        method: "POST",
        body: { organisationId, block_id: id, finding_keys: keys, done_keys: keys.filter((k) => lastOf.get(k) === id && !failedKeys.has(k)) },
      });
      if (res.ok) {
        changed = true;
        setReview(res.data.review);
        const done = keys.filter((k) => lastOf.get(k) === id && !failedKeys.has(k));
        setChosen((prev) => prev.filter((k) => !done.includes(k)));
      } else {
        for (const k of keys) failedKeys.add(k);
        const name = parsed.find((b) => b.id === id)?.heading || id;
        failed.push(`„${name}“: ${res.message}`);
      }
      setApplying({ done: i + 1, total: order.length });
    }
    setBusy(null);
    setApplying(null);
    if (changed) onChangedRef.current();
    if (failed.length === 0) toast.success(order.length === 1 ? "Vorschläge umgesetzt" : `Vorschläge in ${order.length} Abschnitten umgesetzt`);
    else toast.error(`Nicht umgesetzt (Punkte bleiben offen): ${failed.join(" · ")}`, { duration: 15_000 });
  }

  /** „So lassen“: the open point goes, the text stays, and later runs do not report it again. */
  async function dismissOpenPoint(finding: ContentFinding) {
    if (!base) return;
    setBusy("dismiss");
    const res = await contentApi<{ review: ContentReview }>(`${base}/findings/dismiss`, {
      method: "POST",
      body: { organisationId, finding_key: findingKey(finding) },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    onChangedRef.current();
  }

  /** „Vor der Watermark zur Durchsicht anhalten“ for this page. */
  async function toggleReviewStop(enabled: boolean) {
    if (!base) return;
    setBusy("review_stop");
    const res = await contentApi<ContentPagePatchResult>(`${base}`, { method: "PATCH", body: { organisationId, review_stop: enabled } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    toast.success(enabled ? "Hält vor der Watermark zur Durchsicht an" : "Läuft ohne Durchsicht bis zum Ende");
  }

  async function runStepAction(
    action: ContentAction,
    path: "approve" | "edit" | "run",
    body: Record<string, unknown>,
    done: string,
  ) {
    if (!base || action.step == null) {
      toast.error("Für diese Aktion fehlt der Schritt.");
      return;
    }
    setBusy(action.kind);
    const res = await contentApi<{ job_id?: string | null }>(`${base}/steps/${action.step}/${path}`, {
      method: "POST",
      body: { organisationId, ...body },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(done);
    setMode(null);
    setNote("");
    if (res.data?.job_id) setJobId(res.data.job_id);
    void loadReview();
    onChangedRef.current();
  }

  /** „Stoppen“ pauses after the last finished step; „Zurücksetzen“ wipes the page. */
  async function runReset(modeKind: "stop" | "reset") {
    if (!base) return;
    if (
      modeKind === "reset" &&
      !window.confirm(
        "Seite wirklich zurücksetzen? Text, Schritte, Fragen und Anmerkungen gehen verloren.",
      )
    ) {
      return;
    }
    setBusy(modeKind);
    const res = await contentApi<ContentReview>(`${base}/reset`, {
      method: "POST",
      body: { organisationId, mode: modeKind },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      void loadReview();
      return;
    }
    toast.success(modeKind === "stop" ? "Gestoppt – die Seite ist pausiert" : "Seite zurückgesetzt");
    setJobId(null);
    setMode(null);
    setReview(res.data);
    onChangedRef.current();
  }

  /** „Löschen“: the page disappears from the table; the drawer closes. */
  async function deletePage() {
    if (!base) return;
    if (
      !window.confirm(
        "Seite wirklich löschen? Text, Schritte und Fragen dieser Seite gehen verloren.",
      )
    ) {
      return;
    }
    setBusy("delete");
    const res = await contentApi<{ deleted: boolean }>(`${base}?${contentQuery(organisationId)}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Seite gelöscht");
    setJobId(null);
    onChangedRef.current();
    onClose();
  }

  /** „Seitentyp“: the editor overrides the Excel briefing and the crawl guess. */
  async function changePageType(next: string) {
    if (!base || !review) return;
    setBusy("page_type");
    const res = await contentApi<ContentPagePatchResult>(`${base}`, {
      method: "PATCH",
      body: { organisationId, page_type: next },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    toast.success(`Seitentyp: ${CONTENT_PAGE_TYPE_LABELS[next as ContentPageType] ?? next}`);
    onChangedRef.current();
  }

  /**
   * „Schritte“: one switch per step, saved at once like the Seitentyp. The whole list goes to
   * the server; it only affects steps the run has not reached yet.
   */
  async function toggleStep(step: ContentStep, run: boolean) {
    if (!base || !review) return;
    const next = run
      ? review.skip_steps.filter((key) => key !== step.key)
      : [...review.skip_steps.filter((key) => key !== step.key), step.key];
    setBusy("skip_steps");
    const res = await contentApi<ContentPagePatchResult>(`${base}`, {
      method: "PATCH",
      body: { organisationId, skip_steps: next },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    toast.success(run ? `${step.name} läuft wieder` : `${step.name} wird übersprungen`);
    onChangedRef.current();
  }

  /** „Zusätzliche Wünsche für diese Seite“: saved at once; the next step that runs reads them. */
  async function savePageWishes() {
    if (!base || pageWishes == null) return;
    setBusy("client_wishes");
    const res = await contentApi<ContentPagePatchResult>(`${base}`, {
      method: "PATCH",
      body: { organisationId, client_wishes: pageWishes },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setReview(res.data.review);
    setPageWishes(null);
    toast.success("Wünsche für diese Seite gespeichert – gilt ab dem nächsten Schritt.");
  }

  async function runThrough() {
    if (!base) return;
    setBusy("run_through");
    const res = await contentApi<ContentPageRunThroughResult>(`${base}/run-through`, {
      method: "POST",
      body: { organisationId },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Läuft weiter");
    if (res.data.id) setJobId(res.data.id);
    onChangedRef.current();
  }

  /** „HTML exportieren“ / „Text exportieren (.txt)“: the final text as a download. */
  async function exportPage(kind: "export" | "export_txt") {
    if (!base || !page) return;
    const format = kind === "export_txt" ? "txt" : "html";
    setBusy(kind);
    const res = await downloadContentExport(
      `${base}/export?${contentQuery(organisationId)}&format=${format}`,
      `${page.slug}.${format}`,
    );
    if (!res.ok) toast.error(res.message);
    setBusy(null);
  }

  function onAction(action: ContentAction) {
    switch (action.kind) {
      case "approve":
        // Questions and open points that were not handled („Abschnitt ändern“ clears the ones
        // of the edited Abschnitt): ask once, then send the same request.
        if (approveNeedsConfirm({ questions, findings }) && !window.confirm(CONTENT_APPROVE_OPEN_ITEMS_CONFIRM)) return;
        void runStepAction(action, "approve", {}, "Freigegeben");
        return;
      case "edit":
        startEdit(action);
        return;
      case "revise":
        startRevise(null, "instruction");
        return;
      case "rerun_with_note":
        setMode({ kind: "rerun", action });
        return;
      case "run_through":
        void runThrough();
        return;
      case "export":
      case "export_txt":
        void exportPage(action.kind);
        return;
      case "stop":
        void runReset("stop");
        return;
      case "reset":
        void runReset("reset");
        return;
      case "delete":
        void deletePage();
        return;
    }
  }

  const blockOptions = useMemo(() => {
    const ids = new Set(blocks.map((b) => b.id));
    const extra = highlightIds.filter((id) => !ids.has(id));
    return [
      ...blocks.map((b) => ({
        value: b.id,
        label: b.text.split("\n")[0]?.slice(0, 70) || b.id,
        description: highlightIds.includes(b.id) ? "Hat offene Punkte" : undefined,
      })),
      ...extra.map((id) => ({ value: id, label: id })),
    ];
  }, [blocks, highlightIds]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && page ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex justify-end bg-sbkm-navy/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="content-page-title"
          onClick={handleClose}
        >
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={cn(
              "flex h-full w-full flex-col border-l border-sbkm-navy/10 bg-[#F7F7FA] shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy",
              fullscreen ? "max-w-none" : "max-w-[min(1720px,94vw)]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sbkm-navy/10 bg-white px-4 py-4 dark:border-white/10 dark:bg-sbkm-navy sm:px-6">
              <div className="grid min-w-0 gap-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-500 dark:text-white/45">
                  Seite
                </p>
                <h2
                  id="content-page-title"
                  className="truncate text-lg font-bold tracking-tight text-sbkm-navy dark:text-white"
                >
                  {review?.name ?? page.name}
                </h2>
                {review ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <DtContentStatusBadge
                      state={review.public.state}
                      released={review.public.released}
                    />
                    {review.public.detail ? (
                      <span className="text-xs text-sbkm-ink-600 dark:text-white/60">
                        {review.public.detail}
                      </span>
                    ) : null}
                    {jobId ? (
                      <span className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300">
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                        Läuft weiter …
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="hidden size-9 items-center justify-center rounded-lg text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/8 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white sm:flex"
                  aria-label={fullscreen ? "Vollbild verlassen" : "Vollbild"}
                  title={fullscreen ? "Vollbild verlassen" : "Vollbild"}
                >
                  {fullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={Boolean(busy)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/8 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Schließen"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
              {loading && !review ? (
                <div className="flex items-center gap-2 px-6 py-10 text-sm text-sbkm-ink-600 dark:text-white/60">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Text wird geladen …
                </div>
              ) : error ? (
                <div className="m-6 rounded-dt border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  {error}
                </div>
              ) : review ? (
                <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="grid min-w-0 gap-4">
                    {review.legacy_steps && !review.public.released ? (
                      <div className="flex gap-2 rounded-dt border border-orange-300/70 bg-orange-50 px-4 py-3 text-xs leading-relaxed text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <p>
                          Diese Seite wurde mit einer älteren Schrittfolge begonnen (Recherche, Gliederung, Rohtext … oder
                          die Endabnahme als Schritt 8). Die aktuellen {CONTENT_STEP_COUNT} Schritte passen nicht dazu: bitte
                          „Zurücksetzen“ und neu starten.
                        </p>
                      </div>
                    ) : null}
                    {review.review_stop.status === "waiting" && review.public.state === "braucht_sie" && review.question_stop.status !== "waiting" ? (
                      <div className="grid gap-1 rounded-dt border border-sbkm-mint/50 bg-sbkm-mint/[0.08] px-4 py-3 text-sm text-sbkm-navy dark:border-sbkm-mint/30 dark:text-white">
                        <p className="font-semibold">Zur Durchsicht – vor der Watermark Entfernung</p>
                        <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/70">
                          Lesen Sie den Text und lassen Sie einzelne Abschnitte überarbeiten („Abschnitt überarbeiten lassen“ oder die Knöpfe
                          an den offenen Punkten). Mit „Freigeben und fertigstellen“ laufen die Watermark Entfernung und die Endabnahme.
                          Die Watermark Entfernung formuliert danach Sätze mit typischen KI-Mustern um; Überschriften, Zahlen, Platzhalter, Namen und Keywords bleiben.
                        </p>
                      </div>
                    ) : null}
                    {review.html ? (
                      <DtContentTextFrame
                        html={review.html}
                        title={`Text: ${review.name}`}
                        highlightBlockIds={highlightIds}
                        showHeadingLevels
                      />
                    ) : (
                      <div className="grid gap-1 rounded-dt border border-dashed border-sbkm-navy/15 bg-white/60 px-4 py-12 text-center dark:border-white/15 dark:bg-white/[0.04]">
                        <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                          {review.public.state === "laeuft"
                            ? "Der Text wird gerade geschrieben."
                            : "Für diese Seite gibt es noch keinen Text."}
                        </p>
                        <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
                          {review.public.state === "laeuft"
                            ? "Die Übersicht aktualisiert sich von selbst."
                            : "Mit „Weiterlaufen lassen“ startet das Schreiben."}
                        </p>
                      </div>
                    )}

                    {review.page_facts ? (
                      <details className="group rounded-dt border border-sbkm-navy/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.04]">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white">
                          <span>
                            Faktenauszug
                            <span className="ml-2 font-normal text-sbkm-ink-600 dark:text-white/60">{review.page_facts.summary}</span>
                          </span>
                          <ChevronDown className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden />
                        </summary>
                        <div className="grid gap-3 border-t border-sbkm-navy/8 px-4 py-3 text-sm dark:border-white/8">
                          <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
                            Was die Kundengespräche zum Thema dieser Seite sagen. Jeder Schritt bekommt diese Fakten zusätzlich zu den
                            Anbieterfakten. „Zurücksetzen“ erstellt den Auszug neu.
                          </p>
                          {review.page_facts.error ? (
                            <p className="text-xs text-red-700 dark:text-red-300">
                              Der Auszug konnte nicht erstellt werden, die Seite lief nur mit den Anbieterfakten: {review.page_facts.error}
                            </p>
                          ) : null}
                          {review.page_facts.skipped ? (
                            <p className="text-xs text-orange-800 dark:text-orange-200">
                              Kein Auszug erstellt, die Seite lief nur mit den Anbieterfakten: {review.page_facts.skipped}
                            </p>
                          ) : null}
                          {review.page_facts.shortened ? (
                            <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
                              Die Gespräche waren zu lang für einen Aufruf: Der Wortlaut wurde gekürzt, die Zusammenfassungen sind vollständig.
                            </p>
                          ) : null}
                          {review.page_facts.facts.length > 0 ? (
                            <ol className="grid list-decimal gap-2 pl-5 text-sbkm-navy dark:text-white">
                              {review.page_facts.facts.map((f, i) => (
                                <li key={i}>
                                  {f.topic ? <span className="font-semibold">{f.topic}: </span> : null}
                                  {f.fact}
                                  {f.source ? <span className="text-xs text-sbkm-ink-600 dark:text-white/60"> ({f.source})</span> : null}
                                  {f.quote ? (
                                    <span className="mt-0.5 block text-xs italic text-sbkm-ink-600 dark:text-white/60">„{f.quote}“</span>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          ) : !review.page_facts.error && !review.page_facts.skipped && review.page_facts.conversations > 0 ? (
                            <p className="text-xs text-sbkm-ink-600 dark:text-white/60">
                              In den Gesprächen steht nichts zum Thema dieser Seite.
                            </p>
                          ) : null}
                          {review.page_facts.blocked.length > 0 ? (
                            <div className="grid gap-1">
                              <p className="text-xs font-semibold text-sbkm-navy dark:text-white">
                                Gesperrt (nicht verwenden, auch nicht sinngemäß)
                              </p>
                              <ul className="grid list-disc gap-1 pl-5 text-xs text-sbkm-ink-600 dark:text-white/60">
                                {review.page_facts.blocked.map((b, i) => (
                                  <li key={i}>{b}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {review.page_facts.gaps.length > 0 ? (
                            <div className="grid gap-1">
                              <p className="text-xs font-semibold text-sbkm-navy dark:text-white">Fehlt in den Gesprächen</p>
                              <ul className="grid list-disc gap-1 pl-5 text-xs text-sbkm-ink-600 dark:text-white/60">
                                {review.page_facts.gaps.map((g, i) => (
                                  <li key={i}>{g}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}

                    <details className="group rounded-dt border border-sbkm-navy/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.04]">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white">
                        Details: {review.steps.length} Schritte
                        <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
                      </summary>
                      <ol className="divide-y divide-sbkm-navy/8 border-t border-sbkm-navy/8 dark:divide-white/8 dark:border-white/8">
                        {review.steps.map((s) => (
                          <li key={s.step} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                            <span className="flex min-w-0 items-start gap-3">
                              <span className="w-5 shrink-0 text-right text-xs leading-5 tabular-nums text-sbkm-ink-500 dark:text-white/40">
                                {s.step}
                              </span>
                              <span className="grid min-w-0 gap-0.5">
                                <span className="truncate text-sbkm-navy dark:text-white">{s.name}</span>
                                {contentStepLogLine(s) ? (
                                  <span className="text-xs tabular-nums text-sbkm-ink-600 dark:text-white/60">{contentStepLogLine(s)}</span>
                                ) : null}
                                {s.error ? (
                                  <span
                                    className={cn(
                                      "text-xs",
                                      s.status === "error" ? "text-red-700 dark:text-red-300" : "text-sbkm-ink-600 dark:text-white/60",
                                    )}
                                  >
                                    {s.error}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-3 text-xs">
                              <span
                                className={cn(
                                  "rounded-pill px-2 py-0.5 font-semibold",
                                  s.status === "done" &&
                                    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
                                  s.status === "running" &&
                                    "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
                                  s.status === "waiting" &&
                                    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
                                  s.status === "error" &&
                                    "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
                                  !["done", "running", "waiting", "error"].includes(s.status) &&
                                    "bg-sbkm-navy/[0.06] text-sbkm-ink-600 dark:bg-white/10 dark:text-white/60",
                                )}
                              >
                                {contentStepStatusLabel(s.status, { liveText: s.live_text, uploadText: s.upload_text })}
                              </span>
                              <span className="w-14 text-right tabular-nums text-sbkm-ink-600 dark:text-white/60">
                                {s.cost_eur > 0 ? formatEur(s.cost_eur) : "—"}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>

                  <aside className="grid gap-4 lg:sticky lg:top-0">
                    <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
                      <h3 className={sectionTitleClass}>
                        Briefing
                        <span className="font-semibold normal-case tracking-normal">
                          {review.briefing.source === "crawl"
                            ? review.briefing.from_excel
                              ? "aus Crawl und Excel"
                              : "aus dem Crawl"
                            : review.briefing.source === "upload"
                              ? "aus Word-Datei und Excel"
                              : "aus der Excel"}
                        </span>
                      </h3>
                      <DtSelect
                        label="Seitentyp"
                        value={review.briefing.page_type ?? ""}
                        onValueChange={(next) => void changePageType(next)}
                        options={[...CONTENT_PAGE_TYPE_OPTIONS]}
                        searchable={false}
                        placeholder="Noch nicht bestimmt"
                        disabled={Boolean(busy) || review.public.state === "laeuft"}
                        elevated
                        size="sm"
                        fullWidth
                      />
                      <div className="grid gap-1.5 border-t border-sbkm-navy/8 pt-2.5 dark:border-white/8">
                        <p className="text-xs font-semibold text-sbkm-navy dark:text-white">Schritte</p>
                        <ul className="grid gap-1">
                          {review.steps.map((s) => {
                            const alwaysRuns = s.key === "analyse" || s.key === "endabnahme";
                            // A step the page can no longer skip (SEO after it lost its live URL) can still be switched back on.
                            const locked = !s.skippable && !s.skipped_by_user;
                            return (
                              <li key={s.key} className="grid gap-0.5">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className="w-4 shrink-0 text-right tabular-nums text-sbkm-ink-500 dark:text-white/40">
                                      {s.step}
                                    </span>
                                    <span
                                      className={cn(
                                        "truncate",
                                        s.skipped_by_user
                                          ? "text-sbkm-ink-500 line-through dark:text-white/40"
                                          : "text-sbkm-navy dark:text-white/85",
                                      )}
                                    >
                                      {s.name}
                                    </span>
                                  </span>
                                  {alwaysRuns ? (
                                    <span
                                      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-sbkm-ink-500 dark:text-white/45"
                                      title={s.reason_locked ?? undefined}
                                    >
                                      <Lock className="size-3" aria-hidden />
                                      läuft immer
                                    </span>
                                  ) : (
                                    <DtAgentStatusToggle
                                      compact
                                      enabled={!s.skipped_by_user}
                                      disabled={Boolean(busy) || Boolean(jobId) || review.public.state === "laeuft" || locked}
                                      onChange={(run) => void toggleStep(s, run)}
                                      label={s.skipped_by_user ? `${s.name} wieder einschalten` : `${s.name} überspringen`}
                                    />
                                  )}
                                </div>
                                {!alwaysRuns && !s.skippable && s.reason_locked ? (
                                  <p className="ml-6 text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
                                    {s.reason_locked}
                                  </p>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                        <div className="flex items-center justify-between gap-2 border-t border-sbkm-navy/8 pt-2 text-xs dark:border-white/8">
                          <span className="text-sbkm-navy dark:text-white/85" title="Die Seite wartet vor der Watermark Entfernung, bis jemand den Text durchgesehen hat.">
                            Vor der Watermark zur Durchsicht anhalten
                          </span>
                          <DtAgentStatusToggle
                            compact
                            enabled={review.review_stop.enabled}
                            disabled={Boolean(busy) || Boolean(jobId)}
                            onChange={(on) => void toggleReviewStop(on)}
                            label={review.review_stop.enabled ? "Ohne Durchsicht durchlaufen" : "Vor der Watermark anhalten"}
                          />
                        </div>
                        {contentSkipWarnings(review.skip_steps, review.briefing.source).map((warning) => (
                          <p
                            key={warning}
                            className="flex gap-1.5 text-[11px] leading-snug text-orange-700 dark:text-orange-300"
                          >
                            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                            {warning}
                          </p>
                        ))}
                        <p className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">{CONTENT_SKIP_NOTE}</p>
                      </div>
                      <div className="grid gap-1.5 border-t border-sbkm-navy/8 pt-2.5 dark:border-white/8">
                        <label htmlFor="content-page-wishes" className="text-xs font-semibold text-sbkm-navy dark:text-white">
                          Zusätzliche Wünsche für diese Seite
                        </label>
                        <textarea
                          id="content-page-wishes"
                          className={cn(textareaClass, "min-h-[64px] text-xs")}
                          value={pageWishes ?? review.briefing.client_wishes}
                          onChange={(e) => setPageWishes(e.target.value)}
                          maxLength={CLIENT_WISHES_TEXT_MAX}
                          disabled={Boolean(busy)}
                          placeholder="Ein Wunsch pro Zeile, z. B. „Notdienst nicht erwähnen“"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <DtPillButton
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-3 text-xs"
                            disabled={Boolean(busy) || pageWishes == null || pageWishes.trim() === review.briefing.client_wishes.trim()}
                            onClick={() => void savePageWishes()}
                          >
                            {busy === "client_wishes" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                            Speichern
                          </DtPillButton>
                          <span className="text-[11px] leading-snug text-sbkm-ink-500 dark:text-white/45">
                            Zusätzlich zu den Kundenwünschen; gilt ab dem nächsten Schritt.
                          </span>
                        </div>
                      </div>
                      <dl className="grid gap-1 text-xs text-sbkm-ink-600 dark:text-white/65">
                        <div className="flex gap-2">
                          <dt className="shrink-0 font-semibold text-sbkm-navy dark:text-white">Hauptkeyword</dt>
                          <dd className="min-w-0 truncate">
                            {review.briefing.main_keyword
                              ? `${review.briefing.main_keyword}${review.briefing.main_keyword_volume != null ? ` (${review.briefing.main_keyword_volume}/Monat)` : ""}`
                              : "kommt aus der Analyse"}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="shrink-0 font-semibold text-sbkm-navy dark:text-white">Nutzerfragen</dt>
                          <dd>
                            {review.briefing.user_questions.length > 0
                              ? `${review.briefing.user_questions.length} aus der Excel (Spalte H)`
                              : "keine vorgegeben"}
                          </dd>
                        </div>
                        {review.briefing.pillar_name ? (
                          <div className="flex gap-2">
                            <dt className="shrink-0 font-semibold text-sbkm-navy dark:text-white">Hauptsilo</dt>
                            <dd className="min-w-0 truncate">{review.briefing.pillar_name}</dd>
                          </div>
                        ) : null}
                        {review.briefing.h1_options.length > 0 || review.briefing.ki_prompt ? (
                          <div className="flex gap-2">
                            <dt className="shrink-0 font-semibold text-sbkm-navy dark:text-white">Außerdem</dt>
                            <dd>
                              {[
                                review.briefing.h1_options.length > 0 ? `${review.briefing.h1_options.length} H1-Optionen` : "",
                                review.briefing.ki_prompt ? "KI-Prompt" : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </section>

                    <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
                      <h3 className={sectionTitleClass}>
                        Offene Punkte
                        <span className="tabular-nums">{findings.length}</span>
                      </h3>
                      {findings.length === 0 ? (
                        <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Keine offenen Punkte.</p>
                      ) : (
                        <ul className="grid gap-2.5">
                          {findings.map((f, i) => (
                            <li
                              key={`${f.title}-${i}`}
                              className={cn(
                                "grid gap-1.5 rounded-xl border p-3",
                                chosenNow.includes(findingKey(f))
                                  ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-400/50 dark:bg-emerald-500/10"
                                  : "border-sbkm-navy/8 bg-sbkm-navy/[0.02] dark:border-white/8 dark:bg-white/[0.03]",
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold leading-snug text-sbkm-navy dark:text-white">
                                  {f.title}
                                </p>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-bold",
                                    severityClass(f.severity),
                                  )}
                                >
                                  {f.severity_label}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/65">{f.problem}</p>
                              {f.proposal ? (
                                <p className="text-xs leading-relaxed text-sbkm-navy dark:text-white/85">
                                  <span className="font-semibold">Vorschlag: </span>
                                  {f.proposal}
                                </p>
                              ) : null}
                              {review.html && review.public.state !== "laeuft" ? (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {f.proposal && (findingTargets.get(findingKey(f))?.length ?? 0) > 0 ? (
                                    <button
                                      type="button"
                                      className={cn(
                                        findingButtonClass,
                                        chosenNow.includes(findingKey(f)) &&
                                          "border-emerald-500 bg-emerald-50 text-emerald-800 hover:border-emerald-600 dark:border-emerald-400/60 dark:bg-emerald-500/15 dark:text-emerald-200",
                                      )}
                                      disabled={Boolean(busy) || Boolean(jobId)}
                                      aria-pressed={chosenNow.includes(findingKey(f))}
                                      onClick={() => toggleChosen(f)}
                                      title="Vormerken. Alle vorgemerkten Vorschläge werden mit „Jetzt umsetzen“ gemeinsam umgesetzt."
                                    >
                                      {chosenNow.includes(findingKey(f)) ? "✓ Vorschlag übernommen" : "Vorschlag übernehmen"}
                                    </button>
                                  ) : f.proposal ? (
                                    <button
                                      type="button"
                                      className={findingButtonClass}
                                      disabled={Boolean(busy) || Boolean(jobId)}
                                      onClick={() => startRevise(f, "proposal")}
                                      title="Der Abschnitt ist nicht eindeutig: hier einzeln mit Abschnittswahl umsetzen."
                                    >
                                      Vorschlag umsetzen
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={findingButtonClass}
                                    disabled={Boolean(busy) || Boolean(jobId)}
                                    onClick={() => startRevise(f, "info")}
                                  >
                                    Eigene Angabe
                                  </button>
                                  <button
                                    type="button"
                                    className={findingButtonClass}
                                    disabled={Boolean(busy) || Boolean(jobId)}
                                    onClick={() => void dismissOpenPoint(f)}
                                    title="Der Text bleibt, wie er ist. Der Punkt verschwindet und wird bei einem erneuten Lauf nicht wieder gemeldet."
                                  >
                                    So lassen
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      {chosenNow.length > 0 || applying ? (
                        <div className="sticky bottom-0 grid gap-1.5 rounded-xl border border-emerald-400 bg-emerald-50 p-3 dark:border-emerald-400/50 dark:bg-emerald-950">
                          <p className="text-xs text-emerald-900 dark:text-emerald-100">
                            {applying
                              ? `Wird umgesetzt … Abschnitt ${Math.min(applying.done + 1, applying.total)} von ${applying.total}`
                              : `${chosenNow.length} ${chosenNow.length === 1 ? "Vorschlag" : "Vorschläge"} vorgemerkt. Mehrere Punkte im selben Abschnitt werden zusammen umgesetzt. Was die Prüfung nicht besteht, bleibt offen.`}
                          </p>
                          <button
                            type="button"
                            className="rounded-pill bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={Boolean(busy) || Boolean(jobId) || chosenNow.length === 0}
                            onClick={() => void applyChosen()}
                          >
                            {applying ? "Wird umgesetzt …" : "Jetzt umsetzen"}
                          </button>
                        </div>
                      ) : null}
                    </section>

                    <DtContentQuestionsPanel
                      organisationId={organisationId}
                      pageBase={base ?? ""}
                      review={review}
                      disabled={Boolean(busy) || Boolean(jobId)}
                      onReview={(next, nextJob) => {
                        setReview(next);
                        if (nextJob) setJobId(nextJob);
                        onChangedRef.current();
                      }}
                    />

                    {showFreshness(review) ? (
                      <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
                        <h3 className={sectionTitleClass}>
                          Aktualität
                          <span className="tabular-nums">{review.freshness.updates.length}</span>
                        </h3>
                        {review.freshness.updates.length === 0 ? (
                          <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Keine Aussage musste aktualisiert werden.</p>
                        ) : (
                          <ul className="grid gap-2.5">
                            {review.freshness.updates.map((u, i) => (
                              <li
                                key={`${u.block_id}-${i}`}
                                className="grid gap-1.5 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-3 dark:border-white/8 dark:bg-white/[0.03]"
                              >
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                  Aktualisiert · Abschnitt „{u.section || u.block_id}“
                                </p>
                                <p className="text-xs leading-relaxed text-sbkm-navy dark:text-white/85">
                                  <span className="text-sbkm-ink-500 line-through dark:text-white/45">{u.old_text}</span>
                                  {" → "}
                                  <span className="font-semibold">{u.new_text}</span>
                                </p>
                                {isWebUrl(u.source_url) ? (
                                  <a
                                    href={u.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-sbkm-navy underline-offset-2 hover:underline dark:text-white"
                                    title={u.source_url}
                                  >
                                    <span className="truncate">{freshnessSourceLabel({ url: u.source_url, title: u.source_title })}</span>
                                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                                  </a>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/60">
                          {freshnessSendBackLine(review.freshness)}
                        </p>
                      </section>
                    ) : null}

                    <section className="grid gap-1 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
                      <h3 className={sectionTitleClass}>Kosten</h3>
                      <p className="text-2xl font-bold tabular-nums tracking-tight text-sbkm-navy dark:text-white">
                        {review.public.cost}
                      </p>
                      <p className="text-xs text-sbkm-ink-600 dark:text-white/60">bisher für diese Seite</p>
                    </section>
                  </aside>
                </div>
              ) : null}
            </div>

            {review && (actions.length > 0 || mode) ? (
              <footer className="shrink-0 border-t border-sbkm-navy/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-sbkm-navy sm:px-6">
                {mode?.kind === "edit" ? (
                  <div className="mb-3 grid gap-2">
                    <DtSelect
                      label="Abschnitt"
                      value={blockId}
                      onValueChange={(id) => {
                        setBlockId(id);
                        setBlockText(blocks.find((b) => b.id === id)?.text ?? "");
                      }}
                      options={blockOptions}
                      elevated
                      side="top"
                      fullWidth
                    />
                    <textarea
                      className={textareaClass}
                      value={blockText}
                      onChange={(e) => setBlockText(e.target.value)}
                      aria-label="Neuer Text für den Abschnitt"
                    />
                    <div className="flex flex-wrap gap-2">
                      <DtPillButton
                        size="sm"
                        disabled={!blockId || !blockText.trim() || Boolean(busy)}
                        onClick={() =>
                          void runStepAction(
                            mode.action,
                            "edit",
                            { block_id: blockId, text: blockText },
                            "Abschnitt gespeichert",
                          )
                        }
                      >
                        {busy === "edit" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Abschnitt speichern
                      </DtPillButton>
                      <DtPillButton size="sm" variant="ghost" onClick={() => setMode(null)}>
                        Abbrechen
                      </DtPillButton>
                    </div>
                  </div>
                ) : null}

                {mode?.kind === "revise" ? (
                  <div className="mb-3 grid gap-2">
                    {mode.finding ? (
                      <p className="text-xs text-sbkm-ink-600 dark:text-white/65">
                        <span className="font-semibold text-sbkm-navy dark:text-white">Offener Punkt: </span>
                        {mode.finding.title}
                        {mode.ask === "proposal" && mode.finding.proposal ? ` – Vorschlag: ${mode.finding.proposal}` : ""}
                      </p>
                    ) : null}
                    <DtSelect
                      label="Abschnitt"
                      value={blockId}
                      onValueChange={(id) => {
                        setBlockId(id);
                        setRevisePreview(null);
                      }}
                      options={blockOptions}
                      elevated
                      side="top"
                      fullWidth
                    />
                    <textarea
                      className={textareaClass}
                      value={reviseText}
                      onChange={(e) => {
                        setReviseText(e.target.value);
                        setRevisePreview(null);
                      }}
                      placeholder={
                        mode.ask === "info"
                          ? "Ihre Angabe, z. B. „Ja, pro Uhr gibt es eine schriftliche Aufstellung.“ Zahlen, Namen und Fristen werden genau so übernommen. „KUNDE PRÜFT“ setzt einen Platzhalter."
                          : mode.ask === "proposal"
                            ? "Optional: zusätzlicher Hinweis zum Vorschlag"
                            : "Was soll anders werden? z. B. „Hero-Überschrift kürzer und mehr auf Erben zugeschnitten.“"
                      }
                      aria-label={mode.ask === "info" ? "Ihre Angabe" : "Auftrag für den Abschnitt"}
                    />
                    {revisePreview ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(["before", "after"] as const).map((side) => {
                          const b = revisePreview[side];
                          return (
                            <div
                              key={side}
                              className={cn(
                                "grid max-h-56 gap-1 overflow-y-auto rounded-xl border p-3 text-xs leading-relaxed",
                                side === "after"
                                  ? "border-sbkm-mint/60 bg-sbkm-mint/[0.08] dark:border-sbkm-mint/40"
                                  : "border-sbkm-navy/10 bg-sbkm-navy/[0.02] dark:border-white/10 dark:bg-white/[0.03]",
                              )}
                            >
                              <p className="text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55">
                                {side === "before" ? "Vorher" : revisePreview.watermark ? "Nachher (mit Watermark Entfernung)" : "Nachher"}
                              </p>
                              {b.heading ? (
                                <p className="font-semibold text-sbkm-navy dark:text-white">
                                  [H{b.level}] {b.heading}
                                </p>
                              ) : null}
                              {b.html && side === "before" ? (
                                <p className="whitespace-pre-line text-sbkm-navy dark:text-white/85">{htmlToPlainText(b.html)}</p>
                              ) : null}
                              {b.html && side === "after" ? (
                                <p className="text-sbkm-navy dark:text-white/85">
                                  {markNewSentences(htmlToPlainText(revisePreview.before.html), htmlToPlainText(b.html)).map((part, k) =>
                                    part.isNew ? (
                                      <mark key={k} className="rounded-sm bg-yellow-200/70 px-0.5 text-sbkm-navy dark:bg-yellow-300/30 dark:text-white" title="Neu oder geändert: bitte prüfen">
                                        {part.text}{" "}
                                      </mark>
                                    ) : (
                                      <span key={k}>{part.text} </span>
                                    ),
                                  )}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {revisePreview ? (
                        <DtPillButton size="sm" variant="mint" disabled={Boolean(busy)} onClick={() => void applyRevisionPreview()}>
                          {busy === "revise_apply" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          Übernehmen
                        </DtPillButton>
                      ) : null}
                      <DtPillButton
                        size="sm"
                        variant={revisePreview ? "outline" : "mint"}
                        disabled={!blockId || Boolean(busy) || (mode.ask !== "proposal" && !reviseText.trim())}
                        onClick={() => void requestRevision()}
                      >
                        {busy === "revise" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        {revisePreview ? "Neu erstellen" : "Vorschlag erstellen"}
                      </DtPillButton>
                      <DtPillButton
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMode(null);
                          setRevisePreview(null);
                        }}
                      >
                        {revisePreview ? "Verwerfen" : "Abbrechen"}
                      </DtPillButton>
                      {revisePreview ? (
                        <span className="text-[11px] text-sbkm-ink-600 dark:text-white/55">
                          Gelb markiert: neu oder geändert, bitte gegen die Fakten prüfen · Kosten: {formatEur(revisePreview.cost_eur)}
                        </span>
                      ) : busy === "revise" ? (
                        <span className="text-[11px] text-sbkm-ink-600 dark:text-white/55">Wird überarbeitet, das dauert bis zu einer Minute …</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {mode?.kind === "rerun" ? (
                  <div className="mb-3 grid gap-2">
                    <textarea
                      className={textareaClass}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Was soll anders werden? z. B. „Kürzer, ohne Zahlen, mehr auf Senioren eingehen.“"
                      aria-label="Anmerkung"
                    />
                    <div className="flex flex-wrap gap-2">
                      <DtPillButton
                        size="sm"
                        disabled={!note.trim() || Boolean(busy)}
                        onClick={() =>
                          void runStepAction(mode.action, "run", { note }, "Wird mit Anmerkung wiederholt")
                        }
                      >
                        {busy === "rerun_with_note" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Anmerkung senden
                      </DtPillButton>
                      <DtPillButton size="sm" variant="ghost" onClick={() => setMode(null)}>
                        Abbrechen
                      </DtPillButton>
                    </div>
                  </div>
                ) : null}

                {!mode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {actions.map((action, index) => {
                      const button = (
                        <DtPillButton
                          key={`${action.kind}-${action.step ?? ""}`}
                          size="sm"
                          variant={
                            action.kind === "approve"
                              ? "mint"
                              : RIGHT_ACTIONS.has(action.kind)
                                ? "ghost"
                                : "outline"
                          }
                          disabled={
                            Boolean(busy) ||
                            Boolean(action.disabled_reason) ||
                            (Boolean(jobId) && !["stop", "reset", "delete"].includes(action.kind))
                          }
                          onClick={() => onAction(action)}
                          className={cn(
                            // export / reset / delete sit on the right; the first of them takes the margin
                            RIGHT_ACTIONS.has(action.kind) &&
                              actions.findIndex((a) => RIGHT_ACTIONS.has(a.kind)) === index &&
                              "sm:ml-auto",
                            (action.kind === "reset" || action.kind === "delete") && "text-red-700 dark:text-red-300",
                          )}
                        >
                          {busy === action.kind ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : action.kind === "export" ? (
                            <Download className="size-3.5" aria-hidden />
                          ) : action.kind === "export_txt" ? (
                            <FileText className="size-3.5" aria-hidden />
                          ) : null}
                          {action.kind === "approve" ? action.label : contentActionLabel(action.kind)}
                        </DtPillButton>
                      );
                      // A disabled button shows no tooltip: the reason sits on a wrapper.
                      return action.disabled_reason ? (
                        <span key={`${action.kind}-${action.step ?? ""}`} title={action.disabled_reason} className="inline-flex">
                          {button}
                        </span>
                      ) : (
                        button
                      );
                    })}
                  </div>
                ) : null}
              </footer>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
