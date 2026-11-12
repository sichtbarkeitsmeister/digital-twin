/**
 * The server side of „Abschnitt überarbeiten lassen“ and of the open points' buttons: the preview
 * (one Claude call, checked in code; after the Watermark Entfernung the Abschnitt also goes through
 * Grok on its own), taking it over, and „So lassen“. Every call is billed on the page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ContentLlmError, callContentTool } from "@/lib/dt/content/pipeline/llm";
import { loadContentModelConfig } from "@/lib/dt/content/model-config-db";
import { emptyRephraseProgress } from "@/lib/dt/content/pipeline/rephrase";
import { rephraseProtectedTerms } from "@/lib/dt/content/pipeline/rephrase-guard";
import { audienceBudget, audienceBudgetMessage } from "@/lib/dt/content/zielgruppen";
import { runRephraseOnBlocks } from "@/lib/dt/content/pipeline/rephrase-runner";
import {
  REVISE_MAX_TOKENS,
  REVISE_TOOL,
  REVISE_USAGE_MODE,
  checkRevision,
  findingKey,
  revisionAllowedText,
  revisionNote,
  revisionPrompt,
  withoutFinding,
  type ContentRevisionRequest,
} from "@/lib/dt/content/pipeline/revise";
import type { ContentPipelineContext } from "@/lib/dt/content/pipeline/prompts";
import { findingCheckPlaceholders, kundePrueftNoteLine, kundePrueftQuestionsInNotes } from "@/lib/dt/content/pipeline/kunde-prueft";
import { findingTargetBlocks } from "@/lib/dt/content/finding-target";
import { CONTENT_KEPT_FINDINGS_MAX, readQuestionStop } from "@/lib/dt/content/pipeline/question-stop";
import { loadContext } from "@/lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_WATERMARK } from "@/lib/dt/content/pipeline/steps";
import { estimateCostEur, roundEur } from "@/lib/dt/content/pricing";
import { ContentTextLimitError, htmlToMarkdown, normalizeBlocks, parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import { contentDbErrorMessage, num, type ContentPageRow, type ContentStepRow } from "@/lib/dt/content/store";
import type { ContentFinding } from "@/lib/dt/content/types";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";

const REVISE_TIMEOUT_MS = 180_000;
const REVISE_WATERMARK_MS = 90_000;

export type RevisionInput = {
  block_id: string;
  instruction?: string | null;
  info?: string | null;
  finding_key?: string | null;
  /** „Jetzt umsetzen“: several open points on this Abschnitt, all proposals at once. */
  finding_keys?: string[] | null;
  /**
   * Of `finding_keys`, the points that go once this Abschnitt is taken over. A point about several
   * Abschnitte goes with its last one; defaults to all of `finding_keys`.
   */
  done_keys?: string[] | null;
};

type Failure = { ok: false; status: number; message: string; reasons?: string[]; cost_eur?: number };

export type RevisionPreview =
  | { ok: true; before: ContentTextBlock; after: ContentTextBlock; watermark: boolean; cost_eur: number }
  | Failure;

/** Why a page cannot be revised now; null when it can. */
export function revisionBlocker(page: Pick<ContentPageRow, "state" | "html">): string | null {
  if (page.state === "laeuft") return "Die Seite läuft gerade. Bitte warten, bis der Schritt fertig ist, oder „Stoppen“.";
  if (!page.html) return "Für diese Seite gibt es noch keinen Text.";
  return null;
}

function findingOf(page: Pick<ContentPageRow, "findings" | "final_findings" | "unresolved">, key: string | null | undefined): ContentFinding | null {
  if (!key) return null;
  return [...page.findings, ...page.final_findings, ...page.unresolved].find((f) => findingKey(f) === key) ?? null;
}

function requestOf(page: ContentPageRow, input: RevisionInput): ContentRevisionRequest | Failure {
  if (input.finding_keys && input.finding_keys.length > 0) {
    const found = input.finding_keys.map((key) => findingOf(page, key));
    if (found.some((f) => !f)) return { ok: false, status: 409, message: "Einen dieser offenen Punkte gibt es nicht mehr. Bitte die Seite neu laden." };
    const findings = found as ContentFinding[];
    return { instruction: input.instruction?.trim() || null, info: null, finding: findings.length === 1 ? findings[0]! : null, findings };
  }
  const finding = findingOf(page, input.finding_key);
  if (input.finding_key && !finding) return { ok: false, status: 409, message: "Diesen offenen Punkt gibt es nicht mehr. Bitte die Seite neu laden." };
  const request: ContentRevisionRequest = { instruction: input.instruction?.trim() || null, info: input.info?.trim() || null, finding };
  if (!request.instruction && !request.info && !request.finding) return { ok: false, status: 400, message: "Bitte beschreiben, was am Abschnitt anders werden soll." };
  return request;
}

/** One revision as a preview: nothing is stored on the text, the cost is on the page. */
export async function previewRevision(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
  input: RevisionInput,
  userId: string | null,
  deps: {
    callTool?: typeof callContentTool;
    rephrase?: typeof runRephraseOnBlocks;
    /** Tests hand in the prompt context (the loader reads services); the route always loads it. */
    context?: { context: ContentPipelineContext; avatarId: string | null };
    models?: string[];
  } = {},
): Promise<RevisionPreview> {
  const blocker = revisionBlocker(page);
  if (blocker) return { ok: false, status: 409, message: blocker };
  const before = parseBlocksFromHtml(page.html).find((b) => b.id === input.block_id);
  if (!before) return { ok: false, status: 404, message: "Diesen Abschnitt gibt es im Text nicht (mehr)." };
  const request = requestOf(page, input);
  if ("ok" in request) return request;

  const { context, avatarId } = deps.context ?? (await loadContext(service, page, steps));
  if (context.audience) {
    const budget = audienceBudget(context.audience);
    if (budget.over) return { ok: false, status: 422, message: audienceBudgetMessage(budget) };
  }
  const prompt = revisionPrompt(context, before, request);
  const models = deps.models ?? (await loadContentModelConfig(service)).write;
  const call = await (deps.callTool ?? callContentTool)({
    models,
    system: prompt.system,
    user: prompt.user,
    tool: REVISE_TOOL,
    maxTokens: REVISE_MAX_TOKENS,
    timeoutMs: REVISE_TIMEOUT_MS,
  });
  let costEur = estimateCostEur(call.model, call.usage);
  await recordLlmUsageEvent(service, {
    organisationId: page.organisation_id,
    userId,
    agentId: avatarId,
    mode: REVISE_USAGE_MODE,
    via: "direct",
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  });

  const checked = checkRevision(call.json, before, request, revisionAllowedText(context));
  let after = checked.ok ? checked.block : null;

  // After the Watermark Entfernung the text is Grok's: the revised Abschnitt goes through it too,
  // so the preview is what the page will say.
  const watermarkDone = steps.some((s) => s.step === CONTENT_STEP_WATERMARK && s.status === "done");
  let watermark = false;
  if (after && watermarkDone && after.html.trim() && after.html.trim() !== before.html.trim()) {
    const progress = emptyRephraseProgress(1);
    const run = await (deps.rephrase ?? runRephraseOnBlocks)(context, [after], {
      progress,
      deadline: Date.now() + REVISE_WATERMARK_MS,
      keepOnEmpty: true,
      // Grok must keep what the checked revision says; otherwise the revision stays as Claude wrote it.
      guard: { terms: rephraseProtectedTerms(context) },
      onUsage: (usage) =>
        recordLlmUsageEvent(service, {
          organisationId: page.organisation_id,
          userId,
          agentId: avatarId,
          mode: `${REVISE_USAGE_MODE}.watermark`,
          via: "direct",
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      save: async () => undefined,
    });
    costEur += progress.cost_eur;
    if (run.state === "done" && !progress.rejected?.length) {
      after = run.blocks[0] ?? after;
      watermark = true;
    }
  }

  costEur = roundEur(costEur);
  await service.from("dt_content_pages").update({ cost_eur: roundEur(num(page.cost_eur) + costEur) }).eq("id", page.id);
  if (!after) {
    return { ok: false, status: 422, message: "Der Vorschlag der KI hält die Regeln nicht ein und wurde verworfen. Bitte den Auftrag genauer fassen und erneut versuchen.", reasons: checked.ok ? [] : checked.reasons, cost_eur: costEur };
  }
  return { ok: true, before, after, watermark, cost_eur: costEur };
}

export type RevisionApply = {
  block_id: string;
  before: { heading: string | null; html: string };
  after: { heading: string | null; html: string };
} & Omit<RevisionInput, "block_id">;

/** Takes a previewed Abschnitt over: only when the stored one is still the one the preview started from. */
export async function applyRevision(
  service: SupabaseClient,
  page: ContentPageRow,
  input: RevisionApply,
): Promise<{ ok: true } | Failure> {
  const blocker = revisionBlocker(page);
  if (blocker) return { ok: false, status: 409, message: blocker };
  const blocks = parseBlocksFromHtml(page.html);
  const index = blocks.findIndex((b) => b.id === input.block_id);
  if (index < 0) return { ok: false, status: 404, message: "Diesen Abschnitt gibt es im Text nicht (mehr)." };
  const current = blocks[index]!;
  if ((current.heading ?? "") !== (input.before.heading ?? "") || current.html.trim() !== input.before.html.trim()) {
    return { ok: false, status: 409, message: "Der Abschnitt wurde inzwischen geändert. Bitte den Vorschlag neu erstellen." };
  }
  let sanitized: ContentTextBlock[];
  try {
    sanitized = normalizeBlocks([{ id: current.id, heading: input.after.heading ?? "", level: current.level, html: input.after.html }]);
  } catch (error) {
    if (error instanceof ContentTextLimitError) return { ok: false, status: 422, message: error.message };
    throw error;
  }
  if (!sanitized[0]) return { ok: false, status: 422, message: "Der Abschnitt wäre leer." };
  blocks[index] = { ...current, heading: sanitized[0].heading, html: sanitized[0].html };

  const request = requestOf(page, input);
  const finding = "ok" in request ? null : request.finding ?? null;
  const html = renderBlocksHtml(blocks);
  const patch: Record<string, unknown> = {
    html,
    markdown: htmlToMarkdown(html),
    notes: [...page.notes, revisionNote(current, "ok" in request ? { instruction: input.instruction } : request)].slice(-20),
    // A released text that changes has to be released again.
    ...(page.released ? { released: false, released_at: null } : {}),
  };
  if (finding && input.finding_key) Object.assign(patch, withoutFinding(page, input.finding_key) ?? {});
  if (!("ok" in request) && input.finding_keys && input.finding_keys.length > 0) {
    let lists: Pick<ContentPageRow, "findings" | "final_findings" | "unresolved"> = page;
    for (const key of input.done_keys ?? input.finding_keys) lists = withoutFinding(lists, key) ?? lists;
    Object.assign(patch, { findings: lists.findings, final_findings: lists.final_findings, unresolved: lists.unresolved });
  }
  const { error } = await service.from("dt_content_pages").update(patch).eq("id", page.id).neq("state", "laeuft");
  if (error) return { ok: false, status: 500, message: contentDbErrorMessage(error, "Abschnitt konnte nicht gespeichert werden") };
  return { ok: true };
}

/**
 * „Jetzt umsetzen“ for one Abschnitt: the proposals of the chosen open points in one call, checked
 * like a preview (and through Grok after the Watermark Entfernung), then taken over at once. The
 * editor chose the proposals already, so there is no preview to confirm.
 */
export async function applyProposals(
  service: SupabaseClient,
  page: ContentPageRow,
  steps: ContentStepRow[],
  input: { block_id: string; finding_keys: string[]; done_keys?: string[] | null },
  userId: string | null,
  deps: Parameters<typeof previewRevision>[5] = {},
): Promise<{ ok: true; cost_eur: number } | Failure> {
  const preview = await previewRevision(service, page, steps, input, userId, deps);
  if (!preview.ok) return preview;
  const applied = await applyRevision(service, page, {
    block_id: input.block_id,
    before: { heading: preview.before.heading, html: preview.before.html },
    after: { heading: preview.after.heading, html: preview.after.html },
    finding_keys: input.finding_keys,
    done_keys: input.done_keys ?? null,
  });
  return applied.ok ? { ok: true, cost_eur: preview.cost_eur } : { ...applied, cost_eur: preview.cost_eur };
}

/**
 * „So lassen“: the open point goes, the text stays as it is, and the page remembers the point
 * (`question_stop.kept`) so a later Endabnahme does not report it again.
 */
export async function keepFinding(
  service: SupabaseClient,
  page: ContentPageRow,
  key: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Failure> {
  const finding = [...page.findings, ...page.final_findings, ...page.unresolved].find((f) => findingKey(f) === key);
  const next = withoutFinding(page, key);
  if (!finding || !next) return { ok: false, status: 409, message: "Diesen offenen Punkt gibt es nicht mehr. Bitte die Seite neu laden." };
  const stop = readQuestionStop(page.question_stop);
  const kept = [
    ...(stop.kept ?? []),
    { title: finding.title, problem: finding.problem, block_id: finding.block_id || null, at: now.toISOString() },
  ].slice(-CONTENT_KEPT_FINDINGS_MAX);
  const { error } = await service
    .from("dt_content_pages")
    .update({ ...next, question_stop: { ...stop, kept } })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: contentDbErrorMessage(error, "Offener Punkt konnte nicht gespeichert werden") };
  return { ok: true };
}

/**
 * „KUNDE PRÜFT“ on an open point whose placeholder is already in the text: the page notes that
 * the customer is checking it (the later steps then leave the placeholder alone and the window
 * and the exports show it as „KUNDE PRÜFT“), and the point goes like with „So lassen“. No model.
 * `marked` 0: the text has no placeholder for the point; nothing was written.
 */
export async function markFindingKundePrueft(
  service: SupabaseClient,
  page: ContentPageRow,
  key: string,
  now: Date = new Date(),
): Promise<{ ok: true; marked: number } | Failure> {
  const finding = [...page.findings, ...page.final_findings, ...page.unresolved].find((f) => findingKey(f) === key);
  const next = withoutFinding(page, key);
  if (!finding || !next) return { ok: false, status: 409, message: "Diesen offenen Punkt gibt es nicht mehr. Bitte die Seite neu laden." };
  const blocks = parseBlocksFromHtml(page.html ?? "");
  const questions = findingCheckPlaceholders(finding, blocks, findingTargetBlocks(finding, blocks));
  if (questions.length === 0) return { ok: true, marked: 0 };
  const known = new Set(kundePrueftQuestionsInNotes(page.notes));
  const fresh = questions.filter((q) => !known.has(q));
  const notes = fresh.length > 0 ? [...page.notes, fresh.map(kundePrueftNoteLine).join("\n")].slice(-20) : page.notes;
  const stop = readQuestionStop(page.question_stop);
  const kept = [
    ...(stop.kept ?? []),
    { title: finding.title, problem: finding.problem, block_id: finding.block_id || null, at: now.toISOString() },
  ].slice(-CONTENT_KEPT_FINDINGS_MAX);
  const { error } = await service
    .from("dt_content_pages")
    .update({ ...next, notes, question_stop: { ...stop, kept } })
    .eq("id", page.id);
  if (error) return { ok: false, status: 500, message: contentDbErrorMessage(error, "Offener Punkt konnte nicht gespeichert werden") };
  return { ok: true, marked: questions.length };
}

export { ContentLlmError };
