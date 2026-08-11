import assert from "node:assert/strict";

import {
  AGENT_PROMPT_REVISE_SYSTEM,
  buildAgentPromptReviseUserMessage,
  normalizeRevisedPromptText,
} from "../lib/dt/prompts/revise-agent-prompt";

function testNormalizeFences() {
  assert.equal(
    normalizeRevisedPromptText("```markdown\n## Hallo\nWelt\n```"),
    "## Hallo\nWelt",
  );
  assert.equal(normalizeRevisedPromptText("  plain text  "), "plain text");
  console.log("normalize fences: ok");
}

function testBuildUserMessage() {
  const msg = buildAgentPromptReviseUserMessage({
    agentName: "Joachim",
    agentRole: "Angehöriger",
    target: "prompt",
    currentPrompt: "## WER DU BIST\nDu bist Joachim und kennst Ayags in- und auswendig.",
    instruction: 'Bitte passe "WAS DU WEISST" an: keine Firmenfakten auswendig.',
  });
  assert.match(msg, /Agent: Joachim \(Angehöriger\)/);
  assert.match(msg, /Änderungsanweisung/);
  assert.match(msg, /keine Firmenfakten/);
  assert.match(msg, /Aktueller Text/);
  console.log("build user message: ok");
}

function testSystemKeepsProspectRules() {
  assert.match(AGENT_PROMPT_REVISE_SYSTEM, /Interessent\/Wunschkunde/);
  assert.match(AGENT_PROMPT_REVISE_SYSTEM, /kein Markenbotschafter/);
  assert.match(AGENT_PROMPT_REVISE_SYSTEM, /NUR mit dem vollständigen/);
  console.log("system rules: ok");
}

testNormalizeFences();
testBuildUserMessage();
testSystemKeepsProspectRules();
console.log("all revise-agent-prompt tests passed");
