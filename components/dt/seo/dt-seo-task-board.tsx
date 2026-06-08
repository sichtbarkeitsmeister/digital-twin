"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Focus,
  LayoutGrid,
  ListTodo,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Plus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/components/dt/cn";
import {
  useDtSeoWorkspaceUrl,
} from "@/lib/dt/seo/workspace-url";
import {
  DtSeoTaskDetailDrawer,
  type DtSeoTaskDetailPatch,
} from "@/components/dt/seo/dt-seo-task-detail-drawer";
import type { DtSeoTaskAssignee } from "@/lib/dt/seo/task-assignees";
import type { DtSeoTaskRow } from "@/lib/dt/types";

type TaskStatus = DtSeoTaskRow["status"];

const COLUMNS: Array<{
  id: TaskStatus;
  label: string;
  icon: typeof Circle;
  accent: string;
  chipActive: string;
}> = [
  {
    id: "open",
    label: "Offen",
    icon: Circle,
    accent: "text-sbkm-ink-500 dark:text-white/50",
    chipActive: "bg-sbkm-navy text-white dark:bg-white/15",
  },
  {
    id: "in_progress",
    label: "In Arbeit",
    icon: PauseCircle,
    accent: "text-amber-600 dark:text-amber-400",
    chipActive: "bg-amber-600/90 text-white",
  },
  {
    id: "done",
    label: "Erledigt",
    icon: CheckCircle2,
    accent: "text-emerald-600 dark:text-emerald-400",
    chipActive: "bg-emerald-600/90 text-white",
  },
  {
    id: "wont_fix",
    label: "Won't fix",
    icon: XCircle,
    accent: "text-sbkm-ink-400 dark:text-white/40",
    chipActive: "bg-sbkm-ink-500/80 text-white",
  },
];


function displayTitle(title: string) {
  return title.replace(/^[\s"'„""«»]+|[\s"'„""«»]+$/g, "").trim();
}

function displayPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || url;
  } catch {
    return url;
  }
}

const PRIORITY_LABEL: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  urgent: "Dringend",
};

const ACTIVE_STATUSES: TaskStatus[] = ["open", "in_progress"];

function statusLabel(status: TaskStatus) {
  return COLUMNS.find((c) => c.id === status)?.label ?? status;
}

function assigneeInitials(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return (local.slice(0, 2) || "?").toUpperCase();
}

function assigneeDisplay(
  task: DtSeoTaskRow,
  assigneeById: Map<string, string>,
): string | null {
  if (task.assigned_to_user_id) {
    return assigneeById.get(task.assigned_to_user_id) ?? task.assigned_to_label;
  }
  return task.assigned_to_label;
}

const listVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const } },
};

function TaskBoardSkeleton({ columns }: { columns: number }) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-4",
        columns >= 2 && "md:grid-cols-2",
        columns >= 4 && "2xl:grid-cols-4",
      )}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-dt border border-sbkm-navy/10 dark:border-white/10"
        >
          <div className="h-10 animate-dt-shimmer border-b border-sbkm-navy/8 bg-sbkm-navy/5 dark:border-white/8 dark:bg-white/5" />
          <div className="grid gap-px">
            {[0, 1].map((j) => (
              <div
                key={j}
                className="h-20 animate-dt-shimmer bg-sbkm-navy/[0.03] dark:bg-white/[0.03]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColumnEmpty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <ListTodo className="mb-2 h-5 w-5 text-sbkm-ink-400 dark:text-white/35" aria-hidden />
      <p className="text-xs font-medium text-sbkm-ink-600 dark:text-white/50">
        Keine Aufgaben in „{label}“
      </p>
    </div>
  );
}

function TaskMoveMenu(props: {
  taskTitle: string;
  currentStatus: TaskStatus;
  moving: boolean;
  onMove: (status: TaskStatus) => void;
}) {
  const otherStatuses = COLUMNS.filter((c) => c.id !== props.currentStatus);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={props.moving}
          aria-label={`Status für ${props.taskTitle} ändern`}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sbkm-ink-500 transition-colors duration-150",
            "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            "hover:bg-sbkm-navy/8 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45",
            "dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white",
            props.moving && "cursor-wait opacity-50",
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {otherStatuses.map((col) => (
          <DropdownMenuItem
            key={col.id}
            onSelect={() => props.onMove(col.id)}
            className="cursor-pointer text-sm font-semibold"
          >
            Verschieben → {col.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskCard(props: {
  task: DtSeoTaskRow;
  moving: boolean;
  assigneeEmail: string | null;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
}) {
  const { task } = props;
  const title = displayTitle(task.title);
  const isArchived = task.status === "done" || task.status === "wont_fix";

  return (
    <article
      className={cn(
        "group relative transition-colors duration-150",
        "hover:bg-sbkm-navy/[0.04] dark:hover:bg-white/[0.04]",
        props.moving && "opacity-50",
        isArchived && "opacity-90",
      )}
    >
      <button
        type="button"
        onClick={props.onOpen}
        className="w-full px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sbkm-mint/45"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight text-sbkm-navy dark:text-white">
            {title}
          </p>
          {task.action && task.action !== task.title ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-sbkm-ink-600 dark:text-white/50">
              {task.action}
            </p>
          ) : null}
          {task.url ? (
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                window.open(task.url!, "_blank", "noopener,noreferrer");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(task.url!, "_blank", "noopener,noreferrer");
                }
              }}
              className="mt-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 truncate text-[11px] font-medium text-sbkm-mint hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45"
            >
              <span className="truncate">{displayPath(task.url)}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </span>
          ) : null}
          {props.assigneeEmail || task.priority || task.keyword ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {props.assigneeEmail ? (
                <span className="inline-flex max-w-full items-center gap-1 rounded-pill bg-sbkm-navy/8 px-2 py-0.5 text-[10px] font-semibold text-sbkm-navy dark:bg-white/10 dark:text-white/85">
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sbkm-mint/25 text-[9px] font-bold text-sbkm-navy dark:text-white"
                    aria-hidden
                  >
                    {assigneeInitials(props.assigneeEmail)}
                  </span>
                  <span className="truncate">{props.assigneeEmail}</span>
                </span>
              ) : null}
              {task.priority ? (
                <span className="rounded-pill bg-sbkm-mint/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sbkm-navy dark:bg-sbkm-mint/18 dark:text-white">
                  {PRIORITY_LABEL[task.priority] ?? task.priority}
                </span>
              ) : null}
              {task.keyword ? (
                <span className="truncate text-[10px] font-medium text-sbkm-ink-500 dark:text-white/40">
                  {task.keyword}
                </span>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
      </button>
      <div className="absolute right-2 top-2">
        <TaskMoveMenu
          taskTitle={title}
          currentStatus={task.status}
          moving={props.moving}
          onMove={props.onMove}
        />
      </div>
    </article>
  );
}

function TaskColumn(props: {
  col: (typeof COLUMNS)[number];
  tasks: DtSeoTaskRow[];
  count: number;
  movingId: string | null;
  assigneeById: Map<string, string>;
  onOpenTask: (taskId: string) => void;
  onMove: (taskId: string, status: TaskStatus) => void;
}) {
  const ColIcon = props.col.icon;
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-dt border border-sbkm-navy/10 bg-white/50 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-white/[0.04]"
      aria-label={props.col.label}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-sbkm-navy/8 bg-sbkm-navy/[0.03] px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]">
        <div className="flex min-w-0 items-center gap-2">
          <ColIcon className={cn("h-4 w-4 shrink-0", props.col.accent)} aria-hidden />
          <h3 className="truncate text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/55">
            {props.col.label}
          </h3>
        </div>
        <span className="shrink-0 rounded-pill bg-sbkm-navy/8 px-2 py-0.5 text-[11px] font-bold tabular-nums text-sbkm-navy dark:bg-white/10 dark:text-white">
          {props.count}
        </span>
      </header>

      <div className="min-h-[88px] md:max-h-[min(480px,calc(100dvh-20rem))] md:overflow-y-auto md:scrollbar-subtle">
        {props.tasks.length === 0 ? (
          <ColumnEmpty label={props.col.label} />
        ) : (
          <motion.ul
            className="divide-y divide-sbkm-navy/8 dark:divide-white/8"
            variants={listVariants}
            initial="hidden"
            animate="show"
          >
            <AnimatePresence mode="popLayout">
              {props.tasks.map((task) => (
                <motion.li
                  key={task.id}
                  layout
                  variants={cardVariants}
                  exit={{ opacity: 0, scale: 0.98 }}
                >
                  <TaskCard
                    task={task}
                    moving={props.movingId === task.id}
                    assigneeEmail={assigneeDisplay(task, props.assigneeById)}
                    onOpen={() => props.onOpenTask(task.id)}
                    onMove={(status) => props.onMove(task.id, status)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </section>
  );
}

function TaskStatusFilter(props: {
  active: TaskStatus;
  counts: Record<TaskStatus, number>;
  onChange: (status: TaskStatus) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Status filtern"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-subtle md:hidden"
    >
      {COLUMNS.map((col) => {
        const isActive = props.active === col.id;
        const ColIcon = col.icon;
        return (
          <button
            key={col.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => props.onChange(col.id)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-2 text-xs font-bold transition-colors duration-150 active:scale-[0.98]",
              isActive
                ? "border-transparent text-white shadow-sm"
                : "border-sbkm-navy/12 bg-white/60 text-sbkm-navy dark:border-white/12 dark:bg-white/8 dark:text-white",
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="task-status-pill"
                className={cn("absolute inset-0 rounded-pill", col.chipActive)}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            ) : null}
            <ColIcon className="relative z-10 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="relative z-10">{col.label}</span>
            <span
              className={cn(
                "relative z-10 tabular-nums",
                isActive ? "opacity-90" : "text-sbkm-ink-500 dark:text-white/50",
              )}
            >
              {props.counts[col.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DtSeoTaskBoard(props: { organisationId: string }) {
  const { writeUrl, taskStatus, taskFocus } = useDtSeoWorkspaceUrl();
  const [tasks, setTasks] = useState<DtSeoTaskRow[]>([]);
  const [assignees, setAssignees] = useState<DtSeoTaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [deletingDetail, setDeletingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assigneeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) map.set(a.id, a.email);
    return map;
  }, [assignees]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const refresh = useCallback(async () => {
    const org = encodeURIComponent(props.organisationId);
    const [tasksRes, assigneesRes] = await Promise.all([
      fetch(`/api/dt/seo/tasks?org=${org}`),
      fetch(`/api/dt/seo/tasks/assignees?org=${org}`),
    ]);
    const tasksJson = (await tasksRes.json()) as {
      ok?: boolean;
      tasks?: DtSeoTaskRow[];
      message?: string;
    };
    const assigneesJson = (await assigneesRes.json()) as {
      ok?: boolean;
      assignees?: DtSeoTaskAssignee[];
      message?: string;
    };
    if (tasksJson.ok && tasksJson.tasks) {
      setTasks(tasksJson.tasks);
      setError(null);
    } else if (!tasksJson.ok) {
      setError(tasksJson.message ?? "Aufgaben konnten nicht geladen werden.");
    }
    if (assigneesJson.ok && assigneesJson.assignees) {
      setAssignees(assigneesJson.assignees);
    }
    setLoading(false);
  }, [props.organisationId]);

  useEffect(() => {
    setLoading(true);
    setSelectedTaskId(null);
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const map: Record<TaskStatus, number> = {
      open: 0,
      in_progress: 0,
      done: 0,
      wont_fix: 0,
    };
    for (const t of tasks) map[t.status] += 1;
    return map;
  }, [tasks]);

  const tasksByStatus = useMemo(() => {
    const map: Record<TaskStatus, DtSeoTaskRow[]> = {
      open: [],
      in_progress: [],
      done: [],
      wont_fix: [],
    };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

  const visibleColumns = useMemo(() => {
    if (taskFocus) return COLUMNS.filter((c) => ACTIVE_STATUSES.includes(c.id));
    return COLUMNS;
  }, [taskFocus]);

  const activeMobileColumn = COLUMNS.find((c) => c.id === taskStatus) ?? COLUMNS[0]!;

  const setStatusFilter = useCallback(
    (status: TaskStatus) => {
      writeUrl({ taskStatus: status });
    },
    [writeUrl],
  );

  const toggleFocus = useCallback(() => {
    writeUrl({ taskFocus: !taskFocus });
  }, [writeUrl, taskFocus]);

  async function addTask() {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setError(null);
    const res = await fetch("/api/dt/seo/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId: props.organisationId, title }),
    });
    const json = (await res.json()) as { ok?: boolean; task?: DtSeoTaskRow; message?: string };
    setAdding(false);
    if (!json.ok) {
      const msg = json.message ?? "Aufgabe konnte nicht erstellt werden.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setNewTitle("");
    if (json.task) {
      setTasks((prev) => [json.task!, ...prev]);
    } else {
      await refresh();
    }
    writeUrl({ taskStatus: "open" });
    toast.success("Aufgabe erstellt");
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    const prev = tasks;
    const prevStatus = prev.find((t) => t.id === taskId)?.status;
    if (prevStatus === status) return;

    setMovingId(taskId);
    setTasks((list) =>
      list.map((t) => (t.id === taskId ? { ...t, status, updated_at: new Date().toISOString() } : t)),
    );
    const res = await fetch(`/api/dt/seo/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setMovingId(null);
    if (!json.ok) {
      setTasks(prev);
      const msg = json.message ?? "Status konnte nicht geändert werden.";
      setError(msg);
      toast.error(msg);
      return;
    }
    writeUrl({ taskStatus: status });
    toast.success(`Verschoben nach „${statusLabel(status)}“`);
  }

  async function saveTaskDetail(taskId: string, patch: DtSeoTaskDetailPatch) {
    setSavingDetail(true);
    setError(null);
    const res = await fetch(`/api/dt/seo/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: patch.title,
        url: patch.url,
        keyword: patch.keyword,
        currentStatus: patch.currentStatus,
        action: patch.action,
        assignedToUserId: patch.assignedToUserId,
        priority: patch.priority,
        status: patch.status,
        notes: patch.notes,
        dueAt: patch.dueAt,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      task?: DtSeoTaskRow;
      message?: string;
    };
    setSavingDetail(false);
    if (!json.ok || !json.task) {
      const msg = json.message ?? "Speichern fehlgeschlagen.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setTasks((list) => list.map((t) => (t.id === taskId ? json.task! : t)));
    writeUrl({ taskStatus: json.task.status });
    toast.success("Aufgabe gespeichert");
  }

  async function deleteTaskDetail(taskId: string) {
    setDeletingDetail(true);
    setError(null);
    const res = await fetch(`/api/dt/seo/tasks/${taskId}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    setDeletingDetail(false);
    if (!json.ok) {
      const msg = json.message ?? "Löschen fehlgeschlagen.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setTasks((list) => list.filter((t) => t.id !== taskId));
    setSelectedTaskId(null);
    toast.success("Aufgabe gelöscht");
  }

  const gridClass = cn(
    "grid min-w-0 gap-4",
    visibleColumns.length === 2 && "md:grid-cols-2",
    visibleColumns.length >= 4 && "md:grid-cols-2 2xl:grid-cols-4",
  );

  return (
    <motion.div
      className="grid min-w-0 gap-4 sm:gap-5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <DtGlassCard
        variant="subtle"
        padding="sm"
        className="relative min-w-0 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.06)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/50 before:to-transparent dark:before:via-white/15"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-sbkm-navy sm:text-lg dark:text-white">
              SEO-Aufgaben
            </h2>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/55">
              <span className="tabular-nums font-semibold text-sbkm-navy dark:text-white">
                {tasks.length}
              </span>{" "}
              Aufgaben
              <span className="hidden sm:inline"> · Priorisiere Maßnahmen aus Chat und Reports</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFocus}
              aria-pressed={taskFocus}
              className={cn(
                "hidden items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-bold transition-all duration-150 active:scale-[0.98] md:inline-flex",
                taskFocus
                  ? "border-sbkm-mint/40 bg-sbkm-mint/15 text-sbkm-navy dark:border-sbkm-mint/30 dark:bg-sbkm-mint/20 dark:text-white"
                  : "border-sbkm-navy/12 bg-white/60 text-sbkm-ink-600 hover:border-sbkm-mint/30 dark:border-white/12 dark:bg-white/8 dark:text-white/70",
              )}
            >
              <Focus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Fokus
              {taskFocus ? (
                <span className="tabular-nums text-sbkm-ink-500 dark:text-white/50">
                  ({counts.open + counts.in_progress})
                </span>
              ) : null}
            </button>
            {!taskFocus ? (
              <div className="hidden items-center gap-1.5 text-xs font-medium text-sbkm-ink-500 md:flex 2xl:hidden dark:text-white/45">
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>2×2 Board</span>
              </div>
            ) : null}
            <div className="hidden flex-wrap gap-2 text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 2xl:flex dark:text-white/50">
              {COLUMNS.map((col) => (
                <span
                  key={col.id}
                  className="rounded-pill border border-sbkm-navy/10 bg-white/60 px-2.5 py-1 tabular-nums dark:border-white/10 dark:bg-white/5"
                >
                  {col.label}{" "}
                  <span className="text-sbkm-navy dark:text-white">{counts[col.id]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Neue Aufgabe hinzufügen …"
            disabled={adding}
            className="h-11 min-w-0 flex-1 rounded-pill border border-sbkm-navy/15 bg-white/80 px-4 text-sm text-sbkm-navy shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition duration-150 placeholder:text-sbkm-ink-500 focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTask();
            }}
          />
          <DtPillButton
            type="button"
            disabled={adding || !newTitle.trim()}
            onClick={() => void addTask()}
            className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 active:scale-[0.98] sm:w-auto"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Hinzufügen
          </DtPillButton>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </DtGlassCard>

      {loading ? (
        <TaskBoardSkeleton columns={taskFocus ? 2 : 4} />
      ) : tasks.length === 0 ? (
        <DtGlassCard
          padding="lg"
          className="flex flex-col items-center justify-center text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(46,46,80,0.06)]"
        >
          <ListTodo className="h-10 w-10 text-sbkm-mint" aria-hidden />
          <p className="mt-3 text-base font-bold tracking-tight text-sbkm-navy dark:text-white">
            Noch keine Aufgaben
          </p>
          <p className="mt-1 max-w-sm text-sm text-sbkm-ink-600 dark:text-white/55">
            Lege oben eine Aufgabe an oder speichere eine Empfehlung direkt aus dem SEO-Chat.
          </p>
        </DtGlassCard>
      ) : (
        <>
          <TaskStatusFilter
            active={taskStatus}
            counts={counts}
            onChange={setStatusFilter}
          />

          {/* Mobile: one column with crossfade */}
          <div className="md:hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={taskStatus}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <TaskColumn
                  col={activeMobileColumn}
                  tasks={tasksByStatus[taskStatus]}
                  count={counts[taskStatus]}
                  movingId={movingId}
                  assigneeById={assigneeById}
                  onOpenTask={setSelectedTaskId}
                  onMove={moveTask}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Tablet / laptop / desktop */}
          <div className={cn(gridClass, "hidden md:grid")}>
            {visibleColumns.map((col) => (
              <TaskColumn
                key={col.id}
                col={col}
                tasks={tasksByStatus[col.id]}
                count={counts[col.id]}
                movingId={movingId}
                assigneeById={assigneeById}
                onOpenTask={setSelectedTaskId}
                onMove={moveTask}
              />
            ))}
          </div>
        </>
      )}

      <DtSeoTaskDetailDrawer
        task={selectedTask}
        assignees={assignees}
        organisationId={props.organisationId}
        open={selectedTask !== null}
        onClose={() => setSelectedTaskId(null)}
        saving={savingDetail}
        deleting={deletingDetail}
        onSave={async (patch) => {
          if (!selectedTask) return;
          await saveTaskDetail(selectedTask.id, patch);
        }}
        onDelete={deleteTaskDetail}
      />
    </motion.div>
  );
}
