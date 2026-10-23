/**
 * When the daily sweep (job `seo.grounding_schedule`) queues a check on its own:
 * the hub's 3-month review is due soon or overdue — or the organisation has no grounding
 * page at all — and no run is open (running, draft waiting for review, approved but not
 * uploaded). Each cycle gets one run; an overdue or missing page is re-checked monthly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GROUNDING_PAGE_INTERVAL_MONTHS,
  addUtcMonths,
  evaluateGroundingPageSchedule,
} from "@/lib/dt/seo/grounding-page-schedule";
import { OPEN_RUN_STATUSES, groundingRunsDbErrorMessage } from "@/lib/dt/seo/grounding-check/store";
import type { DtGroundingRunStatus } from "@/lib/dt/types";

/** An overdue page with a rejected draft is checked again after this many days. */
export const GROUNDING_RECHECK_DAYS = 30;
/** Scheduled checks per sweep; the rest wait for the next day. */
export const MAX_SCHEDULED_PER_SWEEP = 10;
/** Minutes between the scheduled jobs of one sweep. */
const STAGGER_MINUTES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleDecision = { schedule: boolean; reason: string };

export function shouldScheduleGroundingCheck(input: {
  hub: { lastReviewed: string | null; uploadedAt: string | null } | null;
  runs: Array<{ status: DtGroundingRunStatus; createdAt: string }>;
  now?: Date;
}): ScheduleDecision {
  const now = input.now ?? new Date();
  if (input.runs.some((r) => OPEN_RUN_STATUSES.includes(r.status))) {
    return { schedule: false, reason: "Es gibt schon einen offenen Lauf." };
  }
  const recentSince = (since: number) => input.runs.some((r) => new Date(r.createdAt).getTime() >= since);

  if (!input.hub) {
    const since = addUtcMonths(now, -GROUNDING_PAGE_INTERVAL_MONTHS).getTime();
    return recentSince(since)
      ? { schedule: false, reason: "Ohne Grounding Page schon in den letzten drei Monaten geprüft." }
      : { schedule: true, reason: "Keine Grounding Page erfasst." };
  }

  const schedule = evaluateGroundingPageSchedule({ lastReviewed: input.hub.lastReviewed, uploadedAt: input.hub.uploadedAt, now });
  if (schedule.status === "ok") return { schedule: false, reason: "Nicht fällig." };

  const recheckSince = now.getTime() - GROUNDING_RECHECK_DAYS * DAY_MS;
  const warnAt = schedule.warnAt ? new Date(schedule.warnAt).getTime() : recheckSince;
  const since = Math.max(warnAt, recheckSince);
  if (recentSince(since)) return { schedule: false, reason: "In diesem Fälligkeitsfenster schon geprüft." };
  return {
    schedule: true,
    reason:
      schedule.status === "overdue"
        ? "Aktualisierung überfällig."
        : schedule.status === "due_soon"
          ? "Aktualisierung bald fällig."
          : "Kein Prüf- oder Upload-Datum.",
  };
}

export type SweepCandidate = { organisationId: string; reason: string };

/** Organisations whose check is due, at most MAX_SCHEDULED_PER_SWEEP, most overdue first. */
export async function findDueGroundingChecks(service: SupabaseClient, now = new Date()): Promise<SweepCandidate[]> {
  const { data: configs, error } = await service
    .from("dt_org_config")
    .select("organisation_id, website_url")
    .eq("seo_enabled", true)
    .eq("disabled", false);
  if (error) throw new Error(error.message);
  const orgIds = ((configs ?? []) as Array<{ organisation_id: string; website_url: string | null }>)
    .filter((c) => (c.website_url ?? "").trim())
    .map((c) => c.organisation_id);
  if (orgIds.length === 0) return [];

  const since = new Date(now.getTime() - 200 * DAY_MS).toISOString();
  const [{ data: hubs, error: hubError }, { data: runs, error: runError }] = await Promise.all([
    service.from("dt_grounding_pages").select("organisation_id, last_reviewed, uploaded_at").eq("kind", "hub").in("organisation_id", orgIds),
    service.from("dt_grounding_runs").select("organisation_id, status, created_at").in("organisation_id", orgIds).gte("created_at", since),
  ]);
  if (hubError) throw new Error(hubError.message);
  if (runError) throw new Error(groundingRunsDbErrorMessage(runError, "Läufe konnten nicht geladen werden"));

  const hubByOrg = new Map(
    ((hubs ?? []) as Array<{ organisation_id: string; last_reviewed: string | null; uploaded_at: string | null }>).map((h) => [
      h.organisation_id,
      { lastReviewed: h.last_reviewed, uploadedAt: h.uploaded_at },
    ]),
  );
  const runsByOrg = new Map<string, Array<{ status: DtGroundingRunStatus; createdAt: string }>>();
  for (const r of (runs ?? []) as Array<{ organisation_id: string; status: DtGroundingRunStatus; created_at: string }>) {
    runsByOrg.set(r.organisation_id, [...(runsByOrg.get(r.organisation_id) ?? []), { status: r.status, createdAt: r.created_at }]);
  }

  const due: Array<SweepCandidate & { basis: number }> = [];
  for (const organisationId of orgIds) {
    const hub = hubByOrg.get(organisationId) ?? null;
    const verdict = shouldScheduleGroundingCheck({ hub, runs: runsByOrg.get(organisationId) ?? [], now });
    if (!verdict.schedule) continue;
    const basis = hub ? new Date(hub.lastReviewed ?? hub.uploadedAt ?? 0).getTime() : 0;
    due.push({ organisationId, reason: verdict.reason, basis });
  }
  return due
    .sort((a, b) => a.basis - b.basis)
    .slice(0, MAX_SCHEDULED_PER_SWEEP)
    .map(({ organisationId, reason }) => ({ organisationId, reason }));
}

export function scheduledRunAfter(index: number, now = new Date()): Date {
  return new Date(now.getTime() + index * STAGGER_MINUTES * 60_000);
}
