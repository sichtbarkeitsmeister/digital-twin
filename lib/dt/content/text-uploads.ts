/**
 * „Verbesserung → Texte hochladen“: reads and writes of `dt_content_text_uploads` (the text of
 * uploaded Word files) and what links them to the Texte table. Always called with the service
 * client, like `store.ts`. The matching itself is pure (`upload-match.ts`); this file stores
 * its result and applies „Zugeordnete Seiten übernehmen“.
 *
 * Only the extracted text is stored, never the original file.
 */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { briefingFromStructureTree, type ContentBriefingPage } from "@/lib/dt/content/excel-structure";
import { normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import {
  CONTENT_MAX_PAGES,
  contentDbErrorMessage,
  loadContentStructureWithBriefing,
  type BriefingUpsertMode,
} from "@/lib/dt/content/store";
import { briefingPatchFor } from "@/lib/dt/content/structure-plan";
import type {
  ContentPageState,
  ContentTextUploadResult,
  ContentTextUploadTakeoverResult,
  ContentTextUploadView,
  ContentTextUploadsResult,
} from "@/lib/dt/content/types";
import {
  TEXT_UPLOAD_MAX_FILE_BYTES,
  UPLOAD_UNASSIGNED_BY_HAND_NOTE,
  matchTextUploads,
  pageNameKey,
  planUploadTakeover,
  type TakeoverRow,
  type TextUploadMatch,
  type UploadMatchResult,
} from "@/lib/dt/content/upload-match";
import { parseWebsiteStructure } from "@/lib/dt/seo/website-structure";
import { blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";

export const CONTENT_TEXT_UPLOADS_MIGRATION_FILE = "database/migrations/20261110_dt_content_text_uploads.sql";

type DbError = { code?: string; message?: string };

/** The table, the column `text_upload_id` or the source value „upload“ is unknown: the migration never ran. */
export function isMissingTextUploadsError(error: DbError | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (error.code === "23514" && /source_check/i.test(message)) return true;
  if (!/dt_content_text_uploads|text_upload_id/i.test(message)) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "42P01" ||
    error.code === "42703" ||
    /does not exist|schema cache|could not find/i.test(message)
  );
}

export const TEXT_UPLOADS_MIGRATION_MESSAGE = `Die Datenbank kennt hochgeladene Word-Texte noch nicht: Bitte ${CONTENT_TEXT_UPLOADS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin steht „Texte hochladen“ nicht zur Verfügung; alles andere in Texte läuft weiter.`;

export function textUploadsDbErrorMessage(error: DbError, fallback: string): string {
  return isMissingTextUploadsError(error) ? TEXT_UPLOADS_MIGRATION_MESSAGE : contentDbErrorMessage(error, fallback);
}

/** A row of `dt_content_text_uploads` without the text (the list never needs the sections). */
export type ContentTextUploadRow = {
  id: string;
  organisation_id: string;
  file_name: string;
  name_key: string;
  chars: number;
  block_count: number;
  structure_slug: string | null;
  match: TextUploadMatch;
  match_note: string | null;
  page_id: string | null;
  error: string | null;
  uploaded_at: string | null;
};

const LIST_COLUMNS =
  "id, organisation_id, file_name, name_key, chars, block_count, structure_slug, match, match_note, page_id, error, uploaded_at";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function rowFrom(raw: Record<string, unknown>): ContentTextUploadRow {
  return {
    id: String(raw.id ?? ""),
    organisation_id: String(raw.organisation_id ?? ""),
    file_name: String(raw.file_name ?? ""),
    name_key: String(raw.name_key ?? ""),
    chars: Number(raw.chars ?? 0) || 0,
    block_count: Number(raw.block_count ?? 0) || 0,
    structure_slug: text(raw.structure_slug),
    match: raw.match === "auto" || raw.match === "manual" ? raw.match : null,
    match_note: text(raw.match_note),
    page_id: text(raw.page_id),
    error: text(raw.error),
    uploaded_at: text(raw.uploaded_at),
  };
}

/** Every stored file of the organisation in upload order (the order „the first file“ of the matching means). */
export async function loadTextUploads(service: SupabaseClient, organisationId: string): Promise<ContentTextUploadRow[]> {
  const { data, error } = await service
    .from("dt_content_text_uploads")
    .select(LIST_COLUMNS)
    .eq("organisation_id", organisationId)
    .limit(1_000);
  if (error) throw new Error(textUploadsDbErrorMessage(error, "Hochgeladene Texte konnten nicht geladen werden"));
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(rowFrom)
    .sort((a, b) => (a.uploaded_at ?? "").localeCompare(b.uploaded_at ?? "") || a.file_name.localeCompare(b.file_name, "de") || a.id.localeCompare(b.id));
}

type StructurePages = { pages: ContentBriefingPage[] | null; columns: BriefingUpsertMode; uploadedAt: string | null };

/** The pages of the Seitenstruktur (the stored Excel briefing, else the structure text parsed); null without one. */
async function loadStructurePages(service: SupabaseClient, organisationId: string): Promise<StructurePages> {
  const stored = await loadContentStructureWithBriefing(service, organisationId);
  if (!stored.structure) return { pages: null, columns: "structure", uploadedAt: null };
  if (stored.briefing) {
    return { pages: stored.briefing.pages, columns: stored.briefing.columns, uploadedAt: stored.briefing.uploaded_at };
  }
  let pages: ContentBriefingPage[] = [];
  try {
    pages = briefingFromStructureTree(parseWebsiteStructure(stored.structure.raw_text).nodes);
  } catch {
    pages = [];
  }
  return { pages, columns: "structure", uploadedAt: stored.structure.uploaded_at || null };
}

export type TextUploadMatchState = StructurePages & {
  uploads: ContentTextUploadRow[];
  results: Map<string, UploadMatchResult>;
};

/**
 * Runs the matching over the stored files and writes what changed. Called by every read and
 * before every write, so a new Seitenstruktur or new files are matched without a hook in the
 * structure upload. Manual decisions are never re-matched (`matchTextUploads`).
 */
export async function syncTextUploadMatches(service: SupabaseClient, organisationId: string): Promise<TextUploadMatchState> {
  const [uploads, structure] = await Promise.all([loadTextUploads(service, organisationId), loadStructurePages(service, organisationId)]);
  const matched = matchTextUploads(uploads, structure.pages);
  const results = new Map(matched.map((r) => [r.id, r]));
  const changed = uploads.filter((u) => {
    const r = results.get(u.id)!;
    return u.structure_slug !== r.structure_slug || u.match !== r.match || u.match_note !== r.match_note;
  });
  for (let i = 0; i < changed.length; i += 10) {
    const writes = await Promise.all(
      changed.slice(i, i + 10).map((u) => {
        const r = results.get(u.id)!;
        return service
          .from("dt_content_text_uploads")
          .update({ structure_slug: r.structure_slug, match: r.match, match_note: r.match_note })
          .eq("id", u.id);
      }),
    );
    const failed = writes.find((w) => w.error)?.error;
    if (failed) throw new Error(textUploadsDbErrorMessage(failed, "Zuordnung konnte nicht gespeichert werden"));
  }
  for (const u of changed) {
    const r = results.get(u.id)!;
    Object.assign(u, { structure_slug: r.structure_slug, match: r.match, match_note: r.match_note });
  }
  return { ...structure, uploads, results };
}

type LinkedPage = { id: string; slug: string; name: string; state: ContentPageState; source_url: string | null; skip_steps: unknown };

async function loadLinkedPages(service: SupabaseClient, organisationId: string, ids: readonly string[]): Promise<Map<string, LinkedPage>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await service
    .from("dt_content_pages")
    .select("id, slug, name, state, source_url, skip_steps")
    .eq("organisation_id", organisationId)
    .in("id", [...ids]);
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"));
  return new Map(((data ?? []) as unknown as LinkedPage[]).map((p) => [p.id, p]));
}

function uploadsResult(state: TextUploadMatchState, linked: ReadonlyMap<string, LinkedPage>): ContentTextUploadsResult {
  const pageBySlug = new Map((state.pages ?? []).map((p) => [p.slug, p]));
  const uploads: ContentTextUploadView[] = state.uploads.map((u) => {
    const r = state.results.get(u.id)!;
    const structure = r.structure_slug ? pageBySlug.get(r.structure_slug) : undefined;
    const page = u.page_id ? linked.get(u.page_id) : undefined;
    return {
      id: u.id,
      file_name: u.file_name,
      status: r.status,
      note: r.status === "error" ? u.error : r.match_note,
      structure: structure ? { slug: structure.slug, name: structure.name, path: structure.path } : null,
      sections: u.block_count,
      chars: u.chars,
      uploaded_at: u.uploaded_at,
      page: page ? { slug: page.slug, name: page.name, state: page.state } : null,
    };
  });
  const taken = new Set(uploads.map((u) => u.structure?.slug).filter((s): s is string => Boolean(s)));
  const free = (state.pages ?? []).filter((p) => !taken.has(p.slug));
  const assigned = uploads.filter((u) => u.structure).length;
  return {
    supported: true,
    hint: null,
    has_structure: state.pages != null,
    uploads,
    free_pages: free.map((p) => ({ slug: p.slug, name: p.name, path: p.path })),
    summary: {
      assigned,
      unassigned: uploads.length - assigned,
      pages_without_text: free.filter((p) => p.page_type !== "nicht_bearbeiten").length,
      pending: uploads.filter((u) => u.structure && !u.page).length,
    },
  };
}

const UNSUPPORTED_RESULT: ContentTextUploadsResult = {
  supported: false,
  hint: TEXT_UPLOADS_MIGRATION_MESSAGE,
  has_structure: false,
  uploads: [],
  free_pages: [],
  summary: { assigned: 0, unassigned: 0, pages_without_text: 0, pending: 0 },
};

/** The table „Hochgeladene Texte“ with the summary line; `supported: false` names the migration. */
export async function loadTextUploadsResult(service: SupabaseClient, organisationId: string): Promise<ContentTextUploadsResult> {
  const probe = await service.from("dt_content_text_uploads").select("id").eq("organisation_id", organisationId).limit(1);
  if (probe.error && isMissingTextUploadsError(probe.error)) return UNSUPPORTED_RESULT;
  const state = await syncTextUploadMatches(service, organisationId);
  const linked = await loadLinkedPages(
    service,
    organisationId,
    state.uploads.map((u) => u.page_id).filter((id): id is string => Boolean(id)),
  );
  return uploadsResult(state, linked);
}

export type TextUploadActionResult<T = undefined> = { ok: true; data: T } | { ok: false; status: number; message: string };

function fail(status: number, message: string): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

async function loadUploadRow(service: SupabaseClient, organisationId: string, id: string): Promise<ContentTextUploadRow | null> {
  const { data, error } = await service
    .from("dt_content_text_uploads")
    .select(LIST_COLUMNS)
    .eq("organisation_id", organisationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(textUploadsDbErrorMessage(error, "Datei konnte nicht geladen werden"));
  return data ? rowFrom(data as unknown as Record<string, unknown>) : null;
}

/** A running page reads its file for every step: nothing about the file may change under it. */
function runningMessage(page: Pick<LinkedPage, "name">, action: string): string {
  return `Die Seite „${page.name}“ läuft gerade – erst stoppen, dann ${action}.`;
}

/**
 * The page stops using the file: it falls back to what it was without it — a page with a live
 * URL to „crawl“, any other to „structure“, where it is written from scratch (a switched-off
 * SEO is switched on again, since there is no text to take over any more). State, text and
 * steps of the page stay. Refused while the page runs.
 */
async function detachUploadFromPage(
  service: SupabaseClient,
  upload: Pick<ContentTextUploadRow, "id" | "organisation_id" | "page_id">,
  action: string,
): Promise<TextUploadActionResult> {
  if (!upload.page_id) return { ok: true, data: undefined };
  const page = (await loadLinkedPages(service, upload.organisation_id, [upload.page_id])).get(upload.page_id);
  if (page) {
    if (page.state === "laeuft") return fail(409, runningMessage(page, action));
    const toCrawl = Boolean(page.source_url);
    const skip = Array.isArray(page.skip_steps) ? page.skip_steps : [];
    const { error } = await service
      .from("dt_content_pages")
      .update({
        source: toCrawl ? "crawl" : "structure",
        text_upload_id: null,
        ...(toCrawl ? {} : { skip_steps: skip.filter((key) => key !== "seo") }),
      })
      .eq("id", page.id)
      .neq("state", "laeuft");
    if (error) return fail(500, textUploadsDbErrorMessage(error, "Seite konnte nicht aktualisiert werden"));
  }
  const { error } = await service.from("dt_content_text_uploads").update({ page_id: null }).eq("id", upload.id);
  if (error) return fail(500, textUploadsDbErrorMessage(error, "Datei konnte nicht aktualisiert werden"));
  return { ok: true, data: undefined };
}

function cleanFileName(name: string): string {
  const base = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 240);
}

/**
 * One uploaded Word file: read with the ingest of the text tools (.docx via mammoth, the same
 * limits: 60.000 characters, `TEXT_TOOL_MAX_BLOCKS` sections), then stored by its name key.
 *
 *   - A file that cannot be read (old .doc, no Word file, too long …) is stored as a row with
 *     its `error`, so it shows in the table and the rest of the batch goes on. It never
 *     overwrites a readable text: then only the message comes back.
 *   - The same name key again replaces the text only with `replace` (the UI asked); assignment
 *     and page stay. `uploadId` is „Ersetzen“ on one row: that row takes the new file, also
 *     under a new name; its assignment then counts as made by hand.
 *   - Refused while the page that uses the file runs.
 */
export async function storeTextUpload(
  service: SupabaseClient,
  input: { organisationId: string; userId: string; fileName: string; bytes: Uint8Array; replace?: boolean; uploadId?: string | null },
): Promise<TextUploadActionResult<ContentTextUploadResult>> {
  const fileName = cleanFileName(input.fileName);
  if (!/\.docx?$/i.test(fileName)) return fail(400, `„${fileName || "Datei"}“ ist keine Word-Datei. Erlaubt ist nur .docx.`);
  const nameKey = pageNameKey(fileName);
  if (!nameKey) return fail(400, `Der Dateiname „${fileName}“ ergibt keinen Seitennamen.`);

  let readError: string | null = null;
  let blocks: ContentTextBlock[] = [];
  let title: string | null = null;
  let metaDescription: string | null = null;
  let chars = 0;
  if (input.bytes.byteLength > TEXT_UPLOAD_MAX_FILE_BYTES) {
    readError = `„${fileName}“ ist zu groß (max. ${Math.round(TEXT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB).`;
  } else {
    const document = await extractUploadedDocument(fileName, input.bytes);
    if (!document.ok) readError = document.message;
    else {
      const ingested = blocksFromDocument(document.value);
      if (!ingested.ok) readError = ingested.message;
      else ({ blocks, title, metaDescription, chars } = ingested.value);
    }
  }

  const all = await loadTextUploads(service, input.organisationId);
  const sameKey = all.find((u) => u.name_key === nameKey) ?? null;
  const target = input.uploadId ? (all.find((u) => u.id === input.uploadId) ?? null) : sameKey;
  if (input.uploadId && !target) return fail(404, "Die Datei gibt es nicht mehr.");
  if (target && sameKey && sameKey.id !== target.id) {
    return fail(409, `Unter dem Namen „${sameKey.file_name}“ ist bereits eine andere Datei hochgeladen. Bitte diese ersetzen oder entfernen.`);
  }
  if (target && !target.error) {
    if (!input.uploadId && !input.replace) {
      return fail(409, `„${target.file_name}“ ist bereits hochgeladen. Zum Ersetzen des Textes bitte bestätigen.`);
    }
    // A readable text is never replaced by a failure.
    if (readError) return { ok: true, data: { id: target.id, file_name: fileName, replaced: false, error: readError } };
  }
  if (target?.page_id) {
    const page = (await loadLinkedPages(service, input.organisationId, [target.page_id])).get(target.page_id);
    if (page?.state === "laeuft") return fail(409, runningMessage(page, "den Text ersetzen"));
  }

  const content = {
    file_name: fileName,
    name_key: nameKey,
    format: "docx",
    blocks,
    title,
    meta_description: metaDescription,
    chars,
    block_count: blocks.length,
    error: readError,
    uploaded_by: input.userId,
    uploaded_at: new Date().toISOString(),
  };

  if (target) {
    // „Ersetzen“ under another name: the editor chose this page for the new file.
    const keepByHand = Boolean(input.uploadId) && target.name_key !== nameKey && target.structure_slug != null && !readError;
    const { error } = await service
      .from("dt_content_text_uploads")
      .update({ ...content, uploaded_at: target.uploaded_at ?? content.uploaded_at, ...(keepByHand ? { match: "manual", match_note: null } : {}) })
      .eq("id", target.id);
    if (error) return fail(500, textUploadsDbErrorMessage(error, "Datei konnte nicht gespeichert werden"));
    return { ok: true, data: { id: target.id, file_name: fileName, replaced: !target.error, error: readError } };
  }

  const id = randomUUID();
  const { error } = await service
    .from("dt_content_text_uploads")
    .insert({ id, organisation_id: input.organisationId, ...content, structure_slug: null, match: null, match_note: null, page_id: null });
  if (error) {
    if (error.code === "23505") return fail(409, `„${fileName}“ ist bereits hochgeladen. Zum Ersetzen des Textes bitte bestätigen.`);
    return fail(500, textUploadsDbErrorMessage(error, "Datei konnte nicht gespeichert werden"));
  }
  return { ok: true, data: { id, file_name: fileName, replaced: false, error: readError } };
}

/**
 * The manual assignment (`structureSlug`) or „Zuordnung lösen“ (null). Both are decisions by
 * hand and survive every later automatic match. A page takes one file only. When the file is
 * already used by a row of the Texte table and its page changes, that row lets go of it first
 * (`detachUploadFromPage`); „Zugeordnete Seiten übernehmen“ brings it to the new page.
 */
export async function assignTextUpload(
  service: SupabaseClient,
  organisationId: string,
  uploadId: string,
  structureSlug: string | null,
): Promise<TextUploadActionResult> {
  const state = await syncTextUploadMatches(service, organisationId);
  const upload = state.uploads.find((u) => u.id === uploadId);
  if (!upload) return fail(404, "Die Datei gibt es nicht mehr.");
  if (upload.error) return fail(400, "Die Datei konnte nicht gelesen werden und lässt sich keiner Seite zuordnen.");

  if (structureSlug) {
    const page = state.pages?.find((p) => p.slug === structureSlug);
    if (!page) return fail(404, "Diese Seite steht nicht (mehr) in der Seitenstruktur.");
    const holder = state.uploads.find((u) => u.id !== upload.id && u.structure_slug === structureSlug);
    if (holder) return fail(409, `Die Seite „${page.name}“ hat bereits die Datei „${holder.file_name}“. Bitte dort zuerst die Zuordnung lösen.`);
  }
  if (upload.structure_slug !== structureSlug || !structureSlug) {
    const detached = await detachUploadFromPage(service, upload, structureSlug ? "die Zuordnung ändern" : "die Zuordnung lösen");
    if (!detached.ok) return detached;
  }
  const { error } = await service
    .from("dt_content_text_uploads")
    .update({ structure_slug: structureSlug, match: "manual", match_note: structureSlug ? null : UPLOAD_UNASSIGNED_BY_HAND_NOTE })
    .eq("id", upload.id);
  if (error) return fail(500, textUploadsDbErrorMessage(error, "Zuordnung konnte nicht gespeichert werden"));
  return { ok: true, data: undefined };
}

/**
 * „Entfernen“: the stored text is deleted. A page that used it falls back to „structure“ (or
 * „crawl“ when it has a live URL) and is written from scratch on its next run; its state, text
 * and steps stay. Refused while that page runs.
 */
export async function removeTextUpload(service: SupabaseClient, organisationId: string, uploadId: string): Promise<TextUploadActionResult> {
  const upload = await loadUploadRow(service, organisationId, uploadId);
  if (!upload) return { ok: true, data: undefined };
  const detached = await detachUploadFromPage(service, upload, "die Datei entfernen");
  if (!detached.ok) return detached;
  const { error } = await service.from("dt_content_text_uploads").delete().eq("id", upload.id);
  if (error) return fail(500, textUploadsDbErrorMessage(error, "Datei konnte nicht entfernt werden"));
  return { ok: true, data: undefined };
}

export type TextUploadTakeoverCounts = Omit<ContentTextUploadTakeoverResult, "uploads" | "overview">;

/**
 * „Zugeordnete Seiten übernehmen“ (`planUploadTakeover`): every assigned file gets its row.
 * An existing row is switched to source „upload“ and linked; nothing else on it changes, so a
 * started page keeps state and text and uses the file from its next run or after
 * „Zurücksetzen“. A new row is created from the page of the Seitenstruktur with its briefing,
 * like „Diese Seiten anlegen“, within the page limit.
 */
export async function takeOverTextUploads(service: SupabaseClient, organisationId: string): Promise<TextUploadActionResult<TextUploadTakeoverCounts>> {
  const state = await syncTextUploadMatches(service, organisationId);
  if (!state.pages) return fail(400, "Bitte zuerst die Seitenstruktur hochladen: erst dann lassen sich die Dateien Seiten zuordnen.");

  const { data: rowData, error: rowsError } = await service
    .from("dt_content_pages")
    .select("id, slug, path, source_url, position, state")
    .eq("organisation_id", organisationId)
    .limit(CONTENT_MAX_PAGES);
  if (rowsError) return fail(500, contentDbErrorMessage(rowsError, "Seiten konnten nicht geladen werden"));
  const rows = (rowData ?? []) as unknown as TakeoverRow[];

  const plan = planUploadTakeover(state.uploads, state.pages, rows, CONTENT_MAX_PAGES);
  const counts: TextUploadTakeoverCounts = {
    created: 0,
    attached: 0,
    kept_started: 0,
    already: plan.already,
    over_limit: plan.over_limit,
    skipped: [...plan.skipped],
  };
  const uploadById = new Map(state.uploads.map((u) => [u.id, u]));

  /** A file that still hangs on another row lets go of it first; while that row runs, the file waits. */
  const release = async (uploadId: string, fileName: string): Promise<boolean> => {
    const upload = uploadById.get(uploadId)!;
    if (!upload.page_id) return true;
    const detached = await detachUploadFromPage(service, upload, "erneut übernehmen");
    if (!detached.ok) counts.skipped.push({ file: fileName, reason: detached.message });
    return detached.ok;
  };
  const link = async (uploadId: string, rowId: string): Promise<string | null> => {
    // The row has one file: an older link of another file to it ends.
    const { error: othersError } = await service
      .from("dt_content_text_uploads")
      .update({ page_id: null })
      .eq("organisation_id", organisationId)
      .eq("page_id", rowId)
      .neq("id", uploadId);
    if (othersError) return textUploadsDbErrorMessage(othersError, "Dateien konnten nicht aktualisiert werden");
    const { error } = await service.from("dt_content_text_uploads").update({ page_id: rowId }).eq("id", uploadId);
    return error ? textUploadsDbErrorMessage(error, "Datei konnte nicht verknüpft werden") : null;
  };

  for (const item of plan.attach) {
    if (!(await release(item.upload_id, item.file_name))) continue;
    const { data: updated, error } = await service
      .from("dt_content_pages")
      .update({ source: "upload", text_upload_id: item.upload_id })
      .eq("id", item.row_id)
      .neq("state", "laeuft")
      .select("id");
    if (error) return fail(500, textUploadsDbErrorMessage(error, "Seiten konnten nicht aktualisiert werden"));
    if (!updated || updated.length === 0) {
      counts.skipped.push({ file: item.file_name, reason: "Die Seite läuft gerade – nach dem Lauf erneut übernehmen." });
      continue;
    }
    const linkError = await link(item.upload_id, item.row_id);
    if (linkError) return fail(500, linkError);
    counts.attached += 1;
    if (item.started) counts.kept_started += 1;
  }

  const uploadedAt = state.uploadedAt ?? new Date().toISOString();
  for (const item of plan.create) {
    if (!(await release(item.upload_id, item.file_name))) continue;
    const { page } = item;
    const id = randomUUID();
    const { error } = await service.from("dt_content_pages").insert({
      id,
      organisation_id: organisationId,
      structure_uploaded_at: uploadedAt,
      source: "upload",
      text_upload_id: item.upload_id,
      slug: page.slug,
      name: page.name,
      path: page.path,
      level: page.level,
      position: page.position,
      ...briefingPatchFor(page, state.columns),
    });
    if (error) return fail(500, textUploadsDbErrorMessage(error, "Seiten konnten nicht angelegt werden"));
    const linkError = await link(item.upload_id, id);
    if (linkError) return fail(500, linkError);
    counts.created += 1;
  }
  return { ok: true, data: counts };
}

/** What the pipeline reads of the file a page uses. */
export type PageTextUpload = {
  id: string;
  file_name: string;
  blocks: ContentTextBlock[];
  title: string | null;
  meta_description: string | null;
};

/**
 * The Word text of a page with source „upload“ (the file linked to the row), or null when the
 * file is gone or unreadable. A database error throws: the step must not go on as if the page
 * had no text.
 */
export async function loadPageTextUpload(
  service: SupabaseClient,
  page: { id: string; organisation_id: string },
): Promise<PageTextUpload | null> {
  const { data, error } = await service
    .from("dt_content_text_uploads")
    .select("id, file_name, blocks, title, meta_description, error")
    .eq("organisation_id", page.organisation_id)
    .eq("page_id", page.id)
    .limit(2);
  if (error) throw new Error(textUploadsDbErrorMessage(error, "Der hochgeladene Text der Seite konnte nicht geladen werden"));
  const row = ((data ?? []) as unknown as Record<string, unknown>[]).find((r) => !text(r.error));
  if (!row) return null;
  const blocks = normalizeBlocks(row.blocks);
  if (blocks.length === 0) return null;
  return {
    id: String(row.id ?? ""),
    file_name: String(row.file_name ?? ""),
    blocks,
    title: text(row.title),
    meta_description: text(row.meta_description),
  };
}
