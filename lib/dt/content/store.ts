/**
 * Reads and writes for the content tables (`dt_content_settings`, `dt_content_pages`,
 * `dt_content_steps`) and the response objects the Texte tab consumes. Always called with
 * the service client: routes check access first (`gateContentRoute`), the job runner has none.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContentAnrede, ContentBranche, ContentTextSettings } from "@/lib/dt/content/mapping";
import { cleanTextSettings } from "@/lib/dt/content/mapping";
import { CONTENT_STEPS, contentStepName, runningPageDetail } from "@/lib/dt/content/pipeline/steps";
import { formatEur } from "@/lib/dt/content/presentation";
import { planManualContentPages, type ManualPageDraft } from "@/lib/dt/content/manual-pages";
import { slugify } from "@/lib/dt/content/render";
import { parseWebsiteStructure, type WebsiteStructureNode } from "@/lib/dt/seo/website-structure";
import type {
  ContentAction,
  ContentFinding,
  ContentOverview,
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
  main_keyword: string | null;
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

export const PAGE_COLUMNS =
  "id, organisation_id, slug, name, path, level, position, main_keyword, state, step, released, released_at, title, meta_description, html, markdown, findings, final_findings, unresolved, questions, notes, error, job_id, cost_eur, started_by, created_at, updated_at";

/** Light projection for the overview table (no HTML). */
const SUMMARY_COLUMNS =
  "id, organisation_id, slug, name, path, level, position, main_keyword, state, step, released, released_at, title, meta_description, findings, final_findings, unresolved, questions, notes, error, job_id, cost_eur, started_by, created_at, updated_at";

const STEP_COLUMNS =
  "id, page_id, organisation_id, step, name, status, output, model, input_tokens, output_tokens, cost_eur, error, started_at, finished_at, approved_by, approved_at";

const MAX_PAGES = 300;

export const CONTENT_MIGRATION_FILE = "database/migrations/20261006_dt_content_pipeline.sql";

/** PostgREST answers PGRST205 when a table is not in its schema cache, i.e. the migration never ran. */
export function isMissingContentTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message ?? "");
}

export function contentDbErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
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

function normalizePageRow(raw: Record<string, unknown>): ContentPageRow {
  return {
    ...(raw as unknown as ContentPageRow),
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
  const { data } = await service
    .from("dt_content_pages")
    .select(PAGE_COLUMNS)
    .eq("organisation_id", organisationId)
    .eq("slug", slug)
    .maybeSingle();
  return data ? normalizePageRow(data as Record<string, unknown>) : null;
}

export async function loadContentPageById(
  service: SupabaseClient,
  pageId: string,
): Promise<ContentPageRow | null> {
  const { data } = await service.from("dt_content_pages").select(PAGE_COLUMNS).eq("id", pageId).maybeSingle();
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

export async function loadContentSteps(service: SupabaseClient, pageId: string): Promise<ContentStepRow[]> {
  const { data } = await service
    .from("dt_content_steps")
    .select(STEP_COLUMNS)
    .eq("page_id", pageId)
    .order("step", { ascending: true });
  return (data ?? []) as ContentStepRow[];
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

/**
 * Creates page rows for the uploaded structure. Runs only when the upload is newer than the
 * last sync (`structure_uploaded_at` on the rows), so polling the overview stays cheap.
 * Existing pages keep their text; only name/path/level/position follow the upload.
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

  let flat: FlatPage[];
  try {
    flat = flattenStructure(parseWebsiteStructure(structure.raw_text as string).nodes);
  } catch {
    return { synced: false, pages: 0 };
  }
  if (flat.length === 0) return { synced: false, pages: 0 };

  const rows = flat.map((p) => ({ organisation_id: organisationId, structure_uploaded_at: uploadedAt, ...p }));
  const { error } = await service
    .from("dt_content_pages")
    .upsert(rows, { onConflict: "organisation_id,slug" });
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht angelegt werden"));
  return { synced: true, pages: rows.length };
}

/**
 * Adds pages the user typed. Inserts new slugs only: an existing page keeps its text,
 * keyword and `structure_uploaded_at` (null on these rows, so a later Excel upload still syncs).
 */
export async function upsertManualContentPages(
  service: SupabaseClient,
  organisationId: string,
  pages: readonly ManualPageDraft[],
): Promise<{ inserted: number }> {
  const { data, error } = await service
    .from("dt_content_pages")
    .select("slug, position")
    .eq("organisation_id", organisationId)
    .limit(MAX_PAGES);
  if (error) throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"));

  const planned = planManualContentPages((data ?? []) as { slug: string; position?: number | null }[], pages);
  if (planned.length === 0) return { inserted: 0 };

  const rows = planned.map((page) => ({
    organisation_id: organisationId,
    slug: page.slug,
    name: page.name,
    path: null,
    level: page.level,
    position: page.position,
    main_keyword: page.main_keyword,
  }));
  const { error: insertError } = await service.from("dt_content_pages").insert(rows);
  if (insertError) throw new Error(contentDbErrorMessage(insertError, "Seiten konnten nicht angelegt werden"));
  return { inserted: rows.length };
}

// --- presentation -----------------------------------------------------------------------------

const STATE_LABELS: Record<ContentPageState, string> = {
  nicht_begonnen: "Nicht begonnen",
  laeuft: "Läuft",
  in_arbeit: "In Arbeit",
  braucht_sie: "Braucht Sie",
  fertig: "Fertig",
};

export function pageDetail(page: ContentPageRow): string | null {
  const stepName = contentStepName(page.step);
  switch (page.state) {
    case "laeuft":
      return page.step ? `Schritt ${page.step} von ${CONTENT_STEPS.length}: ${stepName} läuft` : "Startet …";
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

export function pageSummary(page: ContentPageRow): ContentPageSummary {
  const cost = num(page.cost_eur);
  return {
    name: page.name,
    slug: page.slug,
    level: page.level,
    main_keyword: page.main_keyword,
    started: page.state !== "nicht_begonnen",
    state: page.state,
    label: STATE_LABELS[page.state] ?? page.state,
    detail: pageDetail(page),
    step: page.step,
    cost_eur: cost,
    cost: formatEur(cost),
    questions: page.state === "braucht_sie" ? page.questions.length : 0,
    released: page.released,
    updated_at: page.state === "nicht_begonnen" ? null : page.updated_at,
  };
}

export function buildOverview(readiness: ContentReadiness, rows: ContentPageRow[]): ContentOverview {
  const pages = rows.map(pageSummary);
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
  if (page.state === "braucht_sie") return 4;
  if (page.state === "fertig") return 7;
  return page.step ?? 1;
}

export function pageActions(page: ContentPageRow): ContentAction[] {
  const exportAction: ContentAction[] = page.html ? [{ kind: "export", label: "Exportieren" }] : [];
  switch (page.state) {
    case "nicht_begonnen":
      return [{ kind: "run_through", label: "Weiterlaufen lassen" }];
    case "laeuft":
      return [];
    case "braucht_sie":
      return [
        { kind: "approve", step: 4, label: "Freigeben" },
        { kind: "edit", step: 4, label: "Abschnitt ändern" },
        { kind: "rerun_with_note", step: 4, label: "Mit Anmerkung wiederholen" },
        ...exportAction,
      ];
    case "in_arbeit":
      return [
        { kind: "run_through", label: "Weiterlaufen lassen" },
        ...(page.html ? [{ kind: "edit" as const, step: rerunStepFor(page), label: "Abschnitt ändern" }] : []),
        { kind: "rerun_with_note", step: rerunStepFor(page), label: "Mit Anmerkung wiederholen" },
        ...exportAction,
      ];
    case "fertig":
      return page.released
        ? exportAction
        : [
            { kind: "approve", step: 8, label: "Freigeben" },
            { kind: "edit", step: 7, label: "Abschnitt ändern" },
            { kind: "rerun_with_note", step: 7, label: "Mit Anmerkung wiederholen" },
            ...exportAction,
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

export function buildReview(page: ContentPageRow, steps: ContentStepRow[]): ContentReview {
  const textSteps = steps
    .filter((s) => s.status === "done" && CONTENT_STEPS.find((d) => d.step === s.step)?.writesText)
    .map((s) => s.step);
  const summary = pageSummary(page);
  return {
    name: page.name,
    public: {
      state: page.state,
      label: summary.label,
      detail: page.state === "laeuft" ? runningPageDetail(page.step, steps) : summary.detail,
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
