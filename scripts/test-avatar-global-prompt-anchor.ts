import assert from "node:assert/strict";

import {
  AVATAR_GLOBAL_PROMPT_ANCHOR,
  ensureAvatarGlobalPromptAnchor,
  hasAvatarGlobalPromptAnchor,
} from "../lib/dt/prompts/avatar-global-prompt-anchor";
import { DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT } from "../lib/dt/survey-agent-global-prompts";
import { DEFAULT_AVATAR_GENERATOR_PROMPT } from "../lib/dt/transcripts/avatar-generator-prompt";

function testEnsurePrepends() {
  const body = "## DEINE SITUATION\nIch suche Hilfe.";
  const out = ensureAvatarGlobalPromptAnchor(body);
  assert.ok(out.startsWith("## ANKER: GLOBALER DIGITALTWIN-PROMPT"));
  assert.match(out, /DEINE SITUATION/);
  assert.match(out, /bei Widerspruch gilt der globale Prompt/i);
  console.log("ensure prepends: ok");
}

function testEnsureIdempotent() {
  const once = ensureAvatarGlobalPromptAnchor("## IDENTITÄT\nJoachim");
  const twice = ensureAvatarGlobalPromptAnchor(once);
  assert.equal(twice, once);
  assert.equal(hasAvatarGlobalPromptAnchor(twice), true);
  console.log("ensure idempotent: ok");
}

function testSurveyDefaultRequiresAnchor() {
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /ANKER: GLOBALER DIGITALTWIN-PROMPT/);
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /Pflicht: Der ANKER-Block/);
  assert.match(AVATAR_GLOBAL_PROMPT_ANCHOR, /kein Markenbotschafter/);
  console.log("survey default requires anchor: ok");
}

function testAnchorWording() {
  // The wording of the „Anbieter-Avatare“ Vorlage: no dash, the global prompt wins.
  const lines = AVATAR_GLOBAL_PROMPT_ANCHOR.split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[3], "Bei Widerspruch gilt der globale Prompt, nicht dieser Avatar-Teil.");
  assert.equal(/[–—]/.test(AVATAR_GLOBAL_PROMPT_ANCHOR), false);
  assert.ok(DEFAULT_AVATAR_GENERATOR_PROMPT.includes(`VORLAGE\n${AVATAR_GLOBAL_PROMPT_ANCHOR}\n---`));
  console.log("anchor wording: ok");
}

testEnsurePrepends();
testEnsureIdempotent();
testSurveyDefaultRequiresAnchor();
testAnchorWording();
console.log("all avatar global prompt anchor tests passed");
