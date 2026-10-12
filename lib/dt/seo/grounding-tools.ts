import { createServiceClient } from "@/lib/supabase/service";
import {
  DT_GROUNDING_PAGE_SELECT,
  buildGroundingPageUpdate,
  serializeGroundingPage,
  type DtGroundingPagePatch,
} from "@/lib/dt/seo/grounding-pages";
import type { DtGroundingPageRow } from "@/lib/dt/types";

export type DtGroundingPageToolInput = {
  url: string;
  kind?: "hub" | "entity";
  entityName?: string | null;
  slug?: string | null;
  status?: "draft" | "approved" | "Entwurf" | "freigegeben";
  dateModified?: string | null;
  lastReviewed?: string | null;
  reviewedBy?: string | null;
  standardVersion?: string | null;
  uploadedAt?: string | null;
  note?: string | null;
};

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

/**
 * "Rückgabe an das Tool": the GEO agent reports a page's state (URL, status,
 * dateModified, lastReviewed, reviewer, standard version). Upserts by URL.
 * lastReviewed/reviewedBy only count once the user documented the approval.
 */
export async function updateGroundingPageForTool(
  organisationId: string,
  input: DtGroundingPageToolInput,
): Promise<string> {
  const url = normalizeUrl(String(input.url ?? ""));
  if (!url) return "url fehlt oder ist ungültig (http/https).";

  const supabase = createServiceClient();
  const { data: rows, error: loadError } = await supabase
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("organisation_id", organisationId);
  if (loadError) return `Fehler beim Laden: ${loadError.message}`;

  const pages = (rows ?? []) as DtGroundingPageRow[];
  const stripSlash = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const existing =
    pages.find((p) => stripSlash(p.url) === stripSlash(url)) ?? null;
  const hasHub = pages.some((p) => p.kind === "hub");

  const status =
    input.status === "approved" || input.status === "freigegeben"
      ? ("approved" as const)
      : input.status === "draft" || input.status === "Entwurf"
        ? ("draft" as const)
        : undefined;

  const patch: DtGroundingPagePatch = {
    url,
    entityName: input.entityName ?? undefined,
    slug: input.slug ?? undefined,
    dateModified: input.dateModified ?? undefined,
    lastReviewed: input.lastReviewed ?? undefined,
    reviewedBy: input.reviewedBy ?? undefined,
    standardVersion: input.standardVersion ?? undefined,
    uploadedAt: input.uploadedAt ?? undefined,
  };
  if (status === "draft") {
    // Draft: a page without documented review never carries review data.
    patch.reviewStatus = "draft";
    patch.lastReviewed = null;
    patch.reviewedBy = null;
  } else if (status === "approved") {
    patch.reviewStatus = "approved";
  }
  if (input.note?.trim()) {
    const prev = (existing?.notes ?? "").trim();
    const line = `Agent (${new Date().toISOString().slice(0, 10)}): ${input.note.trim()}`;
    patch.notes = prev ? `${prev}\n${line}` : line;
  }
  if (!existing) {
    patch.kind = input.kind ?? (hasHub ? "entity" : "hub");
    if (patch.kind === "hub" && hasHub) {
      return "Es gibt bereits einen Hub für diese Organisation. Entitätsseiten mit kind \"entity\" melden.";
    }
  } else if (input.kind && input.kind !== existing.kind) {
    if (input.kind === "hub" && hasHub) {
      return "Es gibt bereits einen Hub. Die Art einer bestehenden Seite kann nicht auf hub geändert werden.";
    }
    patch.kind = input.kind;
  }

  const built = buildGroundingPageUpdate(patch, existing);
  if (!built.ok) return built.message;

  const query = existing
    ? supabase.from("dt_grounding_pages").update(built.update).eq("id", existing.id)
    : supabase.from("dt_grounding_pages").insert({
        organisation_id: organisationId,
        position: pages.length,
        ...built.update,
      });
  const { data, error } = await query.select(DT_GROUNDING_PAGE_SELECT).maybeSingle();
  if (error || !data) return `Speichern fehlgeschlagen: ${error?.message ?? "unbekannt"}`;

  const view = serializeGroundingPage(data as DtGroundingPageRow);
  return [
    existing ? "Grounding Page im Tool aktualisiert." : "Grounding Page im Tool angelegt.",
    `URL: ${view.url}`,
    `Art: ${view.kind === "hub" ? "Hub" : `Entitätsseite${view.entityName ? ` „${view.entityName}“` : ""}`}`,
    `Status: ${view.reviewStatus === "approved" ? "freigegeben" : "Entwurf"} · Standard v${view.standardVersion ?? "?"}`,
    `dateModified: ${dayOf(view.dateModified)} · lastReviewed: ${dayOf(view.lastReviewed)} · Prüfer: ${view.reviewedBy ?? "—"}`,
    `Nächste Fälligkeit: ${dayOf(view.schedule.nextDueAt)} (${view.schedule.basisLabel})`,
  ].join("\n");
}
