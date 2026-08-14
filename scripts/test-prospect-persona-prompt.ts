import assert from "node:assert/strict";

import {
  buildDtSystemPrompt,
  isProspectPersonaKind,
} from "../lib/dt/prompts/build-system-prompt";
import { DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT } from "../lib/dt/prompts/digital-twin-global-prompt";
import {
  DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT,
  DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT,
} from "../lib/dt/survey-agent-global-prompts";
import { resolveAvatarSpecificPrompt } from "../lib/dt/survey-to-agent-service";

function testKindDetection() {
  assert.equal(isProspectPersonaKind("wunschkunde"), true);
  assert.equal(isProspectPersonaKind("persona", "joachim"), true);
  assert.equal(isProspectPersonaKind("persona", "preview_persona"), true);
  assert.equal(isProspectPersonaKind("persona", "default"), true);
  assert.equal(isProspectPersonaKind("seo_advisor"), false);
  assert.equal(isProspectPersonaKind("persona"), true);
  console.log("kind detection: ok");
}

function testProspectPromptOmitsBrandEncyclopedia() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "Joachim",
      role: "Angehöriger / Außerklinische Intensivpflege",
      prompt_template: DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT.replace(
        /\{\{\s*organisation\s*\}\}/gi,
        "Intensivpflege Ayags GmbH",
      ),
      prompt_append:
        "## DEINE SITUATION\nIch suche Unterstützung für die Pflege zuhause.",
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
  assert.match(prompt, /## Avatar-spezifisch/);
  assert.match(prompt, /Pre-Sale/);
  assert.match(prompt, /Kein Hilfe-Anbieten/);
  assert.match(prompt, /kein Coach, kein Assistent/);
  assert.doesNotMatch(prompt, /übt Gesprächssituationen mit dir/);
  assert.doesNotMatch(prompt, /^Website: https:\/\/www\.intensivpflege-ayags\.de\./m);
  assert.doesNotMatch(prompt, /Fokus-Keyword: Intensivpflege Hamm/);
  console.log("prospect prompt framing: ok");
}

function testDefaultTwinIsAlsoProspect() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "DigitalTwin",
      role: "Standard-Avatar",
      prompt_template: DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT.replace(
        /\{\{\s*organisation\s*\}\}/gi,
        "Intensivpflege Ayags GmbH",
      ),
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

  assert.doesNotMatch(prompt, /^Website: https:\/\/www\.intensivpflege-ayags\.de\./m);
  assert.match(prompt, /Rollen-Ausrichtung \(verbindlich/);
  assert.match(prompt, /Interessenten-\/Wunschkunden-Persona/);
  assert.match(prompt, /Biete dem Nutzer keine Hilfe an/);
  console.log("default twin is prospect: ok");
}

function testSurveyDefaultsAreAvatarSpecific() {
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /avatar-spezifischen Teil/);
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /Pre-Sale/);
  assert.match(DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT, /kein Markenbotschafter/i);
  assert.match(DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT, /avatar-spezifischen Teil/);
  assert.match(DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT, /Markenbotschafter/);
  assert.match(DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT, /WER MIT DIR SPRICHT/);
  assert.match(DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT, /Pre-Sale/);
  assert.match(DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT, /kein Coach, kein Berater/);
  assert.match(DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT, /Wie kann ich dir helfen/);
  console.log("survey + digital twin defaults: ok");
}

function testResolveAvatarSpecificPrompt() {
  assert.equal(
    resolveAvatarSpecificPrompt({
      uses_global_prompt: true,
      prompt_template: "stub",
      prompt_append: "Ich bin Joachim und unsicher.",
    }),
    "Ich bin Joachim und unsicher.",
  );
  assert.equal(
    resolveAvatarSpecificPrompt({
      uses_global_prompt: false,
      prompt_template: "Vollständiger Solo-Prompt",
      prompt_append: null,
    }),
    "Vollständiger Solo-Prompt",
  );
  console.log("resolve avatar-specific prompt: ok");
}

testKindDetection();
testProspectPromptOmitsBrandEncyclopedia();
testDefaultTwinIsAlsoProspect();
testSurveyDefaultsAreAvatarSpecific();
testResolveAvatarSpecificPrompt();
console.log("all prospect persona prompt tests passed");
