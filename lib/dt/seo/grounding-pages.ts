import type {
  DtGroundingPageKind,
  DtGroundingPageRow,
  DtGroundingReviewStatus,
} from "@/lib/dt/types";
import {
  evaluateGroundingPageSchedule,
  type GroundingPageSchedule,
  type GroundingPageStatus,
} from "@/lib/dt/seo/grounding-page-schedule";
import type { DtGroundingRunView } from "@/lib/dt/seo/grounding-run/store";

export const DT_GROUNDING_PAGE_SELECT =
  "id,organisation_id,kind,url,entity_name,slug,standard_version,review_status,uploaded_at,date_modified,last_reviewed,reviewed_by,notes,position,run_state,run_step,run_error,job_id,facts,questions,findings,run_notes,html,title,meta_description,entity_type,cost_eur,started_by,created_at,updated_at";

/** Standard version a page may claim once a human review is documented. */
export const GROUNDING_STANDARD_VERSION_REVIEWED = "1.7";
/** Standard version for drafts without a documented review. */
export const GROUNDING_STANDARD_VERSION_DRAFT = "1.6";

export type DtGroundingPageView = {
  id: string;
  organisationId: string;
  kind: DtGroundingPageKind;
  url: string;
  entityName: string | null;
  slug: string | null;
  standardVersion: string | null;
  reviewStatus: DtGroundingReviewStatus;
  uploadedAt: string | null;
  dateModified: string | null;
  lastReviewed: string | null;
  reviewedBy: string | null;
  notes: string | null;
  position: number;
  /** Page changed after the last documented review → neue Prüfung prüfen. */
  modifiedAfterReview: boolean;
  schedule: GroundingPageSchedule;
  /** Draft of the Grounding agent (steps, questions, HTML); null when not loaded. */
  run: DtGroundingRunView | null;
};

export type DtGroundingSummary = {
  /** Worst status across pages (overdue > due_soon > missing > ok). */
  status: GroundingPageStatus;
  statusLabel: string;
  total: number;
  hubs: number;
  entities: number;
  overdue: number;
  dueSoon: number;
  drafts: number;
  modifiedAfterReview: number;
};

const STATUS_SEVERITY: Record<GroundingPageStatus, number> = {
  overdue: 3,
  due_soon: 2,
  missing: 1,
  ok: 0,
};

function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function isModifiedAfterReview(
  row: Pick<DtGroundingPageRow, "date_modified" | "last_reviewed">,
): boolean {
  const modified = dayOf(row.date_modified);
  const reviewed = dayOf(row.last_reviewed);
  if (!modified || !reviewed) return false;
  return modified > reviewed;
}

export function serializeGroundingPage(
  row: DtGroundingPageRow,
  now?: string | Date,
  run: DtGroundingRunView | null = null,
): DtGroundingPageView {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    kind: row.kind,
    url: row.url,
    entityName: row.entity_name,
    slug: row.slug,
    standardVersion: row.standard_version,
    reviewStatus: row.review_status,
    uploadedAt: row.uploaded_at,
    dateModified: row.date_modified,
    lastReviewed: row.last_reviewed,
    reviewedBy: row.reviewed_by,
    notes: row.notes,
    position: row.position,
    modifiedAfterReview: isModifiedAfterReview(row),
    schedule: evaluateGroundingPageSchedule({
      lastReviewed: row.last_reviewed,
      uploadedAt: row.uploaded_at,
      now,
    }),
    run,
  };
}

/** Hub first, then entities by position / name. */
export function sortGroundingPages<T extends { kind: DtGroundingPageKind; position: number; entityName?: string | null; entity_name?: string | null; url: string }>(
  pages: T[],
): T[] {
  return [...pages].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "hub" ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    const an = (a.entityName ?? a.entity_name ?? a.url).toLowerCase();
    const bn = (b.entityName ?? b.entity_name ?? b.url).toLowerCase();
    return an.localeCompare(bn, "de");
  });
}

export function summarizeGroundingPages(pages: DtGroundingPageView[]): DtGroundingSummary {
  if (pages.length === 0) {
    return {
      status: "missing",
      statusLabel: "Noch keine Grounding Page erfasst",
      total: 0,
      hubs: 0,
      entities: 0,
      overdue: 0,
      dueSoon: 0,
      drafts: 0,
      modifiedAfterReview: 0,
    };
  }

  let worst: GroundingPageStatus = "ok";
  for (const page of pages) {
    if (STATUS_SEVERITY[page.schedule.status] > STATUS_SEVERITY[worst]) {
      worst = page.schedule.status;
    }
  }

  const overdue = pages.filter((p) => p.schedule.status === "overdue").length;
  const dueSoon = pages.filter((p) => p.schedule.status === "due_soon").length;
  const drafts = pages.filter((p) => p.reviewStatus !== "approved").length;
  const modifiedAfterReview = pages.filter((p) => p.modifiedAfterReview).length;
  const hubs = pages.filter((p) => p.kind === "hub").length;
  const entities = pages.length - hubs;

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  let statusLabel: string;
  if (worst === "overdue") {
    statusLabel = `${overdue} ${plural(overdue, "Seite", "Seiten")} überfällig`;
  } else if (worst === "due_soon") {
    statusLabel = `${dueSoon} ${plural(dueSoon, "Seite", "Seiten")} bald fällig`;
  } else if (worst === "missing") {
    statusLabel = "Mindestens eine Seite ohne Prüf- oder Upload-Datum";
  } else {
    statusLabel = `Alle ${pages.length} ${plural(pages.length, "Seite", "Seiten")} im Rhythmus`;
  }

  return {
    status: worst,
    statusLabel,
    total: pages.length,
    hubs,
    entities,
    overdue,
    dueSoon,
    drafts,
    modifiedAfterReview,
  };
}

function fmtDay(iso: string | null): string {
  return dayOf(iso) ?? "—";
}

function statusWord(status: GroundingPageStatus): string {
  if (status === "overdue") return "überfällig";
  if (status === "due_soon") return "Frühwarnung";
  if (status === "missing") return "kein Datum";
  return "aktuell";
}

/**
 * "Tool-Kontext" block for the Grounding tool prompt (§TOOL-KONTEXT):
 * Hub-URL, Entitätsseiten, llms.txt, je Seite Upload/dateModified/lastReviewed/Prüfer, Status, Notizen.
 */
export function formatGroundingPagesForPrompt(input: {
  pages: DtGroundingPageView[];
  llmsTxtUrl?: string | null;
  websiteUrl?: string | null;
}): string {
  const pages = sortGroundingPages(input.pages);
  const hub = pages.find((p) => p.kind === "hub") ?? null;
  const entities = pages.filter((p) => p.kind !== "hub");
  const summary = summarizeGroundingPages(pages);

  const lines: string[] = ["## Grounding Pages (Tool-Kontext)"];

  if (pages.length === 0) {
    lines.push(
      "Im Tool ist noch keine Grounding Page für diese Domain erfasst.",
      "Prüfe vor einem Neubau den Footer-Link der Website (neben Impressum/Datenschutz) und den Standardpfad /grounding/. Gibt es dort eine Grounding Page, ist jeder Auftrag ein „aktualisiere“, kein Neubau.",
    );
    if (input.llmsTxtUrl) lines.push(`- llms.txt-URL: ${input.llmsTxtUrl}`);
    lines.push(
      "Entwurf erstellen: Nach Bestätigung des Nutzers start_grounding_draft mit kind \"hub\" und der geplanten URL (Standard: <Website>/grounding/) aufrufen; der Agent sammelt Fakten, prüft sie, baut die Seite und prüft sie noch einmal.",
    );
    return lines.join("\n");
  }

  lines.push(`- Grounding-URL des Hubs: ${hub ? hub.url : "nicht erfasst"}`);
  lines.push(
    `- Entitätsseiten: ${entities.length > 0 ? entities.map((e) => e.url).join(", ") : "keine erfasst"}`,
  );
  lines.push(`- llms.txt-URL: ${input.llmsTxtUrl ?? "nicht erfasst"}`);
  lines.push(`- Gesamtstatus: ${summary.statusLabel}`);
  lines.push("");
  lines.push("### Seiten");

  for (const page of pages) {
    const name =
      page.kind === "hub"
        ? "Hub (Haupt-Grounding-Page)"
        : `Entitätsseite „${page.entityName ?? page.slug ?? page.url}“`;
    const parts = [
      `URL ${page.url}`,
      `hochgeladen ${fmtDay(page.uploadedAt)}`,
      `dateModified ${fmtDay(page.dateModified)}`,
      `lastReviewed ${fmtDay(page.lastReviewed)}`,
      `Prüfer ${page.reviewedBy ?? "—"}`,
      `Standard v${page.standardVersion ?? "?"}`,
      page.reviewStatus === "approved" ? "freigegeben" : "Entwurf (Prüfung ausstehend)",
      `Status ${statusWord(page.schedule.status)}` +
        (page.schedule.nextDueAt ? ` (fällig ${fmtDay(page.schedule.nextDueAt)})` : ""),
    ];
    lines.push(`- ${name}: ${parts.join(" · ")}`);
    if (page.modifiedAfterReview) {
      lines.push(
        `  Befund: Seite nach der letzten Prüfung geändert (dateModified ${fmtDay(page.dateModified)} > lastReviewed ${fmtDay(page.lastReviewed)}) — bei substanzieller Änderung neue Prüfung nötig.`,
      );
    }
    if (page.schedule.basis === "uploaded_at") {
      lines.push("  Hinweis: keine menschliche Prüfung dokumentiert — Fälligkeit vorläufig nach Upload-Datum.");
    }
    if (page.notes?.trim()) {
      lines.push(`  Notiz: ${page.notes.trim().replace(/\s+/g, " ").slice(0, 400)}`);
    }
    for (const line of formatGroundingRunForPrompt(page.run)) lines.push(`  ${line}`);
  }

  lines.push("");
  lines.push("### Regeln");
  lines.push(
    "- Entwürfe baut der Grounding-Agent im Hintergrund: mit start_grounding_draft starten (nach Bestätigung des Nutzers), Antworten auf Faktencheck-Fragen mit answer_grounding_draft weitergeben. Den Stand liest du oben je Seite unter „Entwurf“.",
    "- Bestehende URLs haben Vorrang vor der Standard-URL /grounding/. Bestehende Grounding Pages werden nicht auf eine neue URL umgezogen.",
    "- Es gibt bereits eine Grounding Page: jeder Auftrag ist ein „aktualisiere“, kein Neubau (außer der Nutzer verlangt ausdrücklich einen Neubau).",
    "- Die Fälligkeit richtet sich nach lastReviewed (letzte menschliche Prüfung), nicht nach dem Upload-Datum oder dateModified.",
    "- Fehlen Datumswerte im Tool, lies sie von der Live-Seite in dieser Reihenfolge: JSON-LD lastReviewed, JSON-LD dateModified, sichtbarer Prüfhinweis, Meta-Tags, HTTP-Header Last-Modified. Nenne die Quelle.",
    "- Weichen Tool-Daten, Live-Seite und llms.txt voneinander ab, melde das als Befund.",
    "- Rückgabe an das Tool: nutze am Ende das Werkzeug update_grounding_page je Seite (URL, Status Entwurf/freigegeben, dateModified, lastReviewed und Prüfer nur nach dokumentierter Freigabe, Standardversion).",
  );
  if (summary.status === "overdue" || summary.status === "due_soon") {
    lines.push(
      `- Status ist „${statusWord(summary.status)}“: weise zu Beginn darauf hin und schlage „aktualisiere“ vor.`,
    );
  }

  return lines.join("\n");
}

/** The draft state of one page for the Tool-Kontext (empty when no run view was loaded). */
export function formatGroundingRunForPrompt(run: DtGroundingRunView | null): string[] {
  if (!run) return [];
  const lines: string[] = [];
  if (run.state === "nicht_begonnen") {
    lines.push("Entwurf: noch nicht gestartet.");
    return lines;
  }
  lines.push(`Entwurf: ${run.label}${run.detail ? ` — ${run.detail}` : ""}`);
  if (run.state === "braucht_sie" && run.questions.length > 0) {
    lines.push("Fragen des Faktenchecks (nur der Nutzer kann sie beantworten; Antworten mit answer_grounding_draft weitergeben):");
    run.questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}${q.placeholder ? ` (z. B. ${q.placeholder})` : ""}`));
  }
  if (run.state === "fertig") {
    lines.push("HTML-Datei und llms.txt liegen im Tab Grounding zum Download.");
    if (run.summary) lines.push(`Endprüfung: ${run.summary.replace(/\s+/g, " ").slice(0, 600)}`);
    const high = run.findings.filter((f) => f.severity === "high");
    if (high.length > 0) lines.push(`Vor der Freigabe klären: ${high.map((f) => f.title).join("; ")}`);
  }
  if (run.facts?.candidates.length) {
    lines.push(
      `Vorgeschlagene Entitätsseiten: ${run.facts.candidates
        .map((c) => `${c.name} (${c.schema_type}, ${c.priority}${c.url ? `, ${c.url}` : ""})`)
        .join("; ")}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Write helpers (pure) — shared by the API routes and the chat tool.
// ---------------------------------------------------------------------------

export type DtGroundingPagePatch = {
  kind?: DtGroundingPageKind;
  url?: string;
  entityName?: string | null;
  slug?: string | null;
  standardVersion?: string | null;
  reviewStatus?: DtGroundingReviewStatus;
  uploadedAt?: string | null;
  dateModified?: string | null;
  lastReviewed?: string | null;
  reviewedBy?: string | null;
  notes?: string | null;
  position?: number;
};

export type DtGroundingPageUpdateResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; message: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Homepage (`https://example.de/`): never a grounding page, whatever a redirect says. */
function isGroundingSiteRootUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "/" || u.pathname === "") && !u.search;
  } catch {
    return false;
  }
}

/** Accepts ISO datetime or YYYY-MM-DD; returns ISO or null. Undefined = untouched. */
export function normalizeGroundingDate(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const iso = DAY_RE.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function normalizeStandardVersion(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/(\d+\.\d+)/);
  return m ? m[1]! : undefined;
}

function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const [a1, a2] = version.split(".").map(Number);
  const [b1, b2] = min.split(".").map(Number);
  if (a1 !== b1) return (a1 ?? 0) > (b1 ?? 0);
  return (a2 ?? 0) >= (b2 ?? 0);
}

/**
 * Build the DB update for a page patch and apply the Standard-v1.7 review rules:
 * - lastReviewed is never in the future;
 * - lastReviewed + reviewedBy ⇒ review_status "approved" and standard_version ≥ 1.7;
 * - lastReviewed cleared ⇒ review_status "draft".
 */
export function buildGroundingPageUpdate(
  patch: DtGroundingPagePatch,
  existing: Partial<DtGroundingPageRow> | null,
  now: Date = new Date(),
): DtGroundingPageUpdateResult {
  const update: Record<string, unknown> = {};

  if (patch.kind !== undefined) update.kind = patch.kind;
  if (patch.url !== undefined) {
    const url = patch.url.trim();
    if (!/^https?:\/\//i.test(url) || url.length < 8 || url.length > 2000) {
      return { ok: false, message: "URL ungültig (http/https, max. 2000 Zeichen)." };
    }
    if (isGroundingSiteRootUrl(url)) {
      return {
        ok: false,
        message:
          "Die Startseite ist keine Grounding Page. Bitte die URL der eigentlichen Grounding Page eintragen (z. B. …/grounding/ oder …/fakten/).",
      };
    }
    update.url = url;
  }
  if (patch.entityName !== undefined) {
    update.entity_name = patch.entityName?.trim().slice(0, 200) || null;
  }
  if (patch.slug !== undefined) {
    update.slug = patch.slug?.trim().toLowerCase().slice(0, 120) || null;
  }
  if (patch.notes !== undefined) {
    update.notes = patch.notes?.trim().slice(0, 4000) || null;
  }
  if (patch.position !== undefined) {
    update.position = Math.max(0, Math.round(patch.position));
  }

  for (const [key, column] of [
    ["uploadedAt", "uploaded_at"],
    ["dateModified", "date_modified"],
    ["lastReviewed", "last_reviewed"],
  ] as const) {
    const value = normalizeGroundingDate(patch[key]);
    if (patch[key] !== undefined && value === undefined) {
      return { ok: false, message: `Datum für ${key} ungültig.` };
    }
    if (value !== undefined) update[column] = value;
  }

  if (patch.reviewedBy !== undefined) {
    update.reviewed_by = patch.reviewedBy?.trim().slice(0, 200) || null;
  }

  const version = normalizeStandardVersion(patch.standardVersion);
  if (patch.standardVersion !== undefined && version === undefined) {
    return { ok: false, message: "Standardversion ungültig (z. B. 1.7)." };
  }
  if (version !== undefined) update.standard_version = version;

  if (patch.reviewStatus !== undefined) update.review_status = patch.reviewStatus;

  const effective = {
    last_reviewed:
      (update.last_reviewed as string | null | undefined) ?? existing?.last_reviewed ?? null,
    reviewed_by:
      (update.reviewed_by as string | null | undefined) ?? existing?.reviewed_by ?? null,
    standard_version:
      (update.standard_version as string | null | undefined) ??
      existing?.standard_version ??
      null,
  };
  if ("last_reviewed" in update && update.last_reviewed === null) effective.last_reviewed = null;
  if ("reviewed_by" in update && update.reviewed_by === null) effective.reviewed_by = null;

  if (effective.last_reviewed) {
    const reviewed = new Date(effective.last_reviewed);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    if (reviewed.getTime() > today.getTime()) {
      return {
        ok: false,
        message: "lastReviewed darf nicht in der Zukunft liegen (tatsächliches Prüfdatum eintragen).",
      };
    }
  }

  const touchesReview =
    patch.lastReviewed !== undefined ||
    patch.reviewedBy !== undefined ||
    patch.reviewStatus !== undefined;
  if (touchesReview && patch.reviewStatus === undefined) {
    if (effective.last_reviewed && effective.reviewed_by) {
      update.review_status = "approved";
      if (!versionAtLeast(effective.standard_version, GROUNDING_STANDARD_VERSION_REVIEWED)) {
        update.standard_version = GROUNDING_STANDARD_VERSION_REVIEWED;
      }
    } else if (!effective.last_reviewed) {
      update.review_status = "draft";
    }
  }
  if (update.review_status === "approved" && (!effective.last_reviewed || !effective.reviewed_by)) {
    return {
      ok: false,
      message: "Freigabe braucht Prüfer und Prüfdatum (reviewedBy + lastReviewed).",
    };
  }

  return { ok: true, update };
}

export type GroundingLiveFactsInput = {
  finalUrl?: string | null;
  detectedAt: string;
  sourceLabel: string;
  facts: {
    lastReviewed: string | null;
    reviewedBy: string | null;
    dateModified: string | null;
    standardVersion: string | null;
    reviewMismatch: boolean;
  };
};

/**
 * Translate a live detection into a page patch: dates only overwrite when found;
 * uploadedAt is filled once (first detection) and never moved by later reads.
 */
export function patchFromLiveFacts(
  existing: Partial<DtGroundingPageRow> | null,
  detection: GroundingLiveFactsInput,
  today: string = new Date().toISOString().slice(0, 10),
): DtGroundingPagePatch {
  const patch: DtGroundingPagePatch = {};
  if (detection.finalUrl && detection.finalUrl !== existing?.url) patch.url = detection.finalUrl;
  if (!existing?.uploaded_at) patch.uploadedAt = detection.detectedAt;
  if (detection.facts.dateModified) patch.dateModified = detection.facts.dateModified;
  if (detection.facts.lastReviewed) patch.lastReviewed = detection.facts.lastReviewed;
  if (detection.facts.reviewedBy) patch.reviewedBy = detection.facts.reviewedBy;
  if (detection.facts.standardVersion) patch.standardVersion = detection.facts.standardVersion;

  const autoLine =
    `Auto: ${detection.sourceLabel} (${today})` +
    (detection.facts.reviewMismatch
      ? " · Befund: sichtbarer Prüfhinweis und JSON-LD weichen ab"
      : "");
  const prevNotes = (existing?.notes ?? "").trim();
  patch.notes = prevNotes.includes("Auto:")
    ? prevNotes.replace(/^Auto:.*$/m, autoLine).trim()
    : [prevNotes, autoLine].filter(Boolean).join("\n");
  return patch;
}
