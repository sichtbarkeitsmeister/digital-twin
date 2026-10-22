/**
 * Globale Prompts → „Vollständigen Prompt ansehen“: what one editable step of Texte sends to
 * the model. Built by the same code as a run (`contentStepSpec`), for an example page: only the
 * page data (facts, avatar, keywords, earlier steps) is a stand-in. Instruction, locked rules,
 * Branchenregel, Texter prompt, Textvorlage and answer format are the real ones.
 * Pure: the route loads the saved texts and passes them in.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { ContentTextSettings } from "@/lib/dt/content/mapping";
import { CONTENT_SELF_SCORE_MIN, contentStepSpec, type ContentPipelineContext, type VermenschlichungOutput } from "@/lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_PROMPT_META, type ContentStepPromptKey, type ContentStepPrompts } from "@/lib/dt/content/step-prompts";
import type { ContentTypePromptKey, ContentTypePrompts } from "@/lib/dt/content/type-prompts";

export type ContentStepPromptPreview = {
  step: number;
  system: string;
  user: string;
  tool: Anthropic.Tool;
  /** Vermenschlichung only: what a second attempt adds to the message … */
  retry: string | null;
  /** … when the self-score sum is below this (of 50). */
  retryBelow: number | null;
};

/** No Branche: the Branchenregel of Dienstleistung & Handwerk, as for most organisations. */
const EXAMPLE_SETTINGS: ContentTextSettings = { anrede: "Sie", branche: "", tonalitaet: "sachlich", verbotene_woerter: [] };

function exampleContext(input: {
  pageType: ContentTypePromptKey;
  stepPrompts: Partial<ContentStepPrompts>;
  texterPrompt: string;
  typePrompts: ContentTypePrompts;
}): ContentPipelineContext {
  return {
    organisationName: "[Firmenname]",
    page: {
      name: "[Seitenname]",
      path: "/beispiel",
      level: 1,
      url: null,
      source: "structure",
      page_role: null,
      page_type: input.pageType,
      pillar_name: null,
      estimated_traffic: null,
      keywords: { main: { text: "[Hauptkeyword]" }, secondary: [{ text: "[Nebenkeyword]" }] },
      h1_options: [],
      user_questions: ["[Nutzerfrage aus Spalte H]"],
      ki_prompt: null,
      internal_link_targets: ["[Linkziel]"],
    },
    structureOutline: "- [weitere Seite der Website] · Unterseite",
    existingText: null,
    sections: [{ key: "beispiel", label: "[Abschnitt aus Fragebogen oder Gespräch]", current: "[Anbieterfakten der Organisation]" }],
    settings: EXAMPLE_SETTINGS,
    avatar: { name: "[Avatar]", role: "", beschreibung: "[Beschreibung des Wunschkunden]" },
    typePrompts: input.typePrompts,
    texterPrompt: input.texterPrompt,
    stepPrompts: input.stepPrompts,
    notes: ["[Anmerkung der Redaktion, falls vorhanden]"],
    outputs: { 1: "[Ergebnis der Analyse (Schritt 1)]", 3: "[Ergebnis des Faktenchecks (Schritt 3)]" },
    blocks: [{ id: "beispiel", heading: "[Überschrift]", level: 1, html: "<p>[Text aus dem vorherigen Schritt]</p>" }],
    title: "[Title-Tag]",
    metaDescription: "[Meta-Description]",
  };
}

export function contentStepPromptPreview(input: {
  key: ContentStepPromptKey;
  pageType: ContentTypePromptKey;
  stepPrompts: Partial<ContentStepPrompts>;
  texterPrompt: string;
  typePrompts: ContentTypePrompts;
}): ContentStepPromptPreview {
  const step = CONTENT_STEP_PROMPT_META[input.key].step;
  const context = exampleContext(input);
  const spec = contentStepSpec(step, context);
  const low = CONTENT_SELF_SCORE_MIN / 5 - 1;
  const weak: VermenschlichungOutput = {
    blocks: context.blocks,
    title: context.title,
    meta_description: context.metaDescription,
    self_score: { direktheit: low, rhythmus: low, vertrauen: low, natuerlichkeit: low, dichte: low },
  };
  const retry = spec.retryHint?.(weak) ?? null;
  return { step, system: spec.system, user: spec.user, tool: spec.tool, retry, retryBelow: retry ? CONTENT_SELF_SCORE_MIN : null };
}
