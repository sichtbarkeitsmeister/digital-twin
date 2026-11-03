/**
 * The page's one stop for questions, before the Watermark Entfernung. Pure; `run-step.ts`
 * (`runQuestionStop`) wires it to the database and the answers pass.
 *
 * Steps 2–8 only collect questions (`questions.ts`). When the run is about to reach the
 * Watermark Entfernung (or, with Watermark switched off, the Endabnahme), the page checks once:
 *   - every placeholder still in the text and every collected page question, against what is
 *     known by now (Kontaktdaten, answered company questions, notes, Anbieterfakten): a known
 *     value is filled in automatically, a known „Keine Angabe“ removes the sentence;
 *   - what only the customer knows is asked: the page's own questions (at most three) and the
 *     open company questions this page raised. With any, the page stops as „Braucht Sie“ with one
 *     merged list (`status: "waiting"`); with none it runs straight on.
 *   - „Antworten einarbeiten & weiter“ (`answered`) or answers known without asking: the short
 *     pass `answers.ts` works them into the affected Abschnitte only, then `done` and the run goes
 *     on. „Freigeben“ accepts the text without answers (`done`).
 *
 * The stop is no step: no step number, no row in `dt_content_steps`; its state and the pass's
 * cost live in `dt_content_pages.question_stop`, the cost also in the page's `cost_eur`.
 */

import { contentGapQuestions } from "@/lib/dt/content/pipeline/gaps";
import {
  CONTENT_MAX_PAGE_QUESTIONS,
  isTextPlaceholder,
  isSourceQuestion,
  isWishConflictQuestion,
  knownAnswerFor,
  narrowQuestionTopic,
  normalizeQuestionScope,
  poolDedupeKey,
  poolMatch,
  type ContentKnowledge,
  type ContentPoolQuestion,
} from "@/lib/dt/content/pipeline/questions";
import { CONTENT_STEP_WATERMARK } from "@/lib/dt/content/pipeline/steps";
import type { ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentQuestion } from "@/lib/dt/content/types";

/** The stop comes before the first step from here on that still has to run (or be skipped). */
export const CONTENT_QUESTION_STOP_BEFORE = CONTENT_STEP_WATERMARK;

/** One question with its decision: the customer's („kunde“) or a known answer. */
export type ContentHandledQuestion = {
  id: string;
  question: string;
  placeholder: string | null;
  block_id: string | null;
  excerpt: string | null;
  scope: "firma" | "seite";
  /** answer: work the answer in; drop: „Ohne Angabe weiter“, the sentence goes. */
  action: "answer" | "drop";
  answer: string | null;
  /** offen: a page question over the limit of three, never asked: its sentence goes, an open point stays. */
  source: "kunde" | "kontaktdaten" | "pool" | "notiz" | "fakten" | "antwort" | "offen";
};

export type ContentAnswersPassRecord = {
  at: string;
  cost_eur: number;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  /** Abschnitte the pass changed, those filled in code because the model's version broke a rule, and why. */
  changed: string[];
  fallback: string[];
  rejected: Array<{ block_id: string; reason: string }>;
};

export type ContentQuestionStop = {
  /** Missing until the run reaches the stop. */
  status?: "waiting" | "answered" | "done";
  at?: string;
  /** How many questions the page asked at the stop (page and company questions). */
  asked?: number;
  handled: ContentHandledQuestion[];
  pass?: ContentAnswersPassRecord | null;
};

export const EMPTY_QUESTION_STOP: ContentQuestionStop = { handled: [] };

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 2_000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function readQuestionStop(raw: unknown): ContentQuestionStop {
  const r = rec(raw);
  const status = r.status === "waiting" || r.status === "answered" || r.status === "done" ? r.status : undefined;
  const handled: ContentHandledQuestion[] = [];
  for (const item of Array.isArray(r.handled) ? r.handled : []) {
    const h = rec(item);
    const id = text(h.id, 80);
    const question = text(h.question, 600);
    if (!id || !question) continue;
    handled.push({
      id,
      question,
      placeholder: text(h.placeholder, 200),
      block_id: text(h.block_id, 80),
      excerpt: text(h.excerpt, 500),
      scope: h.scope === "firma" ? "firma" : "seite",
      action: h.action === "drop" ? "drop" : "answer",
      answer: text(h.answer, 2_000),
      source: (["kunde", "kontaktdaten", "pool", "notiz", "fakten", "antwort", "offen"] as const).find((s) => s === h.source) ?? "kunde",
    });
  }
  const p = rec(r.pass);
  const pass: ContentAnswersPassRecord | null = text(p.at)
    ? {
        at: text(p.at)!,
        cost_eur: Number(p.cost_eur) || 0,
        model: text(p.model, 120),
        input_tokens: Number(p.input_tokens) || 0,
        output_tokens: Number(p.output_tokens) || 0,
        changed: (Array.isArray(p.changed) ? p.changed : []).filter((x): x is string => typeof x === "string"),
        fallback: (Array.isArray(p.fallback) ? p.fallback : []).filter((x): x is string => typeof x === "string"),
        rejected: (Array.isArray(p.rejected) ? p.rejected : [])
          .map((x) => rec(x))
          .filter((x) => typeof x.block_id === "string")
          .map((x) => ({ block_id: String(x.block_id), reason: String(x.reason ?? "") })),
      }
    : null;
  return {
    ...(status ? { status } : {}),
    ...(text(r.at) ? { at: text(r.at)! } : {}),
    ...(typeof r.asked === "number" ? { asked: r.asked } : {}),
    handled,
    ...(pass ? { pass } : {}),
  };
}

/**
 * Whether the run has to pass the stop before `next`: the next step is the Watermark Entfernung
 * or later, the stop is not done, and the Watermark Entfernung has not run yet. A page that was
 * past it before this rule existed (Watermark done or skipped) keeps its old course.
 */
export function questionStopDue(
  stop: Pick<ContentQuestionStop, "status">,
  steps: readonly { step: number; status: string }[],
  next: number | null,
): boolean {
  if (next == null || next < CONTENT_QUESTION_STOP_BEFORE) return false;
  if (stop.status === "done") return false;
  const watermark = steps.find((s) => s.step === CONTENT_STEP_WATERMARK);
  return !(watermark && (watermark.status === "done" || watermark.status === "skipped"));
}

export type ContentQuestionStopPlan = {
  /** The page's own questions only the customer can answer (at most three). */
  ask: ContentQuestion[];
  /** The page's own questions over the limit: never asked, their sentences go when the stop is passed. */
  overflow: ContentQuestion[];
  /** Open company questions this page raised (answered under „Fragen zum Unternehmen“ or in the page window). */
  askPool: ContentPoolQuestion[];
  /** Company questions of the text the pool does not have yet. */
  newFirma: ContentQuestion[];
  /** Everything decided: the customer's answers and the known ones. */
  handled: ContentHandledQuestion[];
};

function handledFrom(q: ContentQuestion, action: "answer" | "drop", answer: string | null, source: ContentHandledQuestion["source"]): ContentHandledQuestion {
  return {
    id: q.id!,
    question: q.question,
    placeholder: q.placeholder ?? null,
    block_id: q.block_id ?? null,
    excerpt: q.excerpt ?? null,
    scope: q.scope === "firma" ? "firma" : "seite",
    action,
    answer: action === "answer" ? answer : null,
    source,
  };
}

/**
 * The stop's list: the placeholders still in the text and the collected page questions, each
 * once, decided by the customer (`decisions`), by what is known, or still open.
 */
export function planQuestionStop(input: {
  blocks: readonly ContentTextBlock[];
  questions: readonly ContentQuestion[];
  knowledge: ContentKnowledge;
  decisions?: readonly ContentHandledQuestion[];
  slug: string;
}): ContentQuestionStopPlan {
  const model = input.questions.filter((q) => !isTextPlaceholder(q.placeholder));
  const severityOf = new Map(input.questions.map((q) => [q.id ?? "", q.severity]));
  const all = contentGapQuestions(input.blocks, model).map((q) => {
    const n = narrowQuestionTopic(normalizeQuestionScope(q), input.knowledge);
    return { ...n, severity: severityOf.get(n.id!) ?? n.severity };
  });
  const decisions = new Map((input.decisions ?? []).map((d) => [d.id, d]));
  const ask: ContentQuestion[] = [];
  const askPool: ContentPoolQuestion[] = [];
  const newFirma: ContentQuestion[] = [];
  const handled: ContentHandledQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of all) {
    if (seen.has(raw.id!)) continue;
    seen.add(raw.id!);
    // Wish conflicts and missing sources are open points for the editor, never customer questions.
    if (isWishConflictQuestion(raw) || isSourceQuestion(raw)) continue;
    // A page question the organisation's pool already holds is asked (once) there, not twice.
    const q = raw.scope === "seite" && poolMatch(raw, input.knowledge.pool) ? { ...raw, scope: "firma" as const } : raw;
    const decided = decisions.get(q.id!);
    if (decided) {
      handled.push({ ...handledFrom(q, decided.action, decided.answer, decided.source), source: decided.source });
      continue;
    }
    const known = knownAnswerFor(q, input.knowledge);
    if (known) {
      handled.push(handledFrom(q, known.action, known.action === "answer" ? known.value : null, known.source));
      continue;
    }
    if (q.scope === "firma") {
      const key = poolDedupeKey(q);
      const row = input.knowledge.pool.find((p) => p.dedupe_key === key) ?? poolMatch(q, input.knowledge.pool);
      if (!row) {
        if (!newFirma.some((f) => poolDedupeKey(f) === key)) newFirma.push(q);
      } else if (row.status === "open" && !askPool.some((p) => p.id === row.id)) {
        askPool.push(row);
      }
      continue;
    }
    ask.push(q);
  }
  // Open company questions this page raised earlier, also without a placeholder in the text now.
  for (const row of input.knowledge.pool) {
    if (row.status === "open" && row.page_slugs.includes(input.slug) && !askPool.some((p) => p.id === row.id)) askPool.push(row);
  }
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const ordered = ask
    .map((q, i) => ({ q, i }))
    .sort((a, b) => (rank[a.q.severity ?? "medium"] ?? 1) - (rank[b.q.severity ?? "medium"] ?? 1) || a.i - b.i)
    .map((x) => x.q);
  return { ask: ordered.slice(0, CONTENT_MAX_PAGE_QUESTIONS), overflow: ordered.slice(CONTENT_MAX_PAGE_QUESTIONS), askPool, newFirma, handled };
}

/**
 * What the answers pass works in once the stop is passed: the decided questions plus every page
 * question still undecided (over the limit, or new since the stop asked) as a drop, so no
 * placeholder of an unasked question stays in the text. The steps already left an open point
 * („Offene Frage (nicht gestellt)“) for each.
 */
export function questionStopPassItems(plan: Pick<ContentQuestionStopPlan, "ask" | "overflow" | "handled">): ContentHandledQuestion[] {
  const open = [...plan.ask, ...plan.overflow].filter((q) => !plan.handled.some((h) => h.id === q.id));
  return [...plan.handled, ...open.map((q) => handledFrom(q, "drop", null, "offen"))];
}

/** What the stop does now: ask (stop as „Braucht Sie“), work known answers in, or go on. */
export function questionStopOutcome(plan: Pick<ContentQuestionStopPlan, "ask" | "askPool" | "newFirma" | "handled">): "ask" | "pass" | "go_on" {
  if (plan.ask.length > 0 || plan.askPool.length > 0 || plan.newFirma.length > 0) return "ask";
  return plan.handled.length > 0 ? "pass" : "go_on";
}
