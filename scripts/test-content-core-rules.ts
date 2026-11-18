/**
 * Texte: „Kernregeln“. One text under Globale Prompts that every step of the pipeline gets, so
 * shared rules need not be repeated in each step prompt. Empty means none and unchanged prompts.
 * No network, no model.
 * Run: npm run test:content-core-rules
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CONTENT_CORE_RULES_MAX_CHARS, CONTENT_CORE_RULES_MIGRATION_FILE, contentCoreRulesBlock, isMissingCoreRulesColumn, loadContentCoreRules, resolveContentCoreRules } from "../lib/dt/content/core-rules";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { aktualitaetSystemPrompt } from "../lib/dt/content/pipeline/aktualitaet";
import { contentStepSpec, rephraseChunkPrompt, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { revisionPrompt } from "../lib/dt/content/pipeline/revise";
import { CONTENT_STEPS } from "../lib/dt/content/pipeline/steps";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const RULES = "- Jedes Versprechen des Anbieters steht höchstens einmal auf der Seite.\n- Der YMYL-Hinweis steht als eigener Abschnitt vor „Stand“.";

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Lindner",
  page: {
    name: "Blutwerte", path: "/blutwerte", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Labordiagnostik im Haus." }],
  settings: { anrede: "Sie", branche: "Heilpraktiker", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [{ id: "h1", heading: "Blutwerte", level: 1, html: "<p>Das Labor ist im Haus und die Auswertung dauert eine Woche.</p>" }],
  title: null,
  metaDescription: null,
  ...patch,
});

{
  assert.equal(contentCoreRulesBlock(""), "");
  assert.equal(contentCoreRulesBlock(null), "");
  assert.equal(contentCoreRulesBlock("   \n "), "");
  const block = contentCoreRulesBlock(`\r\n${RULES}\r\n`);
  assert.match(block, /^Kernregeln der Agentur \(gelten in jedem Schritt dieser Pipeline/);
  assert.ok(block.endsWith(RULES));
  assert.match(block, /die festen Regeln zu Tatsachen, Anrede, verbotenen Wörtern und Branche sowie die Hinweise zum Texten gehen ihnen vor/);
  assert.equal(resolveContentCoreRules("x".repeat(CONTENT_CORE_RULES_MAX_CHARS + 50)).length, CONTENT_CORE_RULES_MAX_CHARS);
  console.log("block: ok");
}

{
  // Every Claude step, the Aktualitätsprüfung, the Grok pass and a single revision get the rules.
  const withRules = context({ coreRules: RULES });
  const bare = context();
  for (const def of CONTENT_STEPS.filter((d) => d.provider === "anthropic" && d.key !== "aktualitaet")) {
    const system = contentStepSpec(def.step, withRules).system;
    assert.ok(system.includes("Kernregeln der Agentur") && system.includes("höchstens einmal auf der Seite"), `${def.name} gets the Kernregeln`);
    assert.equal(system.split("Kernregeln der Agentur").length, 2, `${def.name}: once`);
    assert.ok(!contentStepSpec(def.step, bare).system.includes("Kernregeln"), `${def.name}: unchanged without Kernregeln`);
  }
  assert.ok(aktualitaetSystemPrompt(withRules).includes("höchstens einmal auf der Seite"));
  assert.ok(!aktualitaetSystemPrompt(bare).includes("Kernregeln"));
  assert.ok(rephraseChunkPrompt(withRules, withRules.blocks).user.includes("Kernregeln der Agentur"), "the Grok pass gets them in its message");
  assert.ok(!rephraseChunkPrompt(bare, bare.blocks).user.includes("Kernregeln"));
  assert.ok(revisionPrompt(withRules, withRules.blocks[0]!, { instruction: "kürzer" }).system.includes("höchstens einmal auf der Seite"), "a single revision too");
  console.log("all steps: ok");
}

async function main() {
  // The loader: the stored text; none on a missing column (before the migration) or any other error.
  const client = (result: { data?: unknown; error?: { message: string } | null }) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) }) }) }) as never;
  assert.equal(await loadContentCoreRules(client({ data: { content_core_rules: ` ${RULES} ` } })), RULES);
  assert.equal(await loadContentCoreRules(client({ data: { content_core_rules: null } })), "");
  assert.equal(await loadContentCoreRules(client({ data: null })), "");
  assert.equal(await loadContentCoreRules(client({ error: { message: 'column dt_platform_settings.content_core_rules does not exist' } })), "");
  assert.equal(isMissingCoreRulesColumn("column dt_platform_settings.content_core_rules does not exist"), true);
  assert.equal(isMissingCoreRulesColumn("permission denied"), false);
  assert.match(readFileSync(CONTENT_CORE_RULES_MIGRATION_FILE, "utf8"), /ADD COLUMN IF NOT EXISTS content_core_rules text/);
  console.log("loader and migration: ok");
}

main()
  .then(() => console.log("OK: content core rules tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
