import assert from "node:assert/strict";

import {
  buildDtSystemPrompt,
  isProspectPersonaKind,
} from "../lib/dt/prompts/build-system-prompt";
import {
  DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT,
  DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT,
} from "../lib/dt/survey-agent-global-prompts";

function testKindDetection() {
  assert.equal(isProspectPersonaKind("wunschkunde"), true);
  assert.equal(isProspectPersonaKind("persona", "joachim"), true);
  assert.equal(isProspectPersonaKind("persona", "preview_persona"), true);
  assert.equal(isProspectPersonaKind("persona", "default"), false);
  assert.equal(isProspectPersonaKind("seo_advisor"), false);
  assert.equal(isProspectPersonaKind("persona"), true);
  console.log("kind detection: ok");
}

function testProspectPromptOmitsBrandEncyclopedia() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "Joachim",
      role: "Angehöriger / Außerklinische Intensivpflege",
      prompt_template:
        "## WAS DU KANNST\nDu erklärst Ayags und nennst die Website https://example.com",
      kind: "persona",
      slug: "joachim",
    },
    org: {
      display_name: "Intensivpflege Ayags GmbH",
      website_url: "https://www.intensivpflege-ayags.de",
      focus_keyword: "Intensivpflege Hamm",
    },
    mode: "default",
  });

  assert.match(prompt, /Interessent \/ Wunschkunde/);
  assert.match(prompt, /Rollen-Ausrichtung \(verbindlich/);
  assert.match(prompt, /kein Markenbotschafter/i);
  assert.doesNotMatch(prompt, /^Website: https:\/\/www\.intensivpflege-ayags\.de\./m);
  assert.doesNotMatch(prompt, /Fokus-Keyword: Intensivpflege Hamm/);
  assert.match(prompt, /Interessenten-\/Wunschkunden-Persona/);
  console.log("prospect prompt framing: ok");
}

function testDefaultTwinKeepsOrgMetadata() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "DigitalTwin",
      role: "Assistent",
      prompt_template: "Du hilfst dem Team.",
      kind: "persona",
      slug: "default",
    },
    org: {
      display_name: "Intensivpflege Ayags GmbH",
      website_url: "https://www.intensivpflege-ayags.de",
      focus_keyword: "Intensivpflege Hamm",
    },
    mode: "default",
  });

  assert.match(prompt, /Website: https:\/\/www\.intensivpflege-ayags\.de/);
  assert.match(prompt, /Fokus-Keyword: Intensivpflege Hamm/);
  assert.doesNotMatch(prompt, /Rollen-Ausrichtung \(verbindlich/);
  assert.match(prompt, /DigitalTwin-Assistent/);
  console.log("default twin keeps org metadata: ok");
}

function testSurveyDefaultsMentionProspectRules() {
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /Rollen-Ausrichtung/);
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /kein Markenbotschafter/i);
  assert.match(
    DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT,
    /Fragen, die der Mitarbeiter an die Persona stellen würde/,
  );
  assert.match(DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT, /Markenbotschafter/);
  assert.match(DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT, /Interessent zurück/);
  console.log("survey default prompts: ok");
}

testKindDetection();
testProspectPromptOmitsBrandEncyclopedia();
testDefaultTwinKeepsOrgMetadata();
testSurveyDefaultsMentionProspectRules();
console.log("all prospect persona prompt tests passed");
