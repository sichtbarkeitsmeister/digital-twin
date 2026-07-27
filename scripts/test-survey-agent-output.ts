/**
 * Parse survey→agent model outputs (delimiter format + legacy JSON).
 * Run: npm run test:survey-agent-output
 */
import assert from "node:assert/strict";

import {
  parseSurveyAgentCreateOutput,
  parseSurveyAgentRefineOutput,
} from "../lib/dt/survey-agent-output";

const longPrompt = `${"## Identität\n".repeat(5)}Du bist Alex Müller, 65 Jahre alt. Entscheidungsfrist 1–3 Wochen. ${"x".repeat(80)}`;

const delimiterOut = [
  "===DT_AGENT_META===",
  JSON.stringify({
    name: "Alex Müller",
    role: "Privatkunde Entrümpelung",
    slug: "alex_mueller",
    avatar_data: { alter: "65+", disg: "S" },
    summary: "Wunschkunde Entrümpelung",
    quick_actions: ["Was kostet das?"],
  }),
  "===DT_AGENT_PROMPT===",
  longPrompt,
  "===DT_AGENT_END===",
].join("\n");

const parsed = parseSurveyAgentCreateOutput(delimiterOut);
assert.ok(parsed);
assert.equal(parsed?.name, "Alex Müller");
assert.equal(parsed?.slug, "alex_mueller");
assert.match(parsed?.prompt_template ?? "", /Alex Müller/);
assert.equal(parsed?.avatar_data.alter, "65+");

// Broken JSON-in-one-blob (unescaped newline in string) should fail legacy path,
// but delimiter with same content works — already covered above.

const legacyJson = JSON.stringify({
  name: "Alex Müller",
  role: "Privatkunde",
  slug: "alex_mueller",
  prompt_template: longPrompt,
  avatar_data: { alter: "65+" },
  summary: "Test",
  quick_actions: [],
});
const legacy = parseSurveyAgentCreateOutput(legacyJson);
assert.ok(legacy);
assert.equal(legacy?.slug, "alex_mueller");

// Truncated delimiter (missing END): still OK if prompt already ≥200 chars
const truncated = [
  "===DT_AGENT_META===",
  JSON.stringify({
    name: "Alex Müller",
    role: "Privatkunde Entrümpelung",
    slug: "alex_mueller",
    avatar_data: {},
    summary: "Wunschkunde",
  }),
  "===DT_AGENT_PROMPT===",
  longPrompt,
  // no END
].join("\n");
assert.ok(parseSurveyAgentCreateOutput(truncated));
assert.ok(parseSurveyAgentCreateOutput(truncated, { truncated: true }));

// Too-short partial prompt without END fails unless truncated relaxes min length
const shortPartial = [
  "===DT_AGENT_META===",
  JSON.stringify({
    name: "Alex Müller",
    role: "Privatkunde Entrümpelung",
    slug: "alex_mueller",
    avatar_data: {},
    summary: "Wunschkunde",
  }),
  "===DT_AGENT_PROMPT===",
  "Kurzer Anfang ohne Ende — wird nur bei Truncation akzeptiert…",
].join("\n");
assert.equal(parseSurveyAgentCreateOutput(shortPartial), null);
assert.ok(parseSurveyAgentCreateOutput(shortPartial, { truncated: true }));

const refineDelim = [
  "===DT_AGENT_META===",
  JSON.stringify({
    summary: "Umfrage eingearbeitet",
    changed_sections: ["Situation", "Ängste"],
  }),
  "===DT_AGENT_PROMPT===",
  longPrompt,
  "===DT_AGENT_END===",
].join("\n");
const refine = parseSurveyAgentRefineOutput(refineDelim);
assert.ok(refine);
assert.equal(refine?.changed_sections.length, 2);

console.log("survey-agent-output tests: ok");
