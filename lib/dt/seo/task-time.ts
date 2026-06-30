import { createServiceClient } from "@/lib/supabase/service";
import type { DtSeoTaskTimeEntryRow } from "@/lib/dt/types";

export type DtSeoTaskTimeEntryView = {
  id: string;
  userId: string;
  userEmail: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  note: string | null;
};

/** Resolve auth user ids to emails via the service client (profiles). */
export async function resolveTimeEntryEmails(
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const service = createServiceClient();
  const { data } = await service
    .from("profiles")
    .select("id, email")
    .in("id", unique);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.id && row.email) map.set(row.id, row.email);
  }
  return map;
}

export function toTimeEntryViews(
  entries: DtSeoTaskTimeEntryRow[],
  emailById: Map<string, string>,
): DtSeoTaskTimeEntryView[] {
  return entries.map((e) => ({
    id: e.id,
    userId: e.user_id,
    userEmail: emailById.get(e.user_id) ?? null,
    startedAt: e.started_at,
    endedAt: e.ended_at,
    durationSeconds: e.duration_seconds,
    note: e.note,
  }));
}

/**
 * Total tracked seconds, counting a still-running entry up to "now" so the UI
 * total stays meaningful while a timer is active.
 */
export function totalTrackedSeconds(entries: DtSeoTaskTimeEntryRow[]): number {
  const now = Date.now();
  let total = 0;
  for (const e of entries) {
    if (e.ended_at) {
      total += e.duration_seconds ?? 0;
    } else {
      total += Math.max(0, Math.round((now - new Date(e.started_at).getTime()) / 1000));
    }
  }
  return total;
}
