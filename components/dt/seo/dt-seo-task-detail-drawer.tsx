"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageSquare, Trash2, X, FileText } from "lucide-react";

import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { cn } from "@/components/dt/cn";
import type { DtSeoTaskAssignee } from "@/lib/dt/seo/task-assignees";
import type { DtSeoTaskRow } from "@/lib/dt/types";

const inputClass =
  "h-10 w-full rounded-dt border border-sbkm-navy/15 bg-white/80 px-3 text-sm text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 placeholder:text-sbkm-ink-500 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40 dark:focus-visible:border-sbkm-mint/35";

const textareaClass =
  "min-h-[120px] w-full resize-y rounded-dt border border-sbkm-navy/15 bg-white/80 px-3 py-2.5 text-sm leading-relaxed text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 placeholder:text-sbkm-ink-500 focus-visible:border-sbkm-mint/40 focus-visible:ring-2 focus-visible:ring-sbkm-mint/30 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40 dark:focus-visible:border-sbkm-mint/35";

const labelClass =
  "text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-600 dark:text-white/55";

const selectProps = {
  elevated: true as const,
  collisionPadding: 16,
};

const PRIORITY_OPTIONS = [
  { value: "", label: "Keine" },
  { value: "low", label: "Niedrig" },
  { value: "medium", label: "Mittel" },
  { value: "high", label: "Hoch" },
  { value: "urgent", label: "Dringend" },
] as const;

const STATUS_OPTIONS = [
  { value: "open", label: "Offen" },
  { value: "in_progress", label: "In Arbeit" },
  { value: "done", label: "Erledigt" },
  { value: "wont_fix", label: "Won't fix" },
] as const;

export type DtSeoTaskDetailPatch = {
  title: string;
  url: string | null;
  keyword: string | null;
  currentStatus: string | null;
  action: string | null;
  assignedToUserId: string | null;
  priority: string | null;
  status: DtSeoTaskRow["status"];
  notes: string | null;
  dueAt: string | null;
};

function dueAtToDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function dueAtFromDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(`${trimmed}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emptyToNull(value: string): string | null {
  const t = value.trim();
  return t.length ? t : null;
}

function taskToForm(task: DtSeoTaskRow) {
  return {
    title: task.title,
    url: task.url ?? "",
    keyword: task.keyword ?? "",
    currentStatus: task.current_status ?? "",
    action: task.action ?? "",
    assignedToUserId: task.assigned_to_user_id ?? "",
    priority: task.priority ?? "",
    status: task.status,
    notes: task.notes ?? "",
    dueAt: dueAtToDateInput(task.due_at),
  };
}

export function DtSeoTaskDetailDrawer(props: {
  task: DtSeoTaskRow | null;
  assignees: DtSeoTaskAssignee[];
  organisationId: string;
  open: boolean;
  onClose: () => void;
  onSave: (patch: DtSeoTaskDetailPatch) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  saving?: boolean;
  deleting?: boolean;
}) {
  const { task, open } = props;
  const [form, setForm] = useState(() => (task ? taskToForm(task) : null));

  useEffect(() => {
    if (task && open) {
      setForm(taskToForm(task));
    }
  }, [task, open]);

  const assigneeOptions = useMemo(
    () => [
      { value: "", label: "Nicht zugewiesen" },
      ...props.assignees.map((a) => ({ value: a.id, label: a.email })),
    ],
    [props.assignees],
  );

  const handleClose = useCallback(() => {
    if (!props.saving && !props.deleting) props.onClose();
  }, [props]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  async function handleSave() {
    if (!task || !form || props.saving) return;
    const title = form.title.trim();
    if (!title) return;

    await props.onSave({
      title,
      url: emptyToNull(form.url),
      keyword: emptyToNull(form.keyword),
      currentStatus: emptyToNull(form.currentStatus),
      action: emptyToNull(form.action),
      assignedToUserId: form.assignedToUserId || null,
      priority: form.priority || null,
      status: form.status,
      notes: emptyToNull(form.notes),
      dueAt: dueAtFromDateInput(form.dueAt),
    });
  }

  async function handleDelete() {
    if (!task || props.deleting) return;
    if (!window.confirm("Aufgabe wirklich löschen?")) return;
    await props.onDelete(task.id);
  }

  const chatHref =
    task?.chat_id
      ? `/dashboard/verwaltung/seo?org=${encodeURIComponent(props.organisationId)}&tab=chat&chat=${encodeURIComponent(task.chat_id)}`
      : null;

  const reportHref =
    task?.report_id
      ? `/dashboard/verwaltung/seo/reports/${encodeURIComponent(task.report_id)}?org=${encodeURIComponent(props.organisationId)}`
      : null;

  return (
    <AnimatePresence>
      {open && task && form ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex justify-end bg-sbkm-navy/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seo-task-detail-title"
          onClick={handleClose}
        >
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={cn(
              "flex h-full w-full max-w-lg flex-col border-l border-sbkm-navy/10 bg-white shadow-dt-lg",
              "dark:border-white/10 dark:bg-sbkm-navy",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sbkm-navy/10 px-4 py-4 dark:border-white/10 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-sbkm-ink-500 dark:text-white/45">
                  Aufgabe
                </p>
                <h2
                  id="seo-task-detail-title"
                  className="mt-1 line-clamp-2 text-base font-bold leading-snug tracking-tight text-sbkm-navy dark:text-white sm:text-lg"
                >
                  {form.title.trim() || "Details"}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={props.saving || props.deleting}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sbkm-ink-500 transition-colors hover:bg-sbkm-navy/8 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Schließen"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 scrollbar-subtle sm:px-5">
              <div className="grid gap-5 pb-2">
                <label className="grid gap-2">
                  <span className={labelClass}>Titel</span>
                  <input
                    className={inputClass}
                    value={form.title}
                    onChange={(e) => setForm((f) => f && { ...f, title: e.target.value })}
                    placeholder="Was muss gemacht werden?"
                  />
                </label>

                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className={labelClass}>Keyword</span>
                    <input
                      className={inputClass}
                      value={form.keyword}
                      onChange={(e) => setForm((f) => f && { ...f, keyword: e.target.value })}
                      placeholder="z. B. umzug köln"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className={labelClass}>Seiten-URL</span>
                    <input
                      className={inputClass}
                      value={form.url}
                      onChange={(e) => setForm((f) => f && { ...f, url: e.target.value })}
                      placeholder="https://…"
                    />
                  </label>
                </div>

                <label className="grid gap-2">
                  <span className={labelClass}>Ist-Stand</span>
                  <input
                    className={inputClass}
                    value={form.currentStatus}
                    onChange={(e) => setForm((f) => f && { ...f, currentStatus: e.target.value })}
                    placeholder="z. B. Pos. 12, 340 Impr."
                  />
                </label>

                <label className="grid gap-2">
                  <span className={labelClass}>Maßnahme</span>
                  <textarea
                    className={textareaClass}
                    value={form.action}
                    onChange={(e) => setForm((f) => f && { ...f, action: e.target.value })}
                    placeholder="Schritt-für-Schritt Anleitung …"
                  />
                </label>

                <div className="grid gap-5 sm:grid-cols-2">
                  <DtSelect
                    {...selectProps}
                    label="Priorität"
                    labelClassName={labelClass}
                    fullWidth
                    triggerClassName="rounded-dt"
                    value={form.priority}
                    onValueChange={(value) =>
                      setForm((f) => f && { ...f, priority: value })
                    }
                    options={[...PRIORITY_OPTIONS]}
                  />
                  <DtSelect
                    {...selectProps}
                    label="Status"
                    labelClassName={labelClass}
                    fullWidth
                    triggerClassName="rounded-dt"
                    value={form.status}
                    onValueChange={(value) =>
                      setForm((f) =>
                        f ? { ...f, status: value as DtSeoTaskRow["status"] } : f,
                      )
                    }
                    options={[...STATUS_OPTIONS]}
                  />
                </div>

                <DtSelect
                  {...selectProps}
                  label="Zugewiesen an"
                  labelClassName={labelClass}
                  fullWidth
                  triggerClassName="rounded-dt"
                  value={form.assignedToUserId}
                  onValueChange={(value) =>
                    setForm((f) => f && { ...f, assignedToUserId: value })
                  }
                  options={assigneeOptions}
                />

                <label className="grid gap-2">
                  <span className={labelClass}>Notizen</span>
                  <input
                    className={inputClass}
                    value={form.notes}
                    onChange={(e) => setForm((f) => f && { ...f, notes: e.target.value })}
                    placeholder="Zusätzliche Infos …"
                  />
                </label>

                <label className="grid gap-2">
                  <span className={labelClass}>Fällig am</span>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.dueAt}
                    onChange={(e) => setForm((f) => f && { ...f, dueAt: e.target.value })}
                  />
                </label>

                <dl className="grid gap-2 rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.03] px-3 py-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex justify-between gap-2">
                    <dt className="font-semibold text-sbkm-ink-500 dark:text-white/45">Erstellt</dt>
                    <dd className="text-sbkm-navy dark:text-white/80">
                      {formatDateTime(task.created_at)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="font-semibold text-sbkm-ink-500 dark:text-white/45">Aktualisiert</dt>
                    <dd className="text-sbkm-navy dark:text-white/80">
                      {formatDateTime(task.updated_at)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="font-semibold text-sbkm-ink-500 dark:text-white/45">Erledigt am</dt>
                    <dd className="text-sbkm-navy dark:text-white/80">
                      {formatDateTime(task.completed_at)}
                    </dd>
                  </div>
                </dl>

                {(reportHref || chatHref) ? (
                  <div className="flex flex-wrap gap-4 border-t border-sbkm-navy/10 pt-4 dark:border-white/10">
                    {reportHref ? (
                      <Link
                        href={reportHref}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-sbkm-mint transition-colors hover:text-sbkm-navy dark:hover:text-white"
                      >
                        <FileText className="h-4 w-4 shrink-0" aria-hidden />
                        Zum SEO-Report
                      </Link>
                    ) : null}

                    {chatHref ? (
                      <Link
                        href={chatHref}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-sbkm-mint transition-colors hover:text-sbkm-navy dark:hover:text-white"
                      >
                        <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
                        Zum SEO-Chat
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-sbkm-navy/10 bg-sbkm-navy/[0.02] px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:px-5">
              <DtPillButton
                type="button"
                variant="mint"
                size="full"
                disabled={props.saving || props.deleting || !form.title.trim()}
                onClick={() => void handleSave()}
                className="sm:min-w-0 sm:flex-1"
              >
                {props.saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Speichern
              </DtPillButton>
              <DtPillButton
                type="button"
                variant="outline"
                size="full"
                disabled={props.saving || props.deleting}
                onClick={() => void handleDelete()}
                className="inline-flex items-center justify-center gap-2 text-red-600 dark:text-red-400 sm:w-auto"
              >
                {props.deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Löschen
              </DtPillButton>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
