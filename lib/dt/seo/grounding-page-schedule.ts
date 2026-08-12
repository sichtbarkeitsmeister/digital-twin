export const GROUNDING_PAGE_INTERVAL_MONTHS = 3;
export const GROUNDING_PAGE_WARN_DAYS = 14;

export type GroundingPageStatus = "missing" | "ok" | "due_soon" | "overdue";

export type GroundingPageSchedule = {
  uploadedAt: string | null;
  nextDueAt: string | null;
  warnAt: string | null;
  daysUntilDue: number | null;
  status: GroundingPageStatus;
  statusLabel: string;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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

function statusLabelFor(status: GroundingPageStatus, daysUntilDue: number | null): string {
  if (status === "missing") return "Noch kein Upload erfasst";
  if (status === "overdue") {
    const days = daysUntilDue == null ? 0 : Math.abs(daysUntilDue);
    return days === 0
      ? "Aktualisierung überfällig"
      : `Aktualisierung überfällig (${days} Tag${days === 1 ? "" : "e"})`;
  }
  if (status === "due_soon") {
    const days = daysUntilDue ?? 0;
    if (days === 0) return "Aktualisierung heute fällig";
    return `Aktualisierung in ${days} Tag${days === 1 ? "" : "en"} fällig`;
  }
  const days = daysUntilDue ?? 0;
  return `Aktuell · nächste Aktualisierung in ${days} Tagen`;
}

/**
 * Derive due dates for a grounding page upload.
 * Cadence: every 3 months; warn starting 14 days before due.
 */
export function evaluateGroundingPageSchedule(input: {
  uploadedAt?: string | null;
  /** Override “today” for tests (ISO or Date). */
  now?: string | Date;
}): GroundingPageSchedule {
  const uploadedRaw = input.uploadedAt?.trim() || null;
  if (!uploadedRaw) {
    return {
      uploadedAt: null,
      nextDueAt: null,
      warnAt: null,
      daysUntilDue: null,
      status: "missing",
      statusLabel: statusLabelFor("missing", null),
    };
  }

  const uploaded = new Date(uploadedRaw);
  if (Number.isNaN(uploaded.getTime())) {
    return {
      uploadedAt: null,
      nextDueAt: null,
      warnAt: null,
      daysUntilDue: null,
      status: "missing",
      statusLabel: statusLabelFor("missing", null),
    };
  }

  const nextDue = addUtcMonths(uploaded, GROUNDING_PAGE_INTERVAL_MONTHS);
  const warnAt = new Date(nextDue);
  warnAt.setUTCDate(warnAt.getUTCDate() - GROUNDING_PAGE_WARN_DAYS);

  const now = startOfUtcDay(
    input.now ? new Date(input.now) : new Date(),
  );
  const dueDay = startOfUtcDay(nextDue);
  const daysUntilDue = Math.round(
    (dueDay.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  let status: GroundingPageStatus = "ok";
  if (daysUntilDue < 0) status = "overdue";
  else if (daysUntilDue <= GROUNDING_PAGE_WARN_DAYS) status = "due_soon";

  return {
    uploadedAt: uploaded.toISOString(),
    nextDueAt: nextDue.toISOString(),
    warnAt: warnAt.toISOString(),
    daysUntilDue,
    status,
    statusLabel: statusLabelFor(status, daysUntilDue),
  };
}
