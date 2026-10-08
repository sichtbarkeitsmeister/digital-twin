"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Loader2,
  MessageCircleQuestion,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { DtContentStatusBadge } from "@/components/dt/content/dt-content-status-badge";
import { DtContentTextFrame } from "@/components/dt/content/dt-content-text-frame";
import {
  contentActionLabel,
  contentStepStatusLabel,
  extractContentBlocks,
  formatEur,
} from "@/lib/dt/content/presentation";
import type {
  ContentAction,
  ContentFinding,
  ContentJob,
  ContentPageRunThroughResult,
  ContentReview,
} from "@/lib/dt/content/types";

const textareaClass =
  "min-h-[120px] w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-3 py-2.5 text-sm leading-relaxed text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 placeholder:text-sbkm-ink-500 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40";

const sectionTitleClass =
  "flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55";

const JOB_POLL_MS = 4_000;

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

type Mode = { kind: "edit"; action: ContentAction } | { kind: "rerun"; action: ContentAction } | null;

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
  const [jobId, setJobId] = useState<string | null>(null);

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
    setJobId(null);
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
  const highlightIds = useMemo(
    () => findings.map((f) => f.block_id).filter((id): id is string => Boolean(id)),
    [findings],
  );
  const actions = useMemo(
    () => (review?.actions ?? []).filter((a) => contentActionLabel(a.kind)),
    [review?.actions],
  );

  function startEdit(action: ContentAction) {
    const first = findings.find((f) => f.block_id)?.block_id ?? blocks[0]?.id ?? "";
    setBlockId(first);
    setBlockText(blocks.find((b) => b.id === first)?.text ?? "");
    setMode({ kind: "edit", action });
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
        "Seite wirklich komplett zurücksetzen? Text, Schritte, Fragen, Anmerkungen und Kosten dieser Seite werden gelöscht. Name und Quelle bleiben.",
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
        "Seite wirklich löschen? Die Zeile verschwindet aus der Tabelle, mit Text, Schritten und Fragen. Aus der Seitenstruktur kommt sie beim nächsten Upload wieder, aus dem Crawl beim nächsten „Übernehmen“.",
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

  async function exportHtml() {
    if (!base || !page) return;
    setBusy("export");
    try {
      const res = await fetch(`${base}/export?${contentQuery(organisationId)}&format=html`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(json?.message ?? "Export fehlgeschlagen.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${page.slug}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error("Export fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  function onAction(action: ContentAction) {
    switch (action.kind) {
      case "approve":
        void runStepAction(action, "approve", {}, "Freigegeben");
        return;
      case "edit":
        startEdit(action);
        return;
      case "rerun_with_note":
        setMode({ kind: "rerun", action });
        return;
      case "run_through":
        void runThrough();
        return;
      case "export":
        void exportHtml();
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
            className="flex h-full w-full max-w-6xl flex-col border-l border-sbkm-navy/10 bg-[#F7F7FA] shadow-dt-lg dark:border-white/10 dark:bg-sbkm-navy"
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
              <button
                type="button"
                onClick={handleClose}
                disabled={Boolean(busy)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/8 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Schließen"
              >
                <X className="size-5" aria-hidden />
              </button>
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
                <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
                  <div className="grid min-w-0 gap-4">
                    {review.html ? (
                      <DtContentTextFrame
                        html={review.html}
                        title={`Text: ${review.name}`}
                        highlightBlockIds={highlightIds}
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

                    <details className="group rounded-dt border border-sbkm-navy/10 bg-white/70 dark:border-white/10 dark:bg-white/[0.04]">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white">
                        Details: {review.steps.length} Schritte
                        <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
                      </summary>
                      <ol className="divide-y divide-sbkm-navy/8 border-t border-sbkm-navy/8 dark:divide-white/8 dark:border-white/8">
                        {review.steps.map((s) => (
                          <li key={s.step} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-sbkm-ink-500 dark:text-white/40">
                                {s.step}
                              </span>
                              <span className="truncate text-sbkm-navy dark:text-white">{s.name}</span>
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
                                {contentStepStatusLabel(s.status)}
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
                              className="grid gap-1.5 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-3 dark:border-white/8 dark:bg-white/[0.03]"
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
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="grid gap-2.5 rounded-dt border border-sbkm-navy/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.05]">
                      <h3 className={sectionTitleClass}>
                        Fragen an den Kunden
                        <span className="tabular-nums">{review.questions.length}</span>
                      </h3>
                      {review.questions.length === 0 ? (
                        <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Keine Fragen offen.</p>
                      ) : (
                        <ul className="grid gap-2.5">
                          {review.questions.map((q, i) => (
                            <li key={`${q.question}-${i}`} className="grid gap-1.5">
                              <p className="flex gap-2 text-sm font-medium leading-snug text-sbkm-navy dark:text-white">
                                <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
                                {q.question}
                              </p>
                              {q.excerpt ? (
                                <blockquote className="ml-6 border-l-2 border-sbkm-navy/15 pl-2.5 text-xs italic text-sbkm-ink-600 dark:border-white/20 dark:text-white/60">
                                  {q.excerpt}
                                </blockquote>
                              ) : null}
                              {q.blocking ? (
                                <p className="ml-6 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 dark:text-orange-300">
                                  <AlertTriangle className="size-3" aria-hidden />
                                  Muss vor dem Weiterlaufen geklärt werden
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

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
                    {actions.map((action, index) => (
                      <DtPillButton
                        key={`${action.kind}-${action.step ?? ""}`}
                        size="sm"
                        variant={
                          action.kind === "approve"
                            ? "mint"
                            : action.kind === "export" || action.kind === "reset" || action.kind === "delete"
                              ? "ghost"
                              : "outline"
                        }
                        disabled={
                          Boolean(busy) ||
                          (Boolean(jobId) && !["stop", "reset", "delete"].includes(action.kind))
                        }
                        onClick={() => onAction(action)}
                        className={cn(
                          // export / reset / delete sit on the right; the first of them takes the margin
                          ["export", "reset", "delete"].includes(action.kind) &&
                            actions.findIndex((a) => ["export", "reset", "delete"].includes(a.kind)) === index &&
                            "sm:ml-auto",
                          (action.kind === "reset" || action.kind === "delete") && "text-red-700 dark:text-red-300",
                        )}
                      >
                        {busy === action.kind ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : action.kind === "export" ? (
                          <Download className="size-3.5" aria-hidden />
                        ) : null}
                        {contentActionLabel(action.kind)}
                      </DtPillButton>
                    ))}
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
