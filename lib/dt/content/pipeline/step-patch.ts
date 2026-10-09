/**
 * What a step's normalised output means for the page row. Pure, so the halting rules are
 * testable without Supabase: the Faktencheck stops for blocking questions, the Endabnahme
 * for the release, every text step replaces the HTML.
 */

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
  CONTENT_STEP_LEKTORAT,
  type ContentStepDefinition,
} from "@/lib/dt/content/pipeline/steps";
import { htmlToMarkdown, renderBlocksHtml } from "@/lib/dt/content/render";
import type { ContentStepRow } from "@/lib/dt/content/store";

export type StepPatch = {
  /** Columns of `dt_content_pages` to update (without the cost, which the caller adds). */
  pagePatch: Record<string, unknown>;
  stepStatus: ContentStepRow["status"];
  /** The job stops after this step (questions for the customer, the release). */
  halted: boolean;
};

export function textPatch(out: TextOutput): Record<string, unknown> {
  const html = renderBlocksHtml(out.blocks);
  return { html, markdown: htmlToMarkdown(html), title: out.title, meta_description: out.meta_description };
}

export function stepPatchFor(def: ContentStepDefinition, output: unknown): StepPatch {
  const pagePatch: Record<string, unknown> = {};
  let stepStatus: ContentStepRow["status"] = "done";
  let halted = false;

  switch (def.step) {
    case CONTENT_STEP_ANALYSE: {
      const out = output as AnalyseOutput;
      if (out.main_keyword) pagePatch.main_keyword = out.main_keyword;
      break;
    }
    case CONTENT_STEP_FAKTENCHECK: {
      const out = output as FaktencheckOutput;
      pagePatch.findings = out.findings;
      pagePatch.questions = out.questions;
      if (out.questions.some((q) => q.blocking)) {
        pagePatch.state = "braucht_sie";
        pagePatch.job_id = null;
        stepStatus = "waiting";
        halted = true;
      }
      break;
    }
    case CONTENT_STEP_LEKTORAT: {
      const out = output as LektoratOutput;
      if (out.blocks.length === 0) throw new ContentLlmError("Das Lektorat lieferte keinen Text.", true);
      Object.assign(pagePatch, textPatch(out));
      pagePatch.final_findings = out.final_findings;
      break;
    }
    case CONTENT_STEP_ENDABNAHME: {
      const out = output as EndabnahmeOutput;
      pagePatch.unresolved = out.unresolved;
      pagePatch.state = "fertig";
      pagePatch.released = false;
      pagePatch.job_id = null;
      stepStatus = "waiting";
      halted = true;
      break;
    }
    default: {
      if (def.writesText) {
        const out = output as TextOutput;
        if (out.blocks.length === 0) throw new ContentLlmError("Die KI hat keinen Text geliefert.", true);
        Object.assign(pagePatch, textPatch(out));
        // The first rewrite after the Faktencheck (GEO) works its findings in; they are settled then.
        if (def.step > CONTENT_STEP_FAKTENCHECK) pagePatch.findings = [];
      }
    }
  }
  return { pagePatch, stepStatus, halted };
}
