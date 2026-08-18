/**
 * German language quality rules in DT system prompts.
 * Run: npx tsx scripts/test-dt-german-language-quality.ts
 */
import assert from "node:assert/strict";

import { DT_GERMAN_LANGUAGE_QUALITY_RULES } from "../lib/dt/prompts/german-language-quality";
import {
  buildDtChatStaticSystemText,
  buildProspectStaticSystemText,
} from "../lib/dt/prompts/system-static";

assert.match(DT_GERMAN_LANGUAGE_QUALITY_RULES, /Sind du/);
assert.match(DT_GERMAN_LANGUAGE_QUALITY_RULES, /Du-Form/);
assert.match(DT_GERMAN_LANGUAGE_QUALITY_RULES, /Sie-Form/);

const staff = buildDtChatStaticSystemText();
assert.match(staff, /## Sprache & Grammatik/);
assert.match(staff, /Sind du/);

const prospect = buildProspectStaticSystemText();
assert.match(prospect, /## Sprache & Grammatik/);
assert.match(prospect, /Anrede konsequent/);

console.log("dt-german-language-quality: ok");
