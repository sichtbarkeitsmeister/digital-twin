export const GROUNDING_PAGE_INTERVAL_MONTHS = 3;
export const GROUNDING_PAGE_WARN_DAYS = 14;

/** missing: no page. review_missing: page known, but no human lastReviewed. */
export type GroundingPageStatus =
  | "missing"
  | "review_missing"
  | "ok"
  | "due_soon"
  | "overdue";

/** Words passed to the grounding agent. Due dates follow lastReviewed only. */
export type GroundingToolStatus =
  | "aktuell"
  | "Frühwarnung"
  | "überfällig"
  | "Prüfung offen"
  | "nicht erfasst";

export type GroundingPageSchedule = {
  uploadedAt: string | null;
  lastReviewed: string | null;
  /** last_reviewed drives the due date. Upload alone never does. */
  basis: "last_reviewed" | "none";
  nextDueAt: string | null;
  warnAt: string | null;
  daysUntilDue: number | null;
  status: GroundingPageStatus;
  statusLabel: string;
  toolStatus: GroundingToolStatus;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseIso(raw: string | null | undefined): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Add calendar months in UTC, clamping end-of-month overflow. */
export function addUtcMonths(isoOrDate: string | Date, months: number): Date {
  const base = typeof isoOrDate === "string" ? new Date(isoOrDate) : new Date(isoOrDate);
  if (Number.isNaN(base.getTime())) {
    throw new Error("Invalid date");
  }
  const day = base.getUTCDate();
  const result = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  result.setUTCHours(
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds(),
  );
  return result;
}

function toolStatusFor(status: GroundingPageStatus): GroundingToolStatus {
  if (status === "ok") return "aktuell";
  if (status === "due_soon") return "Frühwarnung";
  if (status === "overdue") return "überfällig";
  if (status === "review_missing") return "Prüfung offen";
  return "nicht erfasst";
}

function statusLabelFor(status: GroundingPageStatus, daysUntilDue: number | null): string {
  if (status === "missing") return "Noch nicht erfasst";
  if (status === "review_missing") {
    return "Prüfung offen — die Fälligkeit richtet sich nach der letzten menschlichen Prüfung";
  }
  if (status === "overdue") {
    const days = daysUntilDue == null ? 0 : Math.abs(daysUntilDue);
    return days === 0
      ? "Überfällig"
      : `Überfällig (${days} Tag${days === 1 ? "" : "e"})`;
  }
  if (status === "due_soon") {
    const days = daysUntilDue ?? 0;
    if (days === 0) return "Frühwarnung · Prüfung heute fällig";
    return `Frühwarnung · Prüfung in ${days} Tag${days === 1 ? "" : "en"} fällig`;
  }
  const days = daysUntilDue ?? 0;
  return `Aktuell · nächste Prüfung in ${days} Tagen`;
}

function emptySchedule(
  status: "missing" | "review_missing",
  uploadedAt: string | null,
): GroundingPageSchedule {
  return {
    uploadedAt,
    lastReviewed: null,
    basis: "none",
    nextDueAt: null,
    warnAt: null,
    daysUntilDue: null,
    status,
    statusLabel: statusLabelFor(status, null),
    toolStatus: toolStatusFor(status),
  };
}

/**
 * Due date for a grounding page.
 * Cadence: every 3 months after lastReviewed; warn starting 14 days before due.
 * An upload date without a human review does not start the cadence.
 */
export function evaluateGroundingPageSchedule(input: {
  uploadedAt?: string | null;
  lastReviewed?: string | null;
  /** Override “today” for tests (ISO or Date). */
  now?: string | Date;
}): GroundingPageSchedule {
  const uploaded = parseIso(input.uploadedAt);
  const reviewed = parseIso(input.lastReviewed);
  const uploadedAt = uploaded ? uploaded.toISOString() : null;

  if (!reviewed) {
    return emptySchedule(uploaded ? "review_missing" : "missing", uploadedAt);
  }

  const nextDue = addUtcMonths(reviewed, GROUNDING_PAGE_INTERVAL_MONTHS);
  const warnAt = new Date(nextDue);
  warnAt.setUTCDate(warnAt.getUTCDate() - GROUNDING_PAGE_WARN_DAYS);

  const now = startOfUtcDay(input.now ? new Date(input.now) : new Date());
  const dueDay = startOfUtcDay(nextDue);
  const daysUntilDue = Math.round(
    (dueDay.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  let status: GroundingPageStatus = "ok";
  if (daysUntilDue < 0) status = "overdue";
  else if (daysUntilDue <= GROUNDING_PAGE_WARN_DAYS) status = "due_soon";

  return {
    uploadedAt,
    lastReviewed: reviewed.toISOString(),
    basis: "last_reviewed",
    nextDueAt: nextDue.toISOString(),
    warnAt: warnAt.toISOString(),
    daysUntilDue,
    status,
    statusLabel: statusLabelFor(status, daysUntilDue),
    toolStatus: toolStatusFor(status),
  };
}
