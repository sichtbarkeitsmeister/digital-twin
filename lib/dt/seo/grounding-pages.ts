import {
  evaluateGroundingPageSchedule,
  type GroundingPageSchedule,
} from "@/lib/dt/seo/grounding-page-schedule";

export const GROUNDING_CONFIG_SELECT =
  "organisation_id,website_url,grounding_page_url,grounding_page_uploaded_at,grounding_page_date_modified,grounding_page_last_reviewed,grounding_page_reviewed_by,grounding_page_release_status,grounding_page_standard_version,grounding_customer_slug,grounding_page_notes,grounding_llms_txt_url,grounding_entity_pages";

export const GROUNDING_ENTITY_PAGE_LIMIT = 30;

export type GroundingReleaseStatus = "draft" | "released";

export type GroundingCommand = "erstelle" | "pruefe" | "aktualisiere";

export type GroundingEntityPage = {
  id: string;
  slug: string;
  title: string;
  url: string | null;
  uploadedAt: string | null;
  dateModified: string | null;
  lastReviewed: string | null;
  reviewedBy: string | null;
  notes: string | null;
  releaseStatus: GroundingReleaseStatus | null;
  standardVersion: string | null;
};

export type GroundingConfigRow = {
  organisation_id: string;
  website_url?: string | null;
  grounding_page_url: string | null;
  grounding_page_uploaded_at: string | null;
  grounding_page_date_modified?: string | null;
  grounding_page_last_reviewed?: string | null;
  grounding_page_reviewed_by?: string | null;
  grounding_page_release_status?: string | null;
  grounding_page_standard_version?: string | null;
  grounding_customer_slug?: string | null;
  grounding_page_notes: string | null;
  grounding_llms_txt_url?: string | null;
  grounding_entity_pages?: unknown;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function slugifyGroundingName(raw: string): string {
  const mapped = raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  return mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isGroundingSlug(value: string): boolean {
  return SLUG_RE.test(value) && value.length <= 80;
}

export function groundingDomainFromWebsite(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asRelease(value: unknown): GroundingReleaseStatus | null {
  if (value === "draft" || value === "released") return value;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Drop broken rows. Keeps stored pages readable even if one entry is incomplete. */
export function parseGroundingEntityPages(raw: unknown): GroundingEntityPage[] {
  if (!Array.isArray(raw)) return [];
  const pages: GroundingEntityPage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const slug = asText(rec.slug, 80);
    const title = asText(rec.title, 160);
    if (!slug || !title || !isGroundingSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const id = asText(rec.id, 80);
    pages.push({
      id: id && UUID_RE.test(id) ? id : slug,
      slug,
      title,
      url: asText(rec.url, 2000),
      uploadedAt: asIso(rec.uploadedAt),
      dateModified: asIso(rec.dateModified),
      lastReviewed: asIso(rec.lastReviewed),
      reviewedBy: asText(rec.reviewedBy, 160),
      notes: asText(rec.notes, 2000),
      releaseStatus: asRelease(rec.releaseStatus),
      standardVersion: asText(rec.standardVersion, 40),
    });
    if (pages.length >= GROUNDING_ENTITY_PAGE_LIMIT) break;
  }
  return pages;
}

export function validateGroundingEntityPages(
  raw: unknown,
): { ok: true; pages: GroundingEntityPage[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Entitätsseiten müssen eine Liste sein." };
  }
  if (raw.length > GROUNDING_ENTITY_PAGE_LIMIT) {
    return {
      ok: false,
      message: `Höchstens ${GROUNDING_ENTITY_PAGE_LIMIT} Entitätsseiten.`,
    };
  }
  const pages: GroundingEntityPage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) return { ok: false, message: "Eine Entitätsseite ist ungültig." };
    const title = asText(rec.title, 160);
    const slugRaw = asText(rec.slug, 80) ?? (title ? slugifyGroundingName(title) : "");
    if (!title) return { ok: false, message: "Jede Entitätsseite braucht einen Titel." };
    if (!slugRaw || !isGroundingSlug(slugRaw)) {
      return {
        ok: false,
        message: `Slug „${slugRaw || title}“ ist ungültig. Nur Kleinbuchstaben, Ziffern und Bindestriche.`,
      };
    }
    if (seen.has(slugRaw)) {
      return { ok: false, message: `Slug „${slugRaw}“ ist doppelt.` };
    }
    seen.add(slugRaw);
    const url = asText(rec.url, 2000);
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, message: `URL von „${title}“ muss mit http:// oder https:// beginnen.` };
    }
    const id = asText(rec.id, 80);
    pages.push({
      id: id && UUID_RE.test(id) ? id : crypto.randomUUID(),
      slug: slugRaw,
      title,
      url,
      uploadedAt: asIso(rec.uploadedAt),
      dateModified: asIso(rec.dateModified),
      lastReviewed: asIso(rec.lastReviewed),
      reviewedBy: asText(rec.reviewedBy, 160),
      notes: asText(rec.notes, 2000),
      releaseStatus: asRelease(rec.releaseStatus),
      standardVersion: asText(rec.standardVersion, 40),
    });
  }
  return { ok: true, pages };
}

export function releaseStatusLabel(status: GroundingReleaseStatus | null): string {
  if (status === "draft") return "Entwurf";
  if (status === "released") return "freigegeben";
  return "nicht gesetzt";
}

export function groundingStartDraft(command: GroundingCommand, hasExistingHub: boolean): string {
  if (command === "pruefe") return "prüfe";
  if (command === "aktualisiere") return "aktualisiere";
  if (hasExistingHub) {
    return "Neubau ausdrücklich gewünscht. Erstelle die Grounding Page und die Entitätsseiten neu. Beginne mit der Aktualitäts-Recherche (Modul 0). Unterlagen hänge ich an diese Nachricht, falls noch etwas fehlt.";
  }
  return "Erstelle die Grounding Page (Hub) und die passenden Entitätsseiten. Beginne mit der Aktualitäts-Recherche (Modul 0). Unterlagen hänge ich an diese Nachricht, falls noch etwas fehlt.";
}

export function groundingCommandTitle(command: GroundingCommand): string {
  if (command === "erstelle") return "Grounding Pages · Erstellen";
  if (command === "pruefe") return "Grounding Pages · Prüfen";
  return "Grounding Pages · Aktualisieren";
}

export type GroundingPromptPage = {
  role: "hub" | "entity";
  title: string;
  slug: string | null;
  url: string | null;
  uploadedAt: string | null;
  dateModified: string | null;
  lastReviewed: string | null;
  reviewedBy: string | null;
  notes: string | null;
  releaseStatus: GroundingReleaseStatus | null;
  standardVersion: string | null;
};

export function formatGroundingFactDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "nicht hinterlegt";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "nicht hinterlegt";
  const label = d.toLocaleDateString("de-DE", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${label} (${d.toISOString().slice(0, 10)}, Quelle: Tool)`;
}

export function describeGroundingPageForPrompt(
  page: GroundingPromptPage,
  now?: string | Date,
): { schedule: GroundingPageSchedule; text: string } {
  const schedule = evaluateGroundingPageSchedule({
    uploadedAt: page.uploadedAt,
    lastReviewed: page.lastReviewed,
    now,
  });
  const label = page.role === "hub" ? "Hub" : `Entitätsseite „${page.title}“`;
  const lines = [
    `#### ${label}`,
    page.role === "entity" && page.slug ? `- Slug: ${page.slug}` : "",
    `- URL: ${page.url?.trim() || "nicht hinterlegt"}`,
    `- hochgeladen am: ${formatGroundingFactDate(page.uploadedAt)}`,
    `- dateModified: ${formatGroundingFactDate(page.dateModified)}`,
    `- lastReviewed: ${formatGroundingFactDate(page.lastReviewed)}`,
    `- Prüfer: ${page.reviewedBy?.trim() || "nicht hinterlegt"}`,
    `- Status: ${schedule.toolStatus}`,
    `- Freigabe: ${releaseStatusLabel(page.releaseStatus)}`,
    `- Standardversion: ${page.standardVersion?.trim() || "nicht hinterlegt"}`,
    `- nächste Fälligkeit: ${
      schedule.nextDueAt
        ? `${formatGroundingFactDate(schedule.nextDueAt)} (lastReviewed + 3 Monate)`
        : "keine, solange lastReviewed fehlt"
    }`,
    `- Notizen: ${page.notes?.trim() || "keine"}`,
  ].filter(Boolean);
  return { schedule, text: lines.join("\n") };
}

export function serializeGroundingRow(row: GroundingConfigRow) {
  const entities = parseGroundingEntityPages(row.grounding_entity_pages);
  const schedule = evaluateGroundingPageSchedule({
    uploadedAt: row.grounding_page_uploaded_at,
    lastReviewed: row.grounding_page_last_reviewed,
  });
  return {
    organisationId: row.organisation_id,
    url: row.grounding_page_url,
    uploadedAt: row.grounding_page_uploaded_at,
    dateModified: row.grounding_page_date_modified ?? null,
    lastReviewed: row.grounding_page_last_reviewed ?? null,
    reviewedBy: row.grounding_page_reviewed_by ?? null,
    releaseStatus: asRelease(row.grounding_page_release_status),
    standardVersion: row.grounding_page_standard_version ?? null,
    customerSlug: row.grounding_customer_slug ?? null,
    notes: row.grounding_page_notes,
    llmsTxtUrl: row.grounding_llms_txt_url ?? null,
    entities,
    schedule,
  };
}
