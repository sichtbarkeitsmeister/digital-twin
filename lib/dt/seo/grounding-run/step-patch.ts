/**
 * What a Grounding step's normalised output means for the page row. Pure, so the halting
 * rules are testable without Supabase: the Faktencheck stops for blocking questions, the
 * Endprüfung finishes the draft (v1.6, no review data) for the human fact review.
 */

import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";
import { buildGroundingPageUpdate } from "@/lib/dt/seo/grounding-pages";
import type {
  GroundingBuildOutput,
  GroundingCheckOutput,
  GroundingFacts,
  GroundingFinalOutput,
} from "@/lib/dt/seo/grounding-run/prompts";
import {
  GROUNDING_STEP_BAUEN,
  GROUNDING_STEP_ENDPRUEFUNG,
  GROUNDING_STEP_FAKTEN,
  GROUNDING_STEP_FAKTENCHECK,
} from "@/lib/dt/seo/grounding-run/steps";
import type { DtGroundingPageRow, DtGroundingStepRow } from "@/lib/dt/types";

export type GroundingStepPatch = { pagePatch: Record<string, unknown>; stepStatus: DtGroundingStepRow["status"]; halted: boolean };

/** What a step's output means for the page row (pure, so the halting rules are testable). */
export function groundingStepPatchFor(step: number, output: unknown, page: Pick<DtGroundingPageRow, "html">): GroundingStepPatch {
  const pagePatch: Record<string, unknown> = {};
  let stepStatus: DtGroundingStepRow["status"] = "done";
  let halted = false;

  switch (step) {
    case GROUNDING_STEP_FAKTEN: {
      const out = output as GroundingFacts;
      if (!out.entity.definition && out.core_facts.length === 0) {
        throw new ContentLlmError("Die KI hat keine Faktenbasis geliefert.", true);
      }
      pagePatch.facts = out;
      pagePatch.entity_type = out.entity.schema_type;
      break;
    }
    case GROUNDING_STEP_FAKTENCHECK: {
      const out = output as GroundingCheckOutput;
      pagePatch.findings = out.findings;
      pagePatch.questions = out.questions;
      if (out.questions.some((q) => q.blocking)) {
        pagePatch.run_state = "braucht_sie";
        pagePatch.job_id = null;
        stepStatus = "waiting";
        halted = true;
      }
      break;
    }
    case GROUNDING_STEP_BAUEN: {
      const out = output as GroundingBuildOutput;
      if (!out.html) throw new ContentLlmError("Die KI hat keine vollständige HTML-Datei geliefert.", true);
      pagePatch.html = out.html;
      pagePatch.title = out.title;
      pagePatch.meta_description = out.meta_description;
      pagePatch.entity_type = out.schema_type;
      break;
    }
    case GROUNDING_STEP_ENDPRUEFUNG: {
      const out = output as GroundingFinalOutput;
      if (out.corrected_html) pagePatch.html = out.corrected_html;
      else if (!page.html) throw new ContentLlmError("Es gibt keine HTML-Datei zum Prüfen.", false);
      pagePatch.findings = out.issues;
      pagePatch.run_state = "fertig";
      pagePatch.job_id = null;
      // The draft is now a v1.6 page in the tool; dateModified = today, no review data.
      const built = buildGroundingPageUpdate(
        { standardVersion: "1.6", dateModified: new Date().toISOString(), reviewStatus: "draft" },
        null,
      );
      if (built.ok) Object.assign(pagePatch, built.update);
      stepStatus = "waiting";
      halted = true;
      break;
    }
    default:
      throw new ContentLlmError(`Unbekannter Schritt ${step}.`, false);
  }
  return { pagePatch, stepStatus, halted };
}

