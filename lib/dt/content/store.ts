/**
 * Reads and writes for the content tables (`dt_content_settings`, `dt_content_pages`,
 * `dt_content_steps`) and the response objects the Texte tab consumes. Always called with
 * the service client: routes check access first (`gateContentRoute`), the job runner has none.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  planCrawlContentPages,
  type CrawledSitePage,
  type CrawlPagePlan,
} from "@/lib/dt/content/crawl-pages";
import {
  briefingFromStructureTree,
  type ContentBriefingPage,
  type ContentPageKeywords,
} from "@/lib/dt/content/excel-structure";
import { describeRunningPage, type ContentJobVerdict } from "@/lib/dt/content/job-state";
import type { ContentAnrede, ContentBranche, ContentTextSettings } from "@/lib/dt/content/mapping";
import { cleanTextSettings } from "@/lib/dt/content/mapping";
import {
  CONTENT_PAGE_TYPE_LABELS,
  effectiveContentPageType,
  isContentPageRole,
  isContentPageType,
  type ContentPageRole,
  type ContentPageType,
} from "@/lib/dt/content/page-types";
import {
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEPS,
  contentStepName,
  hasLegacyContentSteps,
} from "@/lib/dt/content/pipeline/steps";
import { formatEur } from "@/lib/dt/content/presentation";
import { slugify } from "@/lib/dt/content/render";
import { parseWebsiteStructure, type WebsiteStructureNode } from "@/lib/dt/seo/website-structure";
import type {
  ContentAction,
  ContentFinding,
  ContentOverview,
  ContentPageBriefing,
  ContentPageSource,
  ContentPageState,
  ContentPageSummary,
  ContentQuestion,
  ContentReadiness,
  ContentReview,
  ContentStep,
  ContentStepStatus,
} from "@/lib/dt/content/types";

export type ContentPageRow = {
  id: string;
  organisation_id: string;
  slug: string;
  name: string;
  path: string | null;
  level: number;
  position: number;
  source: ContentPageSource;
  source_url: string | null;
  crawled_at: string | null;
  main_keyword: string | null;
  /** Excel briefing (structure pages) or a guess from name and depth (crawl pages). */
  page_role: ContentPageRole | null;
  page_type: ContentPageType | null;
  pillar_name: string | null;
  estimated_traffic: number | null;
  keywords: ContentPageKeywords | null;
  h1_options: string[];
  user_questions: string[];
  ki_prompt: string | null;
  internal_link_targets: string[];
  state: ContentPageState;
  step: number | null;
  released: boolean;
  released_at: string | null;
  title: string | null;
  meta_description: string | null;
  html: string;
  markdown: string;
  findings: ContentFinding[];
  final_findings: ContentFinding[];
  unresolved: ContentFinding[];
  questions: ContentQuestion[];
  notes: string[];
  error: string | null;
  job_id: string | null;
  cost_eur: number | string;
  started_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentStepRow = {
  id: string;
  page_id: string;
  organisation_id: string;
  step: number;
  name: string;
  status: ContentStepStatus;
  output: unknown;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number | string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export type ContentSettingsRow = {
  organisation_id: string;
  anrede: ContentAnrede;
  branche: ContentBranche;
  tonalitaet: string;
  verbotene_woerter: string[];
  avatar_agent_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
};

const BRIEFING_COLUMNS =
  "page_role, page_type, pillar_name, estimated_traffic, keywords, h1_options, user_questions, ki_prompt, internal_link_targets";

export const PAGE_COLUMNS = `id, organisation_id, slug, name, path, level, position, source, source_url, crawled_at, main_keyword, ${BRIEFING_COLUMNS}, state, step, released, released_at, title, meta_description, html, markdown, findings, final_findings, unresolved, questions, notes, error, job_id, cost_eur, started_by, created_at, updated_at`;

/** Light projection for the overview table (no HTML). */
const SUMMARY_COLUMNS = `id, organisation_id, slug, name, path, level, position, source, source_url, crawled_at, main_keyword, ${BRIEFING_COLUMNS}, state, step, released, released_at, title, meta_description, findings, final_findings, unresolved, questions, notes, error, job_id, cost_eur, started_by, created_at, updated_at`;

/** What the prompts see of the other pages (cannibalisation, deferred questions). */
const OUTLINE_COLUMNS = "slug, name, path, level, source, page_role, page_type, pillar_name, main_keyword, keywords";

const STEP_COLUMNS =
  "id, page_id, organisation_id, step, name, status, output, model, input_tokens, output_tokens, cost_eur, error, started_at, finished_at, approved_by, approved_at";

const MAX_PAGES = 300;
/** How many crawled rows are read when taking pages over; the plan keeps the first MAX_PAGES. */
const MAX_CRAWLED_ROWS = 5_000;

export const CONTENT_MIGRATION_FILE = "database/migrations/20261006_dt_content_pipeline.sql";
export const CONTENT_SOURCE_MIGRATION_FILE = "database/migrations/20261008_dt_content_pages_source.sql";
export const CONTENT_BRIEFING_MIGRATION_FILE = "database/migrations/20261009_dt_content_excel_briefing.sql";

/** PostgREST answers PGRST205 when a table is not in its schema cache, i.e. the migration never ran. */
export function isMissingContentTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (isMissingContentColumnError(error)) return false;
  return error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message ?? "");
}

/** `column dt_content_pages.source does not exist` (select) or PGRST204 (write): the source migration never ran. */
export function isMissingContentColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .+ does not exist|could not find the '.+' column/i.test(message)
  );
}

export function contentDbErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (isMissingContentColumnError(error)) {
    return `Die Datenbank ist noch nicht auf dem neuesten Stand: Bitte ${CONTENT_BRIEFING_MIGRATION_FILE} (und, falls noch nicht geschehen, ${CONTENT_SOURCE_MIGRATION_FILE}) einmal im Supabase SQL Editor ausführen.`;
  }
  if (isMissingContentTableError(error)) {
    return `Die Datenbank ist noch nicht vorbereitet: Bitte ${CONTENT_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`;
  }
  return `${fallback}: ${error.message ?? "Unbekannter Fehler"}`;
}

export function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringList(value: unknown): string[] {
  return asArray<unknown>(value).filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** `keywords` as stored: `{ main: { text, volume? }, secondary: [...] }`; anything else counts as none. */
export function normalizeKeywords(value: unknown): ContentPageKeywords | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { main?: unknown; secondary?: unknown };
  const keyword = (k: unknown) => {
    if (!k || typeof k !== "object") return null;
    const r = k as { text?: unknown; volume?: unknown };
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) return null;
    const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? r.volume : undefined;
    return volume != null ? { text, volume } : { text };
  };
  const main = keyword(raw.main);
  if (!main) return null;
  return { main, secondary: asArray<unknown>(raw.secondary).map(keyword).filter((k): k is NonNullable<typeof k> => Boolean(k)) };
}

function normalizePageRow(raw: Record<string, unknown>): ContentPageRow {
  return {
    ...(raw as unknown as ContentPageRow),
    source: raw.source === "crawl" ? "crawl" : "structure",
    source_url: typeof raw.source_url === "string" && raw.source_url ? raw.source_url : null,
    crawled_at: typeof raw.crawled_at === "string" ? raw.crawled_at : null,
    page_role: isContentPageRole(raw.page_role) ? raw.page_role : null,
    page_type: isContentPageType(raw.page_type) ? raw.page_type : null,
    pillar_name: nullableText(raw.pillar_name),
    estimated_traffic: typeof raw.estimated_traffic === "number" && Number.isFinite(raw.estimated_traffic) ? raw.estimated_traffic : null,
    keywords: normalizeKeywords(raw.keywords),
    h1_options: stringList(raw.h1_options),
    user_questions: stringList(raw.user_questions),
    ki_prompt: nullableText(raw.ki_prompt),
    internal_link_targets: stringList(raw.internal_link_targets),
    html: typeof raw.html === "string" ? raw.html : "",
    markdown: typeof raw.markdown === "string" ? raw.markdown : "",
    findings: asArray<ContentFinding>(raw.findings),
    final_findings: asArray<ContentFinding>(raw.final_findings),
    unresolved: asArray<ContentFinding>(raw.unresolved),
    questions: asArray<ContentQuestion>(raw.questions),
    notes: asArray<string>(raw.notes).filter((n) => typeof n === "string"),
  };
}

// --- settings ---------------------------------------------------------------------------------

export async function loadContentSettings(
  service: SupabaseClient,
  organisationId: string,
): Promise<ContentSettingsRow | null> {
  const { data, error } = await service
    .from("dt_content_settings")
    .select("organisation_id, anrede, branche, tonalitaet, verbotene_woerter, avatar_agent_id, confirmed_by, confirmed_at")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error && isMissingContentTableError(error)) {
    throw new Error(contentDbErrorMessage(error, "Einstellungen konnten nicht geladen werden"));
  }
  return (data as ContentSettingsRow | null) ?? null;
}

export function settingsFromRow(row: ContentSettingsRow): ContentTextSettings {
  return cleanTextSettings({
    anrede: row.anrede,
    branche: row.branche,
    tonalitaet: row.tonalitaet as ContentTextSettings["tonalitaet"],
    verbotene_woerter: Array.isArray(row.verbotene_woerter) ? row.verbotene_woerter : [],
  });
}

export async function saveContentSettings(
  service: SupabaseClient,
  input: { organisationId: string; settings: ContentTextSettings; avatarAgentId: string | null; userId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = cleanTextSettings(input.settings);
  const { error } = await service.from("dt_content_settings").upsert(
    {
      organisation_id: input.organisationId,
      anrede: clean.anrede,
      branche: clean.branche,
      tonalitaet: clean.tonalitaet,
      verbotene_woerter: clean.verbotene_woerter,
      avatar_agent_id: input.avatarAgentId,
      confirmed_by: input.userId,
      confirmed_at: new Date().toISOString(),
    },
    { onConflict: "organisation_id" },
  );
  return error
    ? { ok: false, error: contentDbErrorMessage(error, "Einstellungen konnten nicht gespeichert werden") }
    : { ok: true };
}

// --- pages ------------------------------------------------------------------------------------

export async function loadContentPage(
  service: SupabaseClient,
  organisationId: string,
  slug: string,
): Promise<ContentPageRow | null> {
  const { data, error } = await service
    .from("dt_content_pages")
    .select(PAGE_COLUMNS)
    .eq("organisation_id", organisationId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht geladen werden"));
  return data ? normalizePageRow(data as Record<string, unknown>) : null;
}

/**
 * Throws on a database error instead of answering null: the job handler must not mistake a
 * failed read for a deleted page (that left the page on „läuft“ with a finished job).
 */
export async function loadContentPageById(
  service: SupabaseClient,
  pageId: string,
): Promise<ContentPageRow | null> {
  const { data, error } = await service.from("dt_content_pages").select(PAGE_COLUMNS).eq("id", pageId).maybeSingle();
  if (error) throw new Error(contentDbErrorMessage(error, "Seite konnte nicht geladen werden"));
  return data ? normalizePageRow(data as Record<string, unknown>) : null;
}

export async function loadContentPages(
  service: SupabaseClient,
  organisationId: string,
  options?: { withHtml?: boolean },
): Promise<ContentPageRow[]> {
  const columns: string = options?.withHtml ? PAGE_COLUMNS : SUMMARY_COLUMNS;
  const { data, error } = await service
    .from("dt_content_pages")
    .select(columns)
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .limit(MAX_PAGES);
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"));
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizePageRow);
}

/** Throws on a database error: an empty list would restart the pipeline at step 1. */
export async function loadContentSteps(service: SupabaseClient, pageId: string): Promise<ContentStepRow[]> {
  const { data, error } = await service
    .from("dt_content_steps")
    .select(STEP_COLUMNS)
    .eq("page_id", pageId)
    .order("step", { ascending: true });
  if (error) throw new Error(contentDbErrorMessage(error, "Schritte konnten nicht geladen werden"));
  return (data ?? []) as ContentStepRow[];
}

/** Step rows of several pages at once (the overview needs them for the running ones). */
export async function loadContentStepsForPages(
  service: SupabaseClient,
  pageIds: readonly string[],
): Promise<Map<string, ContentStepRow[]>> {
  const byPage = new Map<string, ContentStepRow[]>();
  if (pageIds.length === 0) return byPage;
  const { data, error } = await service
    .from("dt_content_steps")
    .select(STEP_COLUMNS)
    .in("page_id", [...pageIds])
    .order("step", { ascending: true });
  if (error) throw new Error(contentDbErrorMessage(error, "Schritte konnten nicht geladen werden"));
  for (const row of (data ?? []) as ContentStepRow[]) {
    const list = byPage.get(row.page_id) ?? [];
    list.push(row);
    byPage.set(row.page_id, list);
  }
  return byPage;
}

type FlatPage = { slug: string; name: string; path: string | null; level: number; position: number };

/** Depth-first flattening of the structure tree with unique slugs. */
export function flattenStructure(nodes: readonly WebsiteStructureNode[]): FlatPage[] {
  const out: FlatPage[] = [];
  const used = new Set<string>();
  const walk = (list: readonly WebsiteStructureNode[], level: number) => {
    for (const node of list) {
      if (out.length >= MAX_PAGES) return;
      const name = node.label.trim() || node.path?.trim() || "Seite";
      const pathSegment = node.path?.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
      let slug = slugify(pathSegment) || slugify(name) || "seite";
      if (level === 0 && (node.path === "/" || /^startseite$|^home$/i.test(name))) slug = "startseite";
      const base = slug;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      used.add(slug);
      out.push({ slug, name, path: node.path?.trim() || null, level, position: out.length });
      walk(node.children, level + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** Which columns an upload may overwrite on an existing row (text, state and cost never). */
export type BriefingUpsertMode =
  /** The Excel briefing from Texte: every briefing column follows the file. */
  | "briefing"
  /**
   * A structure without briefing columns (SEO → Struktur, markdown, sitemap …): only name,
   * path, role, type and link targets follow it; keywords, questions, H1 options and the
   * KI-Prompt of an earlier Excel upload stay.
   */
  | "structure";

/**
 * Writes briefing pages onto `dt_content_pages`. Existing slugs keep their text, state,
 * steps and cost; `structure_uploaded_at` marks the upload the row was last matched with.
 */
export async function upsertContentPagesFromBriefing(
  service: SupabaseClient,
  organisationId: string,
  pages: readonly ContentBriefingPage[],
  uploadedAt: string,
  mode: BriefingUpsertMode,
): Promise<number> {
  if (pages.length === 0) return 0;
  const rows = pages.slice(0, MAX_PAGES).map((p) => ({
    organisation_id: organisationId,
    structure_uploaded_at: uploadedAt,
    source: "structure" as const,
    slug: p.slug,
    name: p.name,
    path: p.path,
    level: p.level,
    position: p.position,
    page_role: p.page_role,
    page_type: p.page_type,
    pillar_name: p.pillar_name,
    internal_link_targets: p.internal_link_targets,
    ...(mode === "briefing"
      ? {
          estimated_traffic: p.estimated_traffic,
          keywords: p.keywords,
          h1_options: p.h1_options,
          user_questions: p.user_questions,
          ki_prompt: p.ki_prompt,
          // A keyword the Analyse found stays when the Excel has none for the page.
          ...(p.keywords ? { main_keyword: p.keywords.main.text } : {}),
          ...(p.source_url ? { source_url: p.source_url } : {}),
        }
      : {}),
  }));
  const { error } = await service.from("dt_content_pages").upsert(rows, { onConflict: "organisation_id,slug" });
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht angelegt werden"));
  return rows.length;
}

/**
 * Creates page rows for the Seitenstruktur stored under SEO → Struktur. Runs only when that
 * upload is newer than the last sync (`structure_uploaded_at` on the rows), so polling the
 * overview stays cheap. An Excel uploaded in Texte (`/api/dt/content/structure`) writes its
 * rows itself and stores the same outline with the same timestamp, so nothing runs here.
 * Existing pages keep their text; name, path, role and type follow the upload.
 */
export async function syncContentPagesFromStructure(
  service: SupabaseClient,
  organisationId: string,
): Promise<{ synced: boolean; pages: number }> {
  const [{ data: structure }, { data: lastSync, error: syncError }] = await Promise.all([
    service
      .from("dt_website_structures")
      .select("raw_text, uploaded_at")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    service
      .from("dt_content_pages")
      .select("structure_uploaded_at")
      .eq("organisation_id", organisationId)
      .not("structure_uploaded_at", "is", null)
      .order("structure_uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (syncError && isMissingContentTableError(syncError)) {
    throw new Error(contentDbErrorMessage(syncError, "Seiten konnten nicht geladen werden"));
  }
  if (!structure?.raw_text) return { synced: false, pages: 0 };
  const uploadedAt = structure.uploaded_at as string;
  if (
    lastSync?.structure_uploaded_at &&
    new Date(lastSync.structure_uploaded_at as string) >= new Date(uploadedAt)
  ) {
    return { synced: false, pages: 0 };
  }

  let pages: ContentBriefingPage[];
  try {
    pages = briefingFromStructureTree(parseWebsiteStructure(structure.raw_text as string).nodes);
  } catch {
    return { synced: false, pages: 0 };
  }
  if (pages.length === 0) return { synced: false, pages: 0 };
  const written = await upsertContentPagesFromBriefing(service, organisationId, pages, uploadedAt, "structure");
  return { synced: true, pages: written };
}

export const CONTENT_TYPE_LOCKED_MESSAGE = "Der Seitentyp kommt aus der Excel und kann hier nicht geändert werden.";
export const CONTENT_TYPE_RUNNING_MESSAGE = "Die Seite läuft gerade – erst stoppen, dann den Seitentyp ändern.";

/**
 * Who may change „Seitentyp“: only crawl pages. The Excel is the briefing; a wrong type there
 * is fixed with a corrected Excel, never by hand in the drawer.
 */
export function canEditContentPageType(page: Pick<ContentPageRow, "source">): boolean {
  return page.source === "crawl";
}

/** Why the type cannot be changed right now (status and German message), or null when it can. */
export function contentPageTypeChangeBlocker(
  page: Pick<ContentPageRow, "source" | "state"> & Partial<ContentPageRow>,
): { status: number; message: string } | null {
  if (!canEditContentPageType(page)) return { status: 409, message: CONTENT_TYPE_LOCKED_MESSAGE };
  if (page.state === "laeuft") return { status: 409, message: CONTENT_TYPE_RUNNING_MESSAGE };
  return null;
}

/** „Seitentyp“ changed by hand in the drawer (crawl pages only; a running page waits). */
export async function updateContentPageType(
  service: SupabaseClient,
  page: ContentPageRow,
  pageType: ContentPageType,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const blocker = contentPageTypeChangeBlocker(page);
  if (blocker) return { ok: false, status: blocker.status, error: blocker.message };
  const { error } = await service.from("dt_content_pages").update({ page_type: pageType }).eq("id", page.id);
  return error
    ? { ok: false, status: 500, error: contentDbErrorMessage(error, "Seitentyp konnte nicht gespeichert werden") }
    : { ok: true };
}

export type ContentOutlinePage = Pick<
  ContentPageRow,
  "slug" | "name" | "path" | "level" | "source" | "page_role" | "page_type" | "pillar_name" | "main_keyword" | "keywords"
>;

/**
 * The other pages of the organisation, as the prompts see them: the current page's own silo
 * first (its Hauptsilo and siblings decide which questions belong elsewhere), then the rest.
 */
export function contentStructureOutline(pages: readonly ContentOutlinePage[], current: Pick<ContentOutlinePage, "slug" | "pillar_name" | "name">): string {
  const silo = new Set<string>([current.pillar_name ?? "", current.name].filter(Boolean));
  const inSilo = (p: ContentOutlinePage) => silo.has(p.name) || (p.pillar_name != null && silo.has(p.pillar_name));
  const line = (p: ContentOutlinePage) => {
    const keyword = p.keywords?.main.text ?? p.main_keyword;
    const type = p.page_type ? CONTENT_PAGE_TYPE_LABELS[p.page_type] : p.source === "crawl" ? "Crawl-Seite" : "Seite";
    return [
      `- ${p.name}${p.path ? ` (${p.path})` : ""}`,
      type,
      p.pillar_name ? `Hauptsilo: ${p.pillar_name}` : "",
      keyword ? `Keyword: ${keyword}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const others = pages.filter((p) => p.slug !== current.slug);
  const ordered = [...others.filter(inSilo), ...others.filter((p) => !inSilo(p))];
  return ordered.map(line).join("\n");
}

export async function loadContentPageOutline(service: SupabaseClient, organisationId: string): Promise<ContentOutlinePage[]> {
  const { data, error } = await service
    .from("dt_content_pages")
    .select(OUTLINE_COLUMNS)
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .limit(MAX_PAGES);
  if (error) {
    console.warn("[content] page outline not readable:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((raw) => ({
    slug: String(raw.slug ?? ""),
    name: String(raw.name ?? ""),
    path: nullableText(raw.path),
    level: Number(raw.level ?? 0) || 0,
    source: raw.source === "crawl" ? "crawl" : "structure",
    page_role: isContentPageRole(raw.page_role) ? raw.page_role : null,
    page_type: isContentPageType(raw.page_type) ? raw.page_type : null,
    pillar_name: nullableText(raw.pillar_name),
    main_keyword: nullableText(raw.main_keyword),
    keywords: normalizeKeywords(raw.keywords),
  }));
}

async function loadCrawledSitePages(service: SupabaseClient, organisationId: string): Promise<CrawledSitePage[]> {
  // No text_content here (a few hundred KB per page); fetch failures have neither title nor h1.
  const base = () =>
    service
      .from("dt_site_pages")
      .select("url, title, h1, is_excluded, crawled_at, final_url")
      .eq("organisation_id", organisationId)
      .eq("is_excluded", false)
      .or("title.not.is.null,h1.not.is.null")
      .order("url", { ascending: true })
      .limit(MAX_CRAWLED_ROWS);
  let result: { data: unknown[] | null; error: { message: string } | null } = await base();
  if (result.error && /final_url/i.test(result.error.message)) {
    // Older databases without migration 20260929: no redirect information, every page counts.
    result = await service
      .from("dt_site_pages")
      .select("url, title, h1, is_excluded, crawled_at")
      .eq("organisation_id", organisationId)
      .eq("is_excluded", false)
      .or("title.not.is.null,h1.not.is.null")
      .order("url", { ascending: true })
      .limit(MAX_CRAWLED_ROWS);
  }
  if (result.error) {
    if (/does not exist|schema cache/i.test(result.error.message)) return [];
    throw new Error(`Crawl-Seiten konnten nicht geladen werden: ${result.error.message}`);
  }
  return ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    url: String(row.url ?? ""),
    title: (row.title as string | null) ?? null,
    h1: (row.h1 as string | null) ?? null,
    text_content: null,
    is_excluded: Boolean(row.is_excluded),
    crawled_at: String(row.crawled_at ?? ""),
    final_url: (row.final_url as string | null | undefined) ?? null,
  }));
}

/**
 * „Seiten aus dem Crawl übernehmen“: one row per crawled page of the live site. Explicit, not
 * on every poll — the SEO crawl also serves other purposes, and nobody wants 300 rows to
 * appear because a crawl ran months ago. Existing slugs keep their text and only get the
 * live URL attached.
 */
export async function syncContentPagesFromCrawl(
  service: SupabaseClient,
  organisationId: string,
  options: { cities?: readonly string[] } = {},
): Promise<{ imported: number; attached: number; skipped: CrawlPagePlan["skipped"] }> {
  const [{ data: existing, error }, crawled] = await Promise.all([
    service
      .from("dt_content_pages")
      .select("slug, path, position, source_url")
      .eq("organisation_id", organisationId)
      .limit(MAX_PAGES),
    loadCrawledSitePages(service, organisationId),
  ]);
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"));

  const plan = planCrawlContentPages(
    (existing ?? []) as { slug: string; path?: string | null; position?: number | null; source_url?: string | null }[],
    crawled,
    { limit: MAX_PAGES, cities: options.cities },
  );

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((page) => ({ organisation_id: organisationId, source: "crawl" as const, ...page }));
    const { error: insertError } = await service.from("dt_content_pages").insert(rows);
    if (insertError) throw new Error(contentDbErrorMessage(insertError, "Seiten konnten nicht angelegt werden"));
  }
  for (const item of plan.attach) {
    const { error: attachError } = await service
      .from("dt_content_pages")
      .update({ source_url: item.source_url, crawled_at: item.crawled_at })
      .eq("organisation_id", organisationId)
      .eq("slug", item.slug)
      .is("source_url", null);
    if (attachError) throw new Error(contentDbErrorMessage(attachError, "Seiten konnten nicht aktualisiert werden"));
  }
  return { imported: plan.inserts.length, attached: plan.attach.length, skipped: plan.skipped };
}

// --- presentation -----------------------------------------------------------------------------

const STATE_LABELS: Record<ContentPageState, string> = {
  nicht_begonnen: "Nicht begonnen",
  laeuft: "Läuft",
  in_arbeit: "In Arbeit",
  braucht_sie: "Braucht Sie",
  fertig: "Fertig",
};

/** Step rows and the job verdict of a page, when the caller loaded them (running pages). */
export type ContentPageExtra = {
  steps?: readonly ContentStepRow[] | null;
  verdict?: ContentJobVerdict | null;
};

export function pageDetail(page: ContentPageRow, extra: ContentPageExtra = {}): string | null {
  const stepName = contentStepName(page.step);
  switch (page.state) {
    case "laeuft":
      return describeRunningPage(page, extra.steps ?? null, extra.verdict ?? null);
    case "braucht_sie": {
      const blocking = page.questions.filter((q) => q.blocking).length;
      const n = blocking || page.questions.length;
      return n > 0
        ? `${n} ${n === 1 ? "Frage" : "Fragen"} an den Kunden, bevor es weitergeht`
        : "Wartet auf Ihre Freigabe";
    }
    case "in_arbeit":
      if (page.error) return `Fehler in Schritt ${page.step ?? "?"}: ${page.error}`;
      return page.step ? `Pausiert nach Schritt ${page.step}: ${stepName}` : "Pausiert";
    case "fertig":
      return page.released ? "Freigegeben" : "Wartet auf Freigabe";
    default:
      return null;
  }
}

export function pageSummary(page: ContentPageRow, extra: ContentPageExtra = {}): ContentPageSummary {
  const cost = num(page.cost_eur);
  return {
    name: page.name,
    slug: page.slug,
    level: page.level,
    path: page.path,
    source: page.source,
    source_url: page.source_url,
    main_keyword: page.keywords?.main.text ?? page.main_keyword,
    page_type: page.page_type,
    page_role: page.page_role,
    user_questions: page.user_questions.length,
    started: page.state !== "nicht_begonnen",
    state: page.state,
    label: STATE_LABELS[page.state] ?? page.state,
    detail: pageDetail(page, extra),
    step: page.step,
    cost_eur: cost,
    cost: formatEur(cost),
    questions: page.state === "braucht_sie" ? page.questions.length : 0,
    released: page.released,
    updated_at: page.state === "nicht_begonnen" ? null : page.updated_at,
  };
}

export function buildOverview(
  readiness: ContentReadiness,
  rows: ContentPageRow[],
  extras: ReadonlyMap<string, ContentPageExtra> = new Map(),
): ContentOverview {
  const pages = rows.map((row) => pageSummary(row, extras.get(row.id) ?? {}));
  const costEur = Math.round(pages.reduce((sum, p) => sum + p.cost_eur, 0) * 100) / 100;
  return {
    readiness,
    pages,
    needs_you: pages.filter((p) => p.state === "braucht_sie").length,
    finished: pages.filter((p) => p.state === "fertig").length,
    running: pages.filter((p) => p.state === "laeuft").length,
    cost_eur: costEur,
    cost: formatEur(costEur),
  };
}

/** Which step a rerun-with-note restarts at for the current state. */
export function rerunStepFor(page: ContentPageRow): number {
  if (page.state === "braucht_sie") return CONTENT_STEP_FAKTENCHECK;
  if (page.state === "fertig") return CONTENT_STEP_LEKTORAT;
  return page.step ?? 1;
}

/**
 * „Zurücksetzen“ is offered on every started page and „Löschen“ on every page: the way out
 * of any state, and the way to prune a table, by hand.
 */
export function pageActions(page: ContentPageRow): ContentAction[] {
  const exportAction: ContentAction[] = page.html ? [{ kind: "export", label: "Exportieren" }] : [];
  const reset: ContentAction = { kind: "reset", label: "Zurücksetzen" };
  const remove: ContentAction = { kind: "delete", label: "Löschen" };
  switch (page.state) {
    case "nicht_begonnen":
      // „Nicht bearbeiten“ (Impressum, Kontakt …) gets no start button; the type select in the drawer frees it.
      return page.page_type === "nicht_bearbeiten"
        ? [remove]
        : [{ kind: "run_through", label: "Weiterlaufen lassen" }, remove];
    case "laeuft":
      return [{ kind: "stop", label: "Stoppen" }, reset, remove];
    case "braucht_sie":
      return [
        { kind: "approve", step: CONTENT_STEP_FAKTENCHECK, label: "Freigeben" },
        { kind: "edit", step: CONTENT_STEP_FAKTENCHECK, label: "Abschnitt ändern" },
        { kind: "rerun_with_note", step: CONTENT_STEP_FAKTENCHECK, label: "Mit Anmerkung wiederholen" },
        ...exportAction,
        reset,
        remove,
      ];
    case "in_arbeit":
      return [
        { kind: "run_through", label: "Weiterlaufen lassen" },
        ...(page.html ? [{ kind: "edit" as const, step: rerunStepFor(page), label: "Abschnitt ändern" }] : []),
        { kind: "rerun_with_note", step: rerunStepFor(page), label: "Mit Anmerkung wiederholen" },
        ...exportAction,
        reset,
        remove,
      ];
    case "fertig":
      return page.released
        ? [...exportAction, reset, remove]
        : [
            { kind: "approve", step: CONTENT_STEP_ENDABNAHME, label: "Freigeben" },
            { kind: "edit", step: CONTENT_STEP_LEKTORAT, label: "Abschnitt ändern" },
            { kind: "rerun_with_note", step: CONTENT_STEP_LEKTORAT, label: "Mit Anmerkung wiederholen" },
            ...exportAction,
            reset,
            remove,
          ];
    default:
      return [];
  }
}

export function stepList(steps: ContentStepRow[]): ContentStep[] {
  return CONTENT_STEPS.map((def) => {
    const row = steps.find((s) => s.step === def.step);
    const status: ContentStepStatus = row?.status ?? "pending";
    return {
      step: def.step,
      name: def.name,
      status,
      exists: Boolean(row) && status !== "pending",
      cost_eur: num(row?.cost_eur),
    };
  });
}

/** The compact briefing line of the drawer: type, keyword, questions, silo. */
export function pageBriefing(page: ContentPageRow): ContentPageBriefing {
  return {
    source: page.source,
    page_type: page.page_type ?? effectiveContentPageType(page),
    type_editable: canEditContentPageType(page),
    page_role: page.page_role,
    pillar_name: page.pillar_name,
    main_keyword: page.keywords?.main.text ?? page.main_keyword,
    main_keyword_volume: page.keywords?.main.volume ?? null,
    secondary_keywords: page.keywords?.secondary.map((k) => k.text) ?? [],
    h1_options: page.h1_options,
    user_questions: page.user_questions,
    ki_prompt: page.ki_prompt,
    internal_link_targets: page.internal_link_targets,
    estimated_traffic: page.estimated_traffic,
  };
}

export function buildReview(
  page: ContentPageRow,
  steps: ContentStepRow[],
  verdict: ContentJobVerdict | null = null,
): ContentReview {
  const textSteps = steps
    .filter((s) => s.status === "done" && CONTENT_STEPS.find((d) => d.step === s.step)?.writesText)
    .map((s) => s.step);
  const summary = pageSummary(page, { steps, verdict });
  return {
    name: page.name,
    briefing: pageBriefing(page),
    legacy_steps: hasLegacyContentSteps(steps),
    public: {
      state: page.state,
      label: summary.label,
      detail: summary.detail,
      step: page.step,
      cost: summary.cost,
      released: page.released,
    },
    text_step: page.html ? (textSteps.length ? Math.max(...textSteps) : null) : null,
    markdown: page.markdown,
    html: page.html,
    findings: page.findings,
    final_findings: page.final_findings,
    unresolved: page.unresolved,
    questions: page.state === "braucht_sie" ? page.questions : [],
    steps: stepList(steps),
    actions: pageActions(page),
  };
}
