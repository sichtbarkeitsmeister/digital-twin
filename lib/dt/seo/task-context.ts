import type { SupabaseClient } from "@supabase/supabase-js";

import type { DtSeoTaskRow } from "@/lib/dt/types";

export type DtSeoTaskPromptRow = Pick<
  DtSeoTaskRow,
  "title" | "keyword" | "status" | "current_status" | "action" | "updated_at"
>;

const STATUS_ORDER: Record<DtSeoTaskRow["status"], number> = {
  in_progress: 0,
  open: 1,
  done: 2,
  wont_fix: 3,
};

function taskStatusLabel(status: DtSeoTaskRow["status"]): string {
  switch (status) {
    case "open":
      return "Offen";
    case "in_progress":
      return "In Arbeit";
    case "done":
      return "Erledigt";
    case "wont_fix":
      return "Won't fix";
    default:
      return status;
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatTaskLine(task: DtSeoTaskPromptRow): string {
  const parts = [`[${taskStatusLabel(task.status)}] ${task.title.trim()}`];
  if (task.keyword?.trim()) parts.push(`Keyword: ${task.keyword.trim()}`);
  if (task.current_status?.trim()) parts.push(`Ist: ${task.current_status.trim()}`);
  const action = truncate(task.action, 140);
  if (action) parts.push(`Maßnahme: ${action}`);
  return `- ${parts.join(" | ")}`;
}

export async function loadDtSeoTasksForPrompt(
  supabase: SupabaseClient,
  organisationId: string,
  limit = 60,
): Promise<DtSeoTaskPromptRow[]> {
  const { data, error } = await supabase
    .from("dt_seo_tasks")
    .select("title,keyword,status,current_status,action,updated_at")
    .eq("organisation_id", organisationId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[dt] loadDtSeoTasksForPrompt:", error.message);
    return [];
  }

  const rows = (data ?? []) as DtSeoTaskPromptRow[];
  return rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function formatDtSeoTasksForPrompt(tasks: DtSeoTaskPromptRow[]): string {
  if (tasks.length === 0) {
    return [
      "Noch keine SEO-Aufgaben im Board.",
      "Du darfst neue, konkrete Maßnahmen vorschlagen — der Nutzer kann sie als Aufgabe speichern.",
    ].join("\n");
  }

  const active = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");
  const wontFix = tasks.filter((t) => t.status === "wont_fix");

  const sections: string[] = [
    "Diese Aufgaben existieren bereits im SEO-Aufgaben-Board. Prüfe sie, bevor du Maßnahmen empfiehlst oder sagst, der Nutzer solle etwas „als Aufgabe speichern“.",
    "",
    "Regeln:",
    "- Schlage keine neue Aufgabe vor, die inhaltlich dieselbe Maßnahme oder dasselbe Keyword abdeckt wie eine offene oder laufende Aufgabe.",
    "- Verweise stattdessen auf die bestehende Aufgabe (Titel/Status) oder schlage nur einen nächsten Schritt/Follow-up vor.",
    "- Erledigte Aufgaben nicht erneut als neue Aufgabe vorschlagen — höchstens kurz nachfragen, ob ein Follow-up sinnvoll ist.",
    "- Aufgaben mit Status „Won't fix“ nicht erneut empfehlen.",
  ];

  if (active.length > 0) {
    sections.push("", "Aktiv (Offen / In Arbeit):", ...active.map(formatTaskLine));
  }

  if (done.length > 0) {
    sections.push("", "Erledigt (Referenz):", ...done.map(formatTaskLine));
  }

  if (wontFix.length > 0) {
    sections.push("", "Won't fix (nicht erneut vorschlagen):", ...wontFix.map(formatTaskLine));
  }

  return sections.join("\n");
}
