import { createServiceClient } from "@/lib/supabase/service";
import type { DtSeoTaskRow } from "@/lib/dt/types";

const STATUS_VALUES = new Set(["open", "in_progress", "done", "wont_fix"]);
const PRIORITY_VALUES = new Set(["low", "medium", "high", "urgent"]);

export type DtSeoTaskToolPatch = {
  title?: string;
  url?: string | null;
  keyword?: string | null;
  action?: string | null;
  status?: DtSeoTaskRow["status"];
  priority?: string | null;
  currentStatus?: string | null;
  notes?: string | null;
};

function formatTaskSummary(task: Pick<
  DtSeoTaskRow,
  "id" | "title" | "status" | "keyword" | "url" | "action" | "priority" | "current_status"
>): string {
  const parts = [
    `ID: ${task.id}`,
    `Titel: ${task.title}`,
    `Status: ${task.status}`,
  ];
  if (task.keyword) parts.push(`Keyword: ${task.keyword}`);
  if (task.url) parts.push(`URL: ${task.url}`);
  if (task.priority) parts.push(`Priorität: ${task.priority}`);
  if (task.current_status) parts.push(`Ist: ${task.current_status}`);
  if (task.action?.trim()) {
    const action =
      task.action.length > 180 ? `${task.action.slice(0, 179)}…` : task.action;
    parts.push(`Maßnahme: ${action}`);
  }
  return parts.join("\n");
}

export async function updateSeoTaskForTool(
  organisationId: string,
  taskId: string,
  patch: DtSeoTaskToolPatch,
): Promise<string> {
  const id = taskId.trim();
  if (!id) return "Keine taskId angegeben.";

  const supabase = createServiceClient();
  const { data: existing, error: loadError } = await supabase
    .from("dt_seo_tasks")
    .select("id,organisation_id,title,status,keyword,url,action,priority,current_status")
    .eq("id", id)
    .maybeSingle();

  if (loadError) return `Fehler beim Laden: ${loadError.message}`;
  if (!existing || existing.organisation_id !== organisationId) {
    return `Aufgabe ${id} nicht gefunden (oder gehört nicht zu dieser Organisation). Nutze die IDs aus „Bestehende SEO-Aufgaben“.`;
  }

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return "title darf nicht leer sein.";
    if (title.length > 500) return "title ist zu lang (max. 500).";
    update.title = title;
  }
  if (patch.url !== undefined) {
    update.url = patch.url?.trim() || null;
  }
  if (patch.keyword !== undefined) {
    update.keyword = patch.keyword?.trim() || null;
  }
  if (patch.action !== undefined) {
    update.action = patch.action?.trim() || null;
  }
  if (patch.notes !== undefined) {
    update.notes = patch.notes?.trim() || null;
  }
  if (patch.currentStatus !== undefined) {
    update.current_status = patch.currentStatus?.trim() || null;
  }
  if (patch.status !== undefined) {
    if (!STATUS_VALUES.has(patch.status)) {
      return `Ungültiger Status „${patch.status}“. Erlaubt: open, in_progress, done, wont_fix.`;
    }
    update.status = patch.status;
    update.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  if (patch.priority !== undefined) {
    if (patch.priority === null || patch.priority === "") {
      update.priority = null;
    } else if (!PRIORITY_VALUES.has(patch.priority)) {
      return `Ungültige Priorität „${patch.priority}“. Erlaubt: low, medium, high, urgent.`;
    } else {
      update.priority = patch.priority;
    }
  }

  if (Object.keys(update).length === 0) {
    return "Keine Änderungen angegeben. Übergebe mindestens ein Feld (title, status, action, …).";
  }

  const { data, error } = await supabase
    .from("dt_seo_tasks")
    .update(update)
    .eq("id", id)
    .eq("organisation_id", organisationId)
    .select("id,title,status,keyword,url,action,priority,current_status")
    .single();

  if (error || !data) {
    return `Update fehlgeschlagen: ${error?.message ?? "unbekannt"}`;
  }

  return `Aufgabe aktualisiert:\n${formatTaskSummary(data as DtSeoTaskRow)}`;
}

export async function deleteSeoTaskForTool(
  organisationId: string,
  taskId: string,
): Promise<string> {
  const id = taskId.trim();
  if (!id) return "Keine taskId angegeben.";

  const supabase = createServiceClient();
  const { data: existing, error: loadError } = await supabase
    .from("dt_seo_tasks")
    .select("id,organisation_id,title,status,keyword,url,action,priority,current_status")
    .eq("id", id)
    .maybeSingle();

  if (loadError) return `Fehler beim Laden: ${loadError.message}`;
  if (!existing || existing.organisation_id !== organisationId) {
    return `Aufgabe ${id} nicht gefunden (oder gehört nicht zu dieser Organisation). Nutze die IDs aus „Bestehende SEO-Aufgaben“.`;
  }

  const { error } = await supabase
    .from("dt_seo_tasks")
    .delete()
    .eq("id", id)
    .eq("organisation_id", organisationId);

  if (error) return `Löschen fehlgeschlagen: ${error.message}`;

  return `Aufgabe gelöscht:\n${formatTaskSummary(existing as DtSeoTaskRow)}`;
}
