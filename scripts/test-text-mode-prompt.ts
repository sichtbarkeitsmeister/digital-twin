/**
 * Text-Modus prompt resolve + system-prompt injection.
 * Run: npx tsx scripts/test-text-mode-prompt.ts
 */
import assert from "node:assert/strict";

import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
  isDefaultTextModeInstructions,
  resolveTextModeInstructions,
} from "../lib/dt/prompts/text-mode";

function testResolve() {
  assert.equal(resolveTextModeInstructions(null), DT_DEFAULT_TEXT_MODE_INSTRUCTIONS);
  assert.equal(resolveTextModeInstructions("  "), DT_DEFAULT_TEXT_MODE_INSTRUCTIONS);
  assert.equal(resolveTextModeInstructions("## Text-Modus\nNur fertigen Text liefern."), "## Text-Modus\nNur fertigen Text liefern.");
  assert.equal(isDefaultTextModeInstructions(null), true);
  assert.equal(isDefaultTextModeInstructions(DT_DEFAULT_TEXT_MODE_INSTRUCTIONS), true);
  assert.equal(isDefaultTextModeInstructions("custom"), false);
  console.log("resolve: ok");
}

function testPromptInjection() {
  const base = {
    agent: {
      name: "SEO-Berater",
      role: "SEO",
      prompt_template: "Du berätst zu SEO.",
      kind: "seo_advisor",
      slug: "seo_advisor",
    },
    org: { display_name: "Beispiel GmbH" },
    mode: "seo" as const,
  };

  const off = buildDtSystemPrompt(base);
  assert.doesNotMatch(off, /publikationsreife Texte/);

  const onDefault = buildDtSystemPrompt({ ...base, textMode: true });
  assert.match(onDefault, /## Text-Modus/);
  assert.match(onDefault, /publikationsreife Texte/);
  assert.match(onDefault, /Anti-AI-Slop/);

  const onCustom = buildDtSystemPrompt({
    ...base,
    textMode: true,
    textModePrompt: "## Text-Modus\nSchreibe wie ein Zahnarzt, keine Marketing-Floskeln.",
  });
  assert.match(onCustom, /Schreibe wie ein Zahnarzt/);
  assert.doesNotMatch(onCustom, /publikationsreife Texte/);
  console.log("injection: ok");
}

testResolve();
testPromptInjection();
console.log("ok: text-mode prompt");
