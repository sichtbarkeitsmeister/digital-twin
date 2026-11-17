/**
 * „Verbesserung → Texte hochladen“, step 2 of the matching: for the Word files the name rule
 * (`pageNameKey`) could not assign, a model finds the page of the Seitenstruktur by the meaning
 * of the file name: special letters, typos, another spelling or word order, abbreviations,
 * added or missing words, numbering, „(1)“, „Kopie“, „final“, dates.
 *
 * It never runs inside `matchTextUploads` / `syncTextUploadMatches` (those run on every read),
 * only through `POST /api/dt/content/uploads/ai-match`. Its assignments are stored as
 * `match: "ai"`; the pure matching keeps or releases them afterwards, and every one can be
 * changed or removed by hand (`assignTextUpload`), which then wins.
 *
 * All or nothing: a call that fails or whose answer was cut off assigns nothing, so the files
 * stay „nicht zugeordnet“ for the manual assignment.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContentBriefingPage } from "@/lib/dt/content/excel-structure";
import { loadContentMatchModels } from "@/lib/dt/content/model-config-db";
import { contentPageTypeLabel } from "@/lib/dt/content/page-types";
import { callContentTool } from "@/lib/dt/content/pipeline/llm";
import { normalizeBlocks, type ContentTextBlock } from "@/lib/dt/content/render";
import {
  UPLOAD_AI_MATCH_MIGRATION_MESSAGE,
  syncTextUploadMatches,
  textUploadsDbErrorMessage,
  type TextUploadActionResult,
  type TextUploadMatchState,
} from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadAiRun } from "@/lib/dt/content/types";
import { UPLOAD_AI_CONFLICT_NOTE, UPLOAD_AI_NO_PAGE_NOTE, aiMatchCandidateIds } from "@/lib/dt/content/upload-match";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

export const UPLOAD_AI_MATCH_USAGE_MODE = "content.upload_match";
/** Files per call; more candidates are sent as several calls at the same time. */
export const UPLOAD_AI_MATCH_CHUNK = 60;
export const UPLOAD_AI_MATCH_TIMEOUT_MS = 60_000;
/** Title and first headings of a file, as extra evidence next to its name. */
const EVIDENCE_MAX_CHARS = 300;
const REASON_MAX_CHARS = 240;
const TOOL_NAME = "zuordnung_melden";

/** A file as the model sees it. `ref` („f1“ …) stands for the row id: short, and nothing to mistype. */
export type UploadAiMatchFile = { ref: string; file_name: string; title: string | null; headings: string[] };

export type UploadAiMatchPage = Pick<ContentBriefingPage, "slug" | "name" | "path" | "level" | "page_role" | "page_type" | "pillar_name">;

export type UploadAiMatchOutcome =
  | { kind: "page"; slug: string; reason: string | null }
  /** No page: the model said so, named a slug that was not offered, or left the file out. */
  | { kind: "none" }
  /** The model named this file's page for another file too. */
  | { kind: "conflict" };

export type UploadAiMatchCall = (input: {
  models: string[];
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  timeoutMs: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }>;

/** The document title and the first headings of the stored sections, about 300 characters in all. */
export function uploadEvidence(title: string | null, blocks: readonly ContentTextBlock[]): Pick<UploadAiMatchFile, "title" | "headings"> {
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const shownTitle = clean(title).slice(0, EVIDENCE_MAX_CHARS) || null;
  let left = EVIDENCE_MAX_CHARS - (shownTitle?.length ?? 0);
  const headings: string[] = [];
  for (const block of blocks) {
    const heading = clean(block.heading);
    if (!heading || heading === shownTitle || headings.includes(heading)) continue;
    if (heading.length > left) break;
    headings.push(heading);
    left -= heading.length;
  }
  return { title: shownTitle, headings };
}

const ROLE_LABEL: Record<NonNullable<ContentBriefingPage["page_role"]>, string> = {
  startseite: "Startseite",
  pillar: "Hauptsilo",
  supporting: "Unterseite",
};

const SYSTEM_PROMPT = `Du ordnest hochgeladene Word-Dateien den Seiten einer Website-Struktur zu.

Jede Datei enthält den bisherigen Text genau einer Seite. Ihr Dateiname soll der Seitenname sein, wurde aber von Menschen vergeben und weicht deshalb oft ab. Die exakten Treffer hat eine feste Regel bereits zugeordnet: Du bekommst nur die Dateien, die übrig geblieben sind, und nur die Seiten, die noch keine Datei haben.

Abweichungen, hinter denen dieselbe Seite steht: Umlaute und Sonderzeichen (ä/ae, ß/ss, &/und), Tippfehler, andere Schreibweise oder Wortstellung, Abkürzungen, zusätzliche oder fehlende Wörter wie „Leistungen“, „Seite“, „Text“ oder der Firmenname, Nummerierungen („01_“, „3.2“), Zusätze wie „(1)“, „Kopie“, „final“, „v2“, „neu“ und Datumsangaben.

Regeln:
- Entscheide nach der Bedeutung des Dateinamens. Titel und Überschriften der Datei sind zusätzliche Hinweise, wenn der Name allein nicht reicht.
- Mehrere Seiten können gleich heißen, zum Beispiel „Kosten“ unter verschiedenen Hauptsilos. Unterscheide sie über Pfad, Ebene und Hauptsilo. Lässt weder der Dateiname noch der Inhalt erkennen, welche gemeint ist, gib null zurück.
- Gib null zurück, wenn nicht klar ist, dass Datei und Seite dieselbe Seite meinen. Eine fehlende Zuordnung holt ein Mensch in Sekunden nach; eine falsche fällt erst auf, wenn der falsche Text überarbeitet wurde.
- Nie zwei Dateien auf dieselbe Seite. Passen zwei Dateien zu einer Seite, ordne nur die eindeutig bessere zu und gib für die andere null zurück.
- Verwende nur Slugs aus der Seitenliste, genau so geschrieben. Erfinde keine Slugs.
- Melde für jede Datei genau einen Eintrag, mit einer Begründung in einem kurzen deutschen Satz.`;

const MATCH_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Meldet für jede Datei die Seite der Seitenstruktur, zu der sie gehört, oder null.",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        description: "Ein Eintrag je Datei.",
        items: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "Die Kennung der Datei aus der Dateiliste, z. B. f3." },
            page_slug: { type: ["string", "null"], description: "Der Slug der Seite aus der Seitenliste, oder null, wenn keine Seite klar passt." },
            reason: { type: "string", description: "Begründung in einem kurzen deutschen Satz." },
          },
          required: ["file_id", "page_slug", "reason"],
        },
      },
    },
    required: ["matches"],
  },
};

/** One call: the free pages (with path, level, role and Hauptsilo) and one chunk of files. */
export function uploadAiMatchPrompt(
  files: readonly UploadAiMatchFile[],
  pages: readonly UploadAiMatchPage[],
): { system: string; user: string; tool: Anthropic.Tool; maxTokens: number } {
  const pageLines = pages.map((p) =>
    JSON.stringify({
      slug: p.slug,
      name: p.name,
      ...(p.path ? { pfad: p.path } : {}),
      ebene: p.level,
      rolle: ROLE_LABEL[p.page_role],
      ...(p.pillar_name ? { hauptsilo: p.pillar_name } : {}),
      typ: contentPageTypeLabel(p.page_type),
    }),
  );
  const fileLines = files.map((f) =>
    JSON.stringify({
      file_id: f.ref,
      datei: f.file_name,
      ...(f.title ? { titel: f.title } : {}),
      ...(f.headings.length > 0 ? { ueberschriften: f.headings } : {}),
    }),
  );
  const user = [
    `## Freie Seiten der Seitenstruktur (${pages.length})`,
    "Seiten vom Typ „Nicht bearbeiten“ bekommen keinen neuen Text, können aber eine Datei haben.",
    ...pageLines,
    "",
    `## Dateien ohne Zuordnung (${files.length})`,
    ...fileLines,
  ].join("\n");
  // A row of the answer is a short id, a slug and one sentence.
  return { system: SYSTEM_PROMPT, user, tool: MATCH_TOOL, maxTokens: Math.min(8_000, 500 + files.length * 110) };
}

/**
 * The model's answers checked in code, over all calls of one run: a slug must be one of the
 * offered pages; a page named for two files goes to neither; null, an unknown slug or a file
 * the answer leaves out is „no page“. Pure.
 */
export function validateUploadAiMatches(
  answers: readonly unknown[],
  refs: readonly string[],
  offeredSlugs: ReadonlySet<string>,
): Map<string, UploadAiMatchOutcome> {
  const known = new Set(refs);
  const proposed = new Map<string, { slug: string; reason: string | null }>();
  const seen = new Set<string>();
  for (const answer of answers) {
    const matches = (answer as { matches?: unknown } | null)?.matches;
    for (const entry of Array.isArray(matches) ? matches : []) {
      if (!entry || typeof entry !== "object") continue;
      const { file_id, page_slug, reason } = entry as Record<string, unknown>;
      const ref = typeof file_id === "string" ? file_id.trim() : "";
      // The first entry of a file counts.
      if (!known.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      const slug = typeof page_slug === "string" ? page_slug.trim() : "";
      if (!slug || !offeredSlugs.has(slug)) continue;
      const why = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim().slice(0, REASON_MAX_CHARS) : "";
      proposed.set(ref, { slug, reason: why || null });
    }
  }
  const claims = new Map<string, number>();
  for (const { slug } of proposed.values()) claims.set(slug, (claims.get(slug) ?? 0) + 1);
  const outcomes = new Map<string, UploadAiMatchOutcome>();
  for (const ref of refs) {
    const hit = proposed.get(ref);
    if (!hit) outcomes.set(ref, { kind: "none" });
    else if ((claims.get(hit.slug) ?? 0) > 1) outcomes.set(ref, { kind: "conflict" });
    else outcomes.set(ref, { kind: "page", ...hit });
  }
  return outcomes;
}

function fail(status: number, message: string): { ok: false; status: number; message: string } {
  return { ok: false, status, message };
}

/** The pages of the Seitenstruktur no file has, „Nicht bearbeiten“ pages included. */
function freePages(state: TextUploadMatchState): ContentBriefingPage[] {
  const taken = new Set([...state.results.values()].map((r) => r.structure_slug).filter(Boolean));
  return (state.pages ?? []).filter((p) => !taken.has(p.slug));
}

async function loadEvidence(
  service: SupabaseClient,
  organisationId: string,
  ids: readonly string[],
): Promise<Map<string, Pick<UploadAiMatchFile, "title" | "headings">>> {
  const out = new Map<string, Pick<UploadAiMatchFile, "title" | "headings">>();
  // The sections of a file can be long: a few files per read.
  for (let i = 0; i < ids.length; i += 25) {
    const { data, error } = await service
      .from("dt_content_text_uploads")
      .select("id, title, blocks")
      .eq("organisation_id", organisationId)
      .in("id", ids.slice(i, i + 25));
    if (error) throw new Error(textUploadsDbErrorMessage(error, "Hochgeladene Texte konnten nicht geladen werden"));
    for (const row of (data ?? []) as unknown as Array<{ id: string; title: unknown; blocks: unknown }>) {
      out.set(String(row.id), uploadEvidence(typeof row.title === "string" ? row.title : null, normalizeBlocks(row.blocks)));
    }
  }
  return out;
}

const NOTHING_TO_DO: ContentTextUploadAiRun = { tried: 0, assigned: 0, conflicts: 0, model: null };

/**
 * The AI step. Candidates (`aiMatchCandidateIds`): readable files the name rule left „nicht
 * zugeordnet“ or „mehrdeutig“, not taken off a page by hand, and not tried since the
 * Seitenstruktur was uploaded; with `force` also the ones tried before. They are offered the
 * free pages only. On success a file gets `match: "ai"` with the model's reason; a file without
 * a page gets `ai_tried_at` and a note. Nothing is written when a call fails.
 */
export async function aiMatchTextUploads(
  service: SupabaseClient,
  organisationId: string,
  options: { force?: boolean; userId?: string | null; call?: UploadAiMatchCall; models?: string[] } = {},
): Promise<TextUploadActionResult<ContentTextUploadAiRun>> {
  const state = await syncTextUploadMatches(service, organisationId);
  if (!state.aiSupported) return fail(409, UPLOAD_AI_MATCH_MIGRATION_MESSAGE);
  if (!state.pages) return fail(400, "Bitte zuerst die Seitenstruktur hochladen: erst dann lassen sich die Dateien Seiten zuordnen.");

  const candidateIds = aiMatchCandidateIds(state.uploads, [...state.results.values()], state.uploadedAt, options.force ?? false);
  const pages = freePages(state);
  if (candidateIds.length === 0 || pages.length === 0) return { ok: true, data: NOTHING_TO_DO };

  const evidence = await loadEvidence(service, organisationId, candidateIds);
  const uploadById = new Map(state.uploads.map((u) => [u.id, u]));
  const idByRef = new Map<string, string>();
  const files: UploadAiMatchFile[] = candidateIds.map((id, index) => {
    const ref = `f${index + 1}`;
    idByRef.set(ref, id);
    return { ref, file_name: uploadById.get(id)!.file_name, ...(evidence.get(id) ?? { title: null, headings: [] }) };
  });

  const models = options.models ?? (await loadContentMatchModels(service));
  const call: UploadAiMatchCall = options.call ?? ((input) => callContentTool({ ...input, toolLabel: "Texte" }));
  const chunks: UploadAiMatchFile[][] = [];
  for (let i = 0; i < files.length; i += UPLOAD_AI_MATCH_CHUNK) chunks.push(files.slice(i, i + UPLOAD_AI_MATCH_CHUNK));
  // `callContentTool` throws on a missing key, an API error, a timeout and an answer that was cut off.
  const settled = await Promise.allSettled(
    chunks.map((chunk) => call({ models, ...uploadAiMatchPrompt(chunk, pages), timeoutMs: UPLOAD_AI_MATCH_TIMEOUT_MS })),
  );
  const answers = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  // A call that answered is billed, also when another one failed.
  await Promise.all(
    answers.map((answer) =>
      recordLlmUsageEvent(service, {
        organisationId,
        userId: options.userId ?? null,
        mode: UPLOAD_AI_MATCH_USAGE_MODE,
        via: "direct",
        model: answer.model,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
      }).catch((error: unknown) => console.warn("[content.upload_match] usage not recorded:", error instanceof Error ? error.message : error)),
    ),
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) {
    const reason = failed.reason instanceof Error && failed.reason.message.trim() ? failed.reason.message.trim() : "KI-Aufruf fehlgeschlagen.";
    return fail(502, `Die KI-Zuordnung ist fehlgeschlagen, es wurde nichts zugeordnet: ${reason}`);
  }

  const outcomes = validateUploadAiMatches(
    answers.map((a) => a.json),
    files.map((f) => f.ref),
    new Set(pages.map((p) => p.slug)),
  );

  // The call took a while: write only onto files that are still open and pages that are still free.
  const fresh = await syncTextUploadMatches(service, organisationId);
  const stillOpen = new Set(aiMatchCandidateIds(fresh.uploads, [...fresh.results.values()], fresh.uploadedAt, true));
  const stillFree = new Set(freePages(fresh).map((p) => p.slug));
  const triedAt = new Date().toISOString();
  const run: ContentTextUploadAiRun = { tried: 0, assigned: 0, conflicts: 0, model: answers[0]?.model ?? null };
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
  for (const [ref, outcome] of outcomes) {
    const id = idByRef.get(ref)!;
    if (!stillOpen.has(id)) continue;
    if (outcome.kind === "page") {
      if (!stillFree.has(outcome.slug)) continue;
      run.assigned += 1;
      writes.push({ id, patch: { structure_slug: outcome.slug, match: "ai", match_note: null, ai_reason: outcome.reason, ai_tried_at: null } });
    } else {
      if (outcome.kind === "conflict") run.conflicts += 1;
      const note = outcome.kind === "conflict" ? UPLOAD_AI_CONFLICT_NOTE : UPLOAD_AI_NO_PAGE_NOTE;
      writes.push({ id, patch: { match_note: note, ai_reason: null, ai_tried_at: triedAt } });
    }
    run.tried += 1;
  }
  for (let i = 0; i < writes.length; i += 10) {
    const done = await Promise.all(
      writes.slice(i, i + 10).map((w) => service.from("dt_content_text_uploads").update(w.patch).eq("organisation_id", organisationId).eq("id", w.id)),
    );
    const error = done.find((d) => d.error)?.error;
    if (error) return fail(500, textUploadsDbErrorMessage(error, "KI-Zuordnung konnte nicht gespeichert werden"));
  }
  return { ok: true, data: run };
}
