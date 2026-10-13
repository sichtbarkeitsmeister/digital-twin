/**
 * Tests for SEO advisor Wunschkunden knowledge (auto-injected, not copied).
 * Run: npx tsx scripts/test-wunschkunden-seo-knowledge.ts
 */
import assert from "node:assert/strict";

import { isSurveyPersonaAgent } from "../lib/dt/agents/seo-advisor";
import { AVATAR_GLOBAL_PROMPT_ANCHOR } from "../lib/dt/prompts/avatar-global-prompt-anchor";
import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import { DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT } from "../lib/dt/prompts/digital-twin-global-prompt";
import {
  avatarProfileTextForSeo,
  clipSeoKnowledgeText,
  formatWunschkundenKnowledgeForSeo,
  isSeoWunschkundeSourceAgent,
  promptTemplateHoldsAvatarProfile,
  stripAvatarAnchorForSeoKnowledge,
  type SeoWunschkundeProfile,
} from "../lib/dt/seo/wunschkunden-knowledge";

function testSourceFilter() {
  assert.equal(
    isSeoWunschkundeSourceAgent({
      kind: "wunschkunde",
      slug: "joachim",
      is_enabled: true,
      is_default: false,
    }),
    true,
  );
  assert.equal(
    isSeoWunschkundeSourceAgent({
      kind: "persona",
      slug: "julia",
      is_enabled: true,
      is_default: false,
    }),
    true,
  );
  assert.equal(
    isSeoWunschkundeSourceAgent({
      kind: "persona",
      slug: "default",
      is_enabled: true,
      is_default: true,
    }),
    false,
  );
  assert.equal(
    isSeoWunschkundeSourceAgent({
      kind: "seo_advisor",
      slug: "seo_advisor",
      is_enabled: true,
      is_default: false,
    }),
    false,
  );
  assert.equal(
    isSeoWunschkundeSourceAgent({
      kind: "wunschkunde",
      slug: "alt",
      is_enabled: false,
      is_default: false,
    }),
    false,
  );
  console.log("source filter: ok");
}

function testFormatSeparatesRoles() {
  const profiles: SeoWunschkundeProfile[] = [
    {
      id: "a1",
      name: "Joachim",
      role: "Angehöriger",
      sourceKind: "agent",
      surveyTitle: "Persona Joachim",
      body: "**Alter**\n62\n\n**Sorge**\nPflege zuhause organisieren",
      bodyFrom: "survey_facts",
    },
    {
      id: "a2",
      name: "Julia",
      role: "Selbstständig",
      sourceKind: "agent",
      surveyTitle: null,
      body: "Ich bin Julia und unsicher beim Preis.",
      bodyFrom: "avatar_prompt",
    },
  ];
  const text = formatWunschkundenKnowledgeForSeo(profiles);
  assert.match(text, /Wunschkunden-Wissen \(Zielgruppen\)/);
  assert.match(text, /Anbieter-Wissen/);
  assert.match(text, /Sprich NICHT als diese Personen/);
  assert.match(text, /### Wunschkunde: Joachim \(Angehöriger\)/);
  assert.match(text, /### Wunschkunde: Julia \(Selbstständig\)/);
  assert.match(text, /Pflege zuhause organisieren/);
  assert.match(text, /nicht in Ich-Form nachahmen/);
  assert.doesNotMatch(text, /Noch keine Wunschkunden hinterlegt/);
  console.log("format roles: ok");
}

function testEmptyState() {
  const text = formatWunschkundenKnowledgeForSeo([]);
  assert.match(text, /Noch keine Wunschkunden hinterlegt/);
  assert.match(text, /ohne extra „In SEO-Berater übernehmen“/);
  console.log("empty state: ok");
}

function testDirectlyCreatedAvatarUsesPromptTemplate() {
  // Avatar created under „Agenten“ without a questionnaire: profile lives in prompt_template.
  const daniel = {
    prompt_template:
      "Du bist Daniel Osei, 34, hast ein kleines Online-Business und willst strukturiert wachsen. Du fragst nach Finanzierung, Businessplan und Rechtsform.",
    prompt_append: null,
    uses_global_prompt: false,
  };
  assert.equal(promptTemplateHoldsAvatarProfile(daniel.prompt_template), true);
  assert.match(avatarProfileTextForSeo(daniel), /Daniel Osei/);
  assert.match(avatarProfileTextForSeo(daniel), /Businessplan/);

  // Global-prompt avatar: placeholder template is ignored, prompt_append is the profile.
  const placeholder = {
    prompt_template: "Avatar: Markus Demir",
    prompt_append: `${AVATAR_GLOBAL_PROMPT_ANCHOR}\n\n## DEINE SITUATION\nArbeitslos, Gründungsidee.`,
    uses_global_prompt: true,
  };
  assert.equal(promptTemplateHoldsAvatarProfile(placeholder.prompt_template), false);
  const markus = avatarProfileTextForSeo(placeholder);
  assert.match(markus, /Gründungsidee/);
  assert.doesNotMatch(markus, /Avatar: Markus/);
  assert.doesNotMatch(markus, /ANKER/);

  // A copy of the global DigitalTwin prompt is no profile either.
  assert.equal(promptTemplateHoldsAvatarProfile(DEFAULT_DIGITAL_TWIN_GLOBAL_PROMPT), false);
  assert.equal(avatarProfileTextForSeo({ prompt_template: "kurz", prompt_append: "" }), "");

  // Both present: template profile first, then the avatar-specific part.
  const both = avatarProfileTextForSeo({
    prompt_template: "Du bist Lena, Inhaberin eines Cafés in Köln, suchst eine Agentur für mehr Gäste.",
    prompt_append: "Du bist skeptisch bei hohen Monatspreisen.",
    uses_global_prompt: false,
  });
  assert.ok(both.indexOf("Lena") < both.indexOf("skeptisch"));

  const text = formatWunschkundenKnowledgeForSeo([
    { id: "d", name: "Daniel Osei", role: "Der ambitionierte Wachstumsgründer", sourceKind: "agent", surveyTitle: null, body: "", bodyFrom: "empty" },
  ]);
  assert.match(text, /Unter Agenten den Prompt des Avatars ergänzen/);
  assert.match(text, /JEDEN Wunschkunden einzeln/);
  console.log("direct avatar prompt template: ok");
}

function testClipAndAnchorStrip() {
  assert.equal(clipSeoKnowledgeText("kurz", 100), "kurz");
  const clipped = clipSeoKnowledgeText("Zeile eins\nZeile zwei\nZeile drei\nZeile vier", 28);
  assert.match(clipped, /gekürzt/);
  assert.ok(clipped.length < 40);

  const stripped = stripAvatarAnchorForSeoKnowledge(
    `${AVATAR_GLOBAL_PROMPT_ANCHOR}\n\n## DEINE SITUATION\nIch suche Hilfe.`,
  );
  assert.match(stripped, /## DEINE SITUATION/);
  assert.match(stripped, /Ich suche Hilfe/);
  assert.doesNotMatch(stripped, /ANKER: GLOBALER DIGITALTWIN-PROMPT/);
  assert.doesNotMatch(stripped, /kein Markenbotschafter/);
  console.log("clip + anchor strip: ok");
}

function testSeoPromptInjectsWunschkunden() {
  const knowledge = formatWunschkundenKnowledgeForSeo([
    {
      id: "a1",
      name: "Joachim",
      role: "Angehöriger",
      sourceKind: "agent",
      surveyTitle: "Persona Joachim",
      body: "**Suchbegriffe**\nIntensivpflege zuhause",
      bodyFrom: "survey_facts",
    },
  ]);
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "SEO-Berater",
      role: "SEO-Analyse & Aufgaben",
      prompt_template: "Du bist der SEO-Berater von Test GmbH.",
      prompt_append: "<!-- DT_ANBIETER_WISSEN_START -->\n## Anbieter-Wissen\nFirma Test\n<!-- DT_ANBIETER_WISSEN_END -->",
      kind: "seo_advisor",
      slug: "seo_advisor",
    },
    org: { display_name: "Test GmbH" },
    mode: "seo",
    wunschkundenKnowledgeText: knowledge,
  });
  assert.match(prompt, /Anbieter-Wissen/);
  assert.match(prompt, /Firma Test/);
  assert.match(prompt, /Wunschkunden-Wissen \(Zielgruppen\)/);
  assert.match(prompt, /Intensivpflege zuhause/);
  assert.match(prompt, /Du bleibst SEO-Berater/);
  assert.doesNotMatch(prompt, /Interessent \/ Wunschkunde im Kontext/);
  console.log("seo prompt inject: ok");
}

function testProspectPromptDoesNotGetWunschkundenUnlessPassed() {
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "Joachim",
      role: "Angehöriger",
      prompt_template: "Du bist Joachim.",
      prompt_append: "Ich bin unsicher.",
      kind: "wunschkunde",
      slug: "joachim",
    },
    org: { display_name: "Test GmbH" },
    mode: "default",
  });
  assert.doesNotMatch(prompt, /Wunschkunden-Wissen \(Zielgruppen\)/);
  assert.match(prompt, /## Avatar-spezifisch/);
  console.log("prospect omits org wunschkunden block: ok");
}

function testSeoAdvisorFormNotTreatedAsSurveyPersona() {
  assert.equal(
    isSurveyPersonaAgent({
      source_survey_id: "survey-anbieter",
      kind: "seo_advisor",
      slug: "seo_advisor",
    }),
    false,
  );
  assert.equal(
    isSurveyPersonaAgent({
      source_survey_id: "survey-persona",
      kind: "wunschkunde",
      slug: "joachim",
    }),
    true,
  );
  assert.equal(
    isSurveyPersonaAgent({
      source_survey_id: null,
      kind: "wunschkunde",
      slug: "joachim",
    }),
    false,
  );
  console.log("seo advisor is not a survey persona: ok");
}

testSourceFilter();
testFormatSeparatesRoles();
testEmptyState();
testDirectlyCreatedAvatarUsesPromptTemplate();
testClipAndAnchorStrip();
testSeoPromptInjectsWunschkunden();
testProspectPromptDoesNotGetWunschkundenUnlessPassed();
testSeoAdvisorFormNotTreatedAsSurveyPersona();
console.log("OK: wunschkunden-seo-knowledge tests passed");
