/**
 * Text-Modus prompt resolve + system-prompt injection.
 * Run: npx tsx scripts/test-text-mode-prompt.ts
 */
import assert from "node:assert/strict";

import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
  DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS,
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
  assert.equal(resolveTextModeInstructions(DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS), DT_DEFAULT_TEXT_MODE_INSTRUCTIONS);
  assert.equal(isDefaultTextModeInstructions(DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS), true);
  assert.doesNotMatch(resolveTextModeInstructions(DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS), /SEO-optimierte/);
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
  assert.doesNotMatch(off, /Flyer, Social-Media-Posts/);

  const onDefault = buildDtSystemPrompt({ ...base, textMode: true });
  assert.match(onDefault, /## Text-Modus \(hat Vorrang\)/);
  assert.match(onDefault, /Flyer, Social-Media-Posts/);
  assert.doesNotMatch(onDefault, /SEO-optimierte/);
  assert.doesNotMatch(onDefault, /Fokus-Keyword/);

  const onCustom = buildDtSystemPrompt({
    ...base,
    textMode: true,
    textModePrompt: "## Text-Modus\nSchreibe wie ein Zahnarzt, keine Marketing-Floskeln.",
  });
  assert.match(onCustom, /Schreibe wie ein Zahnarzt/);
  assert.doesNotMatch(onCustom, /Flyer, Social-Media-Posts/);

  const personaOn = buildDtSystemPrompt({
    agent: {
      name: "Alexander",
      role: "Interessent",
      prompt_template: "Ich bin Interessent.",
      kind: "persona",
      slug: "alexander",
    },
    org: { display_name: "Beispiel GmbH" },
    mode: "default",
    textMode: true,
  });
  assert.match(personaOn, /Verlasse jetzt die Gesprächs-Persona/);
  assert.doesNotMatch(personaOn, /Rollen-Ausrichtung \(verbindlich/);
  console.log("injection: ok");
}

testResolve();
testPromptInjection();
console.log("ok: text-mode prompt");
