/**
 * What a step's normalised output means for the page row. Pure, so the halting rules are
 * testable without Supabase: every text step replaces the HTML, the Endabnahme stops for the
 * release, and a page that still needs a fact only the customer knows stops as „Braucht Sie“.
 *
 * That last rule is decided here in code, not by the model: after the Faktencheck, after
 * every step that writes text (SEO, GEO, Aktualitätsprüfung, Hormozi, Vermenschlichung,
 * Lektorat) and in the Endabnahme, the saved text is scanned for placeholders (`gaps.ts`).
 * Each placeholder, and every question of the Faktencheck or the Aktualitätsprüfung (also
 * the ones marked non-blocking), becomes an entry of `questions` naming its Abschnitt; while
 * there is one, the page does not go on and never becomes „fertig“ on its own.
 *
 * The Aktualitätsprüfung may also send the text back to GEO, once per run (`planFreshness`):
 * the step then asks the runner to reset GEO and itself (`resetFrom`) and the job goes on.
 * Not when the editor switched GEO off for the page: GEO would only be skipped again, so the
 * outdated Abschnitte become open points at once, and the Faktencheck's findings (which GEO
 * would have worked in) stay on the page.
 *
 * A step the editor switched off gets its patch from `skippedStepPatch`: no model output, the
 * row „skipped“ at 0 €, the text unchanged except where the next steps need it (SEO takes the
 * live text, Hormozi removes the empty hero section).
 */

import {
  freshnessSectionFindings,
  mergeFreshnessUpdates,
  readContentFreshness,
} from "@/lib/dt/content/freshness";
import type { AktualitaetOutput } from "@/lib/dt/content/pipeline/aktualitaet";
import { contentGapQuestions } from "@/lib/dt/content/pipeline/gaps";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import {
  ensureHeroPlaceholder,
  isEmptyHeroPlaceholder,
  type AnalyseOutput,
  type EndabnahmeOutput,
  type FaktencheckOutput,
  type LektoratOutput,
  type TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import { roundEur } from "@/lib/dt/content/pricing";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  type ContentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { htmlToMarkdown, parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentPageRow, ContentStepRow } from "@/lib/dt/content/store";
import type { IngestedText } from "@/lib/dt/text-tools/ingest";
import type { ContentFinding, ContentFreshness, ContentQuestion } from "@/lib/dt/content/types";

export type StepPatch = {
  /** Columns of `dt_content_pages` to update (without the cost, which the caller adds). */
  pagePatch: Record<string, unknown>;
  stepStatus: ContentStepRow["status"];
  /** The job stops after this step (questions for the customer, the release). */
  halted: boolean;
  /**
   * After saving, set the steps from this one on back to pending and go on (the
   * Aktualitätsprüfung's send-back to GEO). Absent for every other outcome.
   */
  resetFrom?: number;
};

/** The text steps after which the page is checked for gaps (Watermark Entfernung is not; the Endabnahme right after it is). */
export const GAP_CHECKED_TEXT_STEPS: ReadonlySet<number> = new Set([
  CONTENT_STEP_SEO,
  CONTENT_STEP_GEO,
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_LEKTORAT,
]);

export function textPatch(out: TextOutput): Record<string, unknown> {
  const html = renderBlocksHtml(out.blocks);
  return { html, markdown: htmlToMarkdown(html), title: out.title, meta_description: out.meta_description };
}

/** The text exactly as it is saved, read back into blocks (what the drawer shows and highlights). */
export function savedBlocks(pagePatch: Record<string, unknown>): ContentTextBlock[] {
  return parseBlocksFromHtml(typeof pagePatch.html === "string" ? pagePatch.html : "");
}

/**
 * The open questions go on the page in any case (an empty list clears old ones); with at
 * least one, the page stops as „Braucht Sie“ and this step waits for „Freigeben“.
 */
export function settleQuestions(
  pagePatch: Record<string, unknown>,
  blocks: readonly ContentTextBlock[],
  modelQuestions: readonly ContentQuestion[] = [],
): boolean {
  const questions = contentGapQuestions(blocks, modelQuestions);
  pagePatch.questions = questions;
  if (questions.length === 0) return false;
  pagePatch.state = "braucht_sie";
  pagePatch.job_id = null;
  return true;
}

function loose(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type FreshnessPlan = {
  freshness: ContentFreshness;
  /** The page's open points after this check (rejected changes, outdated Abschnitte after the send-back). */
  findings: ContentFinding[];
  /** Asked now; empty while the text goes back to GEO (they wait in `carried_questions`). */
  questions: ContentQuestion[];
  /** The text goes back to GEO, the first time an Abschnitt is outdated. */
  sendBack: boolean;
};

/**
 * What one Aktualitätsprüfung means for `dt_content_pages.freshness`:
 *   - its valid updates are added to the list (with the time of the check);
 *   - outdated Abschnitte go back to GEO the first time (`sendbacks` 0 → 1, `pending_sections`
 *     for GEO's prompt); questions found meanwhile wait for the second check, because GEO
 *     rewrites the text in between;
 *   - the second time they become open points with proposal and source, and the page goes on.
 */
export function planFreshness(
  stored: ContentFreshness,
  out: Pick<AktualitaetOutput, "updates" | "questions" | "outdated_sections" | "findings" | "blocks">,
  at: string,
  options: { geoSkipped?: boolean } = {},
): FreshnessPlan {
  const updates = mergeFreshnessUpdates(stored.updates, out.updates.map((u) => ({ ...u, at })));
  // GEO switched off for this page: a send-back would reset GEO, GEO would be skipped again and
  // a second paid check would find the same Abschnitte. They become open points right away.
  if (out.outdated_sections.length > 0 && stored.sendbacks === 0 && !options.geoSkipped) {
    return {
      freshness: {
        ...stored,
        sendbacks: 1,
        updates,
        pending_sections: out.outdated_sections,
        sent_back_sections: out.outdated_sections,
        converted_sections: [],
        carried_questions: out.questions,
      },
      findings: out.findings,
      questions: [],
      sendBack: true,
    };
  }
  // The questions of the first check, where their Abschnitt still exists after GEO.
  const ids = new Set(out.blocks.map((b) => b.id));
  const carried = stored.carried_questions.map((q) => (q.block_id && !ids.has(q.block_id) ? { ...q, block_id: null } : q));
  const asked = new Set(out.questions.map((q) => `${q.block_id ?? ""}|${loose(q.excerpt || q.question)}`));
  const questions = [
    ...out.questions,
    ...carried.filter((q) => !asked.has(`${q.block_id ?? ""}|${loose(q.excerpt || q.question)}`)),
  ];
  return {
    freshness: {
      ...stored,
      updates,
      pending_sections: [],
      converted_sections: out.outdated_sections,
      carried_questions: [],
    },
    findings: [...out.findings, ...freshnessSectionFindings(out.outdated_sections)],
    questions,
    sendBack: false,
  };
}

function findingKey(f: Pick<ContentFinding, "title" | "block_id" | "problem">): string {
  return `${f.title}|${f.block_id ?? ""}|${f.problem}`;
}

/** The page as a step's patch sees it before the step. */
export type StepPatchCurrent = {
  html: string;
  freshness?: unknown;
  /** The open points on the page (`findings`). */
  findings?: readonly ContentFinding[];
  /** Steps the editor switched off for this page. */
  skip_steps?: readonly string[];
  /** The Faktencheck's findings as its row holds them (the Aktualitätsprüfung keeps them while GEO is off). */
  faktencheck_findings?: readonly ContentFinding[];
};

/**
 * `current.html` is the page text before this step: what the Faktencheck checked and what
 * the Endabnahme releases (neither writes text). Text steps are checked on their own output.
 * `current.freshness` is the stored state of the Aktualitätsprüfung (GEO and the check read it).
 */
export function stepPatchFor(
  def: ContentStepDefinition,
  output: unknown,
  current: StepPatchCurrent = { html: "" },
  now: Date = new Date(),
): StepPatch {
  const pagePatch: Record<string, unknown> = {};
  let stepStatus: ContentStepRow["status"] = "done";
  let halted = false;
  let resetFrom: number | undefined;
  const stop = () => {
    stepStatus = "waiting";
    halted = true;
  };

  switch (def.step) {
    case CONTENT_STEP_ANALYSE: {
      const out = output as AnalyseOutput;
      if (out.main_keyword) pagePatch.main_keyword = out.main_keyword;
      break;
    }
    case CONTENT_STEP_FAKTENCHECK: {
      const out = output as FaktencheckOutput;
      pagePatch.findings = out.findings;
      if (settleQuestions(pagePatch, parseBlocksFromHtml(current.html), out.questions)) stop();
      break;
    }
    case CONTENT_STEP_AKTUALITAET: {
      const out = output as AktualitaetOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Die Aktualitätsprüfung lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out));
      const geoSkipped = current.skip_steps?.includes("geo") ?? false;
      const plan = planFreshness(readContentFreshness(current.freshness), out, now.toISOString(), { geoSkipped });
      pagePatch.freshness = plan.freshness;
      // Normally GEO has worked the Faktencheck's findings in and cleared them. With GEO off they
      // are still open: the ones still on the page (not edited away) stay in front of this check's.
      const faktencheck = new Set((current.faktencheck_findings ?? []).map(findingKey));
      const kept = geoSkipped ? (current.findings ?? []).filter((f) => faktencheck.has(findingKey(f))) : [];
      pagePatch.findings = [...kept, ...plan.findings];
      if (plan.sendBack) {
        // GEO reworks the outdated Abschnitte, then this step checks again; nobody is asked yet.
        resetFrom = CONTENT_STEP_GEO;
        break;
      }
      if (settleQuestions(pagePatch, savedBlocks(pagePatch), plan.questions)) stop();
      break;
    }
    case CONTENT_STEP_LEKTORAT: {
      const out = output as LektoratOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Das Lektorat lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out));
      pagePatch.final_findings = out.final_findings;
      if (settleQuestions(pagePatch, savedBlocks(pagePatch))) stop();
      break;
    }
    case CONTENT_STEP_ENDABNAHME: {
      const out = output as EndabnahmeOutput;
      pagePatch.unresolved = out.unresolved;
      pagePatch.released = false;
      pagePatch.job_id = null;
      // „Fertig“ only without a placeholder left; otherwise the same list as after any step.
      if (!settleQuestions(pagePatch, parseBlocksFromHtml(current.html))) pagePatch.state = "fertig";
      stop();
      break;
    }
    default: {
      if (def.writesText) {
        const out = output as TextOutput;
        if (out.blocks.length === 0) throw new ContentLlmError("Die KI hat keinen Text geliefert.", true);
        Object.assign(pagePatch, textPatch(out));
        if (def.step === CONTENT_STEP_GEO) {
          // GEO works the Faktencheck's findings in; they are settled then. The open points the
          // Aktualitätsprüfung leaves after it stay on the page until the Endabnahme.
          pagePatch.findings = [];
          // After a send-back GEO has reworked the outdated Abschnitte: the block is done.
          const freshness = readContentFreshness(current.freshness);
          if (freshness.pending_sections.length > 0) pagePatch.freshness = { ...freshness, pending_sections: [] };
        }
        if (GAP_CHECKED_TEXT_STEPS.has(def.step) && settleQuestions(pagePatch, savedBlocks(pagePatch))) stop();
      }
    }
  }
  return resetFrom == null ? { pagePatch, stepStatus, halted } : { pagePatch, stepStatus, halted, resetFrom };
}

// --- a step the editor switched off ----------------------------------------------------------

/** What a skipped step's row holds instead of a model output. */
export type SkippedStepOutput = {
  skipped_by: "user";
  /** SEO on a crawl page: the live text became the starting text. */
  live_text?: true;
  source?: "live" | "crawl";
  url?: string;
  /** Hormozi: the empty hero section was taken out of the text. */
  hero_removed?: true;
};

/** The live page as `loadCrawledPageInput` imported it (SEO switched off on a crawl page). */
export type LiveTextImport = { source: "live" | "crawl"; url: string; ingested: Pick<IngestedText, "blocks" | "title" | "metaDescription"> };

export const LIVE_TEXT_FAILURE_PREFIX = "Live-Text konnte nicht übernommen werden";

/** The German error of a failed live-text import; the page pauses with it. */
export function liveTextFailureMessage(reason: string): string {
  const detail = reason.trim().replace(/\.?$/, ".");
  return `${LIVE_TEXT_FAILURE_PREFIX}: ${detail} Bitte SEO wieder einschalten oder erneut crawlen.`;
}

export type SkippedStepPatch = {
  /** The step row: „skipped“, no model, no tokens, 0 €. */
  stepRow: Partial<ContentStepRow> & { output: SkippedStepOutput };
  /** Columns of `dt_content_pages`, including `step`. */
  pagePatch: Record<string, unknown>;
  /** The live text still holds a placeholder: the page stops as „Braucht Sie“ like after any text step. */
  halted: boolean;
};

/**
 * The patch for a step the run reached while the editor has it switched off. Every step: the
 * row becomes „skipped“ (no model, no tokens, 0 €), the page moves on to it, the text stays.
 * `paidBefore` is what an earlier, unfinished attempt of the step already cost (Watermark
 * chunks, the Aktualitätsprüfung's research): its progress is dropped, its cost goes to the
 * page total instead of vanishing with the row.
 *
 *   - SEO: `live` becomes the page text, with the empty hero section after the H1 unless
 *     Hormozi is off too, title and meta description when the import has them; then the
 *     placeholder check like after every text step. No usable text is an error, never an
 *     empty page.
 *   - Hormozi: an empty hero section (current or legacy placeholder) is removed: nobody fills
 *     it, and the Endabnahme would flag it. A hero with content stays.
 */
export function skippedStepPatch(
  def: ContentStepDefinition,
  page: Pick<ContentPageRow, "html" | "title" | "meta_description" | "skip_steps" | "cost_eur">,
  options: { live?: LiveTextImport | null; paidBefore?: number; now?: Date } = {},
): SkippedStepPatch {
  const at = (options.now ?? new Date()).toISOString();
  const output: SkippedStepOutput = { skipped_by: "user" };
  const pagePatch: Record<string, unknown> = { step: def.step, error: null };
  let halted = false;

  if (def.key === "seo") {
    const live = options.live;
    if (!live) throw new ContentLlmError(liveTextFailureMessage("Die Seite hat keine Live-URL aus dem Crawl"), false);
    const blocks = page.skip_steps.includes("hormozi") ? [...live.ingested.blocks] : ensureHeroPlaceholder(live.ingested.blocks);
    if (blocks.length === 0) throw new ContentLlmError(liveTextFailureMessage("Die Seite enthält keinen Text"), false);
    Object.assign(
      pagePatch,
      textPatch({ blocks, title: live.ingested.title || page.title, meta_description: live.ingested.metaDescription || page.meta_description }),
    );
    halted = settleQuestions(pagePatch, savedBlocks(pagePatch));
    Object.assign(output, { live_text: true, source: live.source, url: live.url });
  } else if (def.key === "hormozi") {
    const blocks = parseBlocksFromHtml(page.html);
    const kept = blocks.filter((b) => !isEmptyHeroPlaceholder(b));
    if (kept.length < blocks.length) {
      const html = renderBlocksHtml(kept);
      Object.assign(pagePatch, { html, markdown: htmlToMarkdown(html) });
      output.hero_removed = true;
    }
  }

  const paidBefore = options.paidBefore ?? 0;
  if (paidBefore > 0) {
    const before = Number(page.cost_eur);
    pagePatch.cost_eur = roundEur((Number.isFinite(before) ? before : 0) + paidBefore);
  }

  return {
    stepRow: {
      status: "skipped",
      output,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      cost_eur: 0,
      error: null,
      started_at: at,
      finished_at: at,
      approved_by: null,
      approved_at: null,
    },
    pagePatch,
    halted,
  };
}
