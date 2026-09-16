/**
 * Text-Modus copy for the chat composer (persona vs SEO).
 * Run: npx tsx scripts/test-text-mode.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildTextModePromptBlocks,
  textModeComposerPlaceholder,
} from "../lib/dt/text-mode";

assert.equal(
  textModeComposerPlaceholder(false),
  "Text-Modus — SEO-Text, der menschlich klingt …",
);
assert.equal(
  textModeComposerPlaceholder(true, "Joachim"),
  "Text-Modus — fertiger Text in der Stimme von Joachim …",
);
assert.match(textModeComposerPlaceholder(true), /dieser Persona/);

const personaBlocks = buildTextModePromptBlocks(true).join("\n");
assert.match(personaBlocks, /in DEINER Stimme/);
assert.doesNotMatch(personaBlocks, /Fokus-Keyword/);

const seoBlocks = buildTextModePromptBlocks(false).join("\n");
assert.match(seoBlocks, /SEO-optimierte, publikationsreife Texte/);
assert.doesNotMatch(seoBlocks, /in DEINER Stimme/);

const composerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../components/dt/chat/dt-chat-composer.tsx",
);
const composer = readFileSync(composerPath, "utf8");
assert.match(composer, /aria-label="Text-Modus"/);
assert.match(composer, /<span className=\{labeledBtnText\}>Text<\/span>/);
assert.doesNotMatch(
  composer,
  /hidden text-xs font-bold sm:inline">Text/,
  "Text label must stay visible (not sm-only)",
);
assert.match(
  composer,
  /prospectPersona/,
  "Persona chats must get the Text control + voice placeholder",
);

console.log("text-mode tests: ok");
