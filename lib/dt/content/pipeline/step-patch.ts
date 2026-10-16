/**
 * What a step's normalised output means for the page row. Pure, so the halting rules are
 * testable without Supabase: every text step replaces the HTML, the Endabnahme stops for the
 * release, and a page that still needs a fact only the customer knows stops as „Braucht Sie“.
 *
 * That last rule is decided here in code, not by the model: after the Faktencheck, after
 * every step that writes text (SEO, GEO, Hormozi, Vermenschlichung, Lektorat) and in the
 * Endabnahme, the saved text is scanned for placeholders (`gaps.ts`). Each placeholder, and
 * every question of the Faktencheck (also the ones it marked non-blocking), becomes an entry
 * of `questions` naming its Abschnitt; while there is one, the page does not go on and never
 * becomes „fertig“ on its own.
 */

import { contentGapQuestions } from "@/lib/dt/content/pipeline/gaps";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import type {
  AnalyseOutput,
  EndabnahmeOutput,
  FaktencheckOutput,
  LektoratOutput,
  TextOutput,
} from "@/lib/dt/content/pipeline/prompts";
import {
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
import type { ContentStepRow } from "@/lib/dt/content/store";
import type { ContentQuestion } from "@/lib/dt/content/types";

export type StepPatch = {
  /** Columns of `dt_content_pages` to update (without the cost, which the caller adds). */
  pagePatch: Record<string, unknown>;
  stepStatus: ContentStepRow["status"];
  /** The job stops after this step (questions for the customer, the release). */
  halted: boolean;
};

/** The text steps after which the page is checked for gaps (Watermark Entfernung is not; the Endabnahme right after it is). */
const GAP_CHECKED_TEXT_STEPS: ReadonlySet<number> = new Set([
  CONTENT_STEP_SEO,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_LEKTORAT,
]);

export function textPatch(out: TextOutput): Record<string, unknown> {
  const html = renderBlocksHtml(out.blocks);
  return { html, markdown: htmlToMarkdown(html), title: out.title, meta_description: out.meta_description };
}

/** The text exactly as it is saved, read back into blocks (what the drawer shows and highlights). */
function savedBlocks(pagePatch: Record<string, unknown>): ContentTextBlock[] {
  return parseBlocksFromHtml(typeof pagePatch.html === "string" ? pagePatch.html : "");
}

/**
 * The open questions go on the page in any case (an empty list clears old ones); with at
 * least one, the page stops as „Braucht Sie“ and this step waits for „Freigeben“.
 */
function settleQuestions(
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

/**
 * `current.html` is the page text before this step: what the Faktencheck checked and what
 * the Endabnahme releases (neither writes text). Text steps are checked on their own output.
 */
export function stepPatchFor(
  def: ContentStepDefinition,
  output: unknown,
  current: { html: string } = { html: "" },
): StepPatch {
  const pagePatch: Record<string, unknown> = {};
  let stepStatus: ContentStepRow["status"] = "done";
  let halted = false;
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
        // The first rewrite after the Faktencheck (GEO) works its findings in; they are settled then.
        if (def.step > CONTENT_STEP_FAKTENCHECK) pagePatch.findings = [];
        if (GAP_CHECKED_TEXT_STEPS.has(def.step) && settleQuestions(pagePatch, savedBlocks(pagePatch))) stop();
      }
    }
  }
  return { pagePatch, stepStatus, halted };
}
