/**
 * dt_grounding_design (migration 20261105_dt_grounding_design.sql): load, save, detect.
 * Readers never fail because of the design: without the table or a row every Grounding Page
 * keeps the neutral template.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { detectGroundingDesign } from "@/lib/dt/seo/grounding-design/detect";
import type { DesignExtractionReport } from "@/lib/dt/seo/grounding-design/extract";
import {
  type GroundingDesignRecord,
  type ResolvedDesign,
  applyDetection,
  resolveGroundingDesign,
  sanitizeDesignValues,
  sanitizeDetectedDesign,
} from "@/lib/dt/seo/grounding-design/profile";

export const GROUNDING_DESIGN_MIGRATION_FILE = "database/migrations/20261105_dt_grounding_design.sql";

const COLUMNS = "organisation_id, enabled, detected, manual, detected_at, detected_from_url, detection_report, updated_at";

export function isMissingGroundingDesignTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || (/dt_grounding_design/.test(message) && /does not exist|schema cache|could not find/i.test(message));
}

export function groundingDesignDbErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (isMissingGroundingDesignTable(error)) {
    return `Die Datenbank ist noch nicht vorbereitet: Bitte ${GROUNDING_DESIGN_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin nutzen alle Grounding Pages das neutrale Design.`;
  }
  return `${fallback}: ${error.message ?? "Unbekannter Fehler"}`;
}

type Row = {
  organisation_id: string;
  enabled: boolean | null;
  detected: unknown;
  manual: unknown;
  detected_at: string | null;
  detected_from_url: string | null;
  detection_report: unknown;
  updated_at: string | null;
};

export function recordFromRow(row: Row | null): GroundingDesignRecord | null {
  if (!row) return null;
  return {
    enabled: row.enabled !== false,
    detected: sanitizeDetectedDesign(row.detected),
    manual: sanitizeDesignValues(row.manual),
    detectedAt: row.detected_at,
    detectedFromUrl: row.detected_from_url,
  };
}

export type LoadedDesign = {
  record: GroundingDesignRecord | null;
  report: DesignExtractionReport | null;
  migrationMissing: boolean;
  error: string | null;
};

export async function loadGroundingDesign(service: SupabaseClient, organisationId: string): Promise<LoadedDesign> {
  const { data, error } = await service.from("dt_grounding_design").select(COLUMNS).eq("organisation_id", organisationId).maybeSingle();
  if (error) {
    return {
      record: null,
      report: null,
      migrationMissing: isMissingGroundingDesignTable(error),
      error: groundingDesignDbErrorMessage(error, "Design konnte nicht geladen werden"),
    };
  }
  const row = (data as Row | null) ?? null;
  const report = row?.detection_report && typeof row.detection_report === "object" ? (row.detection_report as DesignExtractionReport) : null;
  return { record: recordFromRow(row), report, migrationMissing: false, error: null };
}

/** The design to render for an organisation; null (neutral template) on any problem. */
export async function loadResolvedGroundingDesign(service: SupabaseClient, organisationId: string): Promise<ResolvedDesign | null> {
  try {
    const loaded = await loadGroundingDesign(service, organisationId);
    if (loaded.error && !loaded.migrationMissing) console.warn("[grounding-design] load:", loaded.error);
    return resolveGroundingDesign(loaded.record);
  } catch (error) {
    console.warn("[grounding-design] load:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function saveGroundingDesign(
  service: SupabaseClient,
  organisationId: string,
  record: GroundingDesignRecord,
  extra: { userId?: string | null; report?: DesignExtractionReport | null } = {},
): Promise<{ ok: true } | { ok: false; message: string; migrationMissing: boolean }> {
  const row: Record<string, unknown> = {
    organisation_id: organisationId,
    enabled: record.enabled,
    detected: record.detected,
    manual: record.manual,
    detected_at: record.detectedAt,
    detected_from_url: record.detectedFromUrl,
  };
  if (extra.userId !== undefined) row.updated_by = extra.userId;
  if (extra.report !== undefined) row.detection_report = extra.report;
  const { error } = await service.from("dt_grounding_design").upsert(row, { onConflict: "organisation_id" });
  if (error) {
    return { ok: false, message: groundingDesignDbErrorMessage(error, "Design konnte nicht gespeichert werden"), migrationMissing: isMissingGroundingDesignTable(error) };
  }
  return { ok: true };
}

export type DetectAndStoreResult =
  | { ok: true; record: GroundingDesignRecord; report: DesignExtractionReport }
  | { ok: false; message: string; migrationMissing: boolean };

/**
 * Detect the website's design and store it as the detected layer. Manual values are kept;
 * `enable` switches the website design back on („Design neu erkennen“).
 */
export async function detectAndStoreGroundingDesign(
  service: SupabaseClient,
  input: {
    organisationId: string;
    websiteUrl: string;
    home?: { url: string; html: string } | null;
    deadline?: number;
    userId?: string | null;
    enable?: boolean;
    now?: Date;
  },
): Promise<DetectAndStoreResult> {
  const loaded = await loadGroundingDesign(service, input.organisationId);
  if (loaded.migrationMissing) return { ok: false, message: loaded.error ?? "", migrationMissing: true };
  if (loaded.error) return { ok: false, message: loaded.error, migrationMissing: false };
  const detection = await detectGroundingDesign({ websiteUrl: input.websiteUrl, home: input.home, deadline: input.deadline });
  if (!detection.ok) return { ok: false, message: detection.message, migrationMissing: false };
  const record = applyDetection(loaded.record, detection.design, {
    url: detection.pageUrl,
    at: (input.now ?? new Date()).toISOString(),
    enable: input.enable,
  });
  const saved = await saveGroundingDesign(service, input.organisationId, record, { userId: input.userId, report: detection.report });
  if (!saved.ok) return saved;
  return { ok: true, record, report: detection.report };
}
