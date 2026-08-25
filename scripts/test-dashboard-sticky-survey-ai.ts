import assert from "node:assert/strict";

import { resolveDashboardSurveyAiPageContext, buildStickySurveyAiAssistantContext } from "../app/dashboard/_components/dashboard-sticky-survey-ai-assistant";
import type { Survey } from "../lib/surveys/types";

function params(q: string) {
  return new URLSearchParams(q);
}

function testAgentsPage() {
  const ctx = resolveDashboardSurveyAiPageContext(
    "/dashboard/verwaltung/agents",
    params("org=31ddfdea-401b-4744-95d4-05b789adede0&agent=41ddfdea-401b-4744-95d4-05b789adede0"),
  );
  assert.equal(ctx.page, "dt_agents");
  assert.equal(ctx.organisationId, "31ddfdea-401b-4744-95d4-05b789adede0");
  assert.equal(ctx.agentId, "41ddfdea-401b-4744-95d4-05b789adede0");
  console.log("agents page: ok");
}

function testSurveyBuilder() {
  const edit = resolveDashboardSurveyAiPageContext(
    "/dashboard/surveys/31ddfdea-401b-4744-95d4-05b789adede0/edit",
    params(""),
  );
  assert.equal(edit.page, "survey_builder_edit");
  assert.equal(edit.surveyId, "31ddfdea-401b-4744-95d4-05b789adede0");

  const neu = resolveDashboardSurveyAiPageContext("/dashboard/frageboegen/neu", params(""));
  assert.equal(neu.page, "survey_builder_new");
  const legacyNeu = resolveDashboardSurveyAiPageContext("/dashboard/surveys/new", params(""));
  assert.equal(legacyNeu.page, "survey_builder_new");
  console.log("survey builder: ok");
}

function testCreateAgent() {
  const ctx = resolveDashboardSurveyAiPageContext(
    "/dashboard/surveys/31ddfdea-401b-4744-95d4-05b789adede0/responses/41ddfdea-401b-4744-95d4-05b789adede0/create-agent",
    params("org=51ddfdea-401b-4744-95d4-05b789adede0"),
  );
  assert.equal(ctx.page, "survey_to_agent");
  assert.equal(ctx.surveyId, "31ddfdea-401b-4744-95d4-05b789adede0");
  assert.equal(ctx.organisationId, "51ddfdea-401b-4744-95d4-05b789adede0");
  console.log("create-agent: ok");
}

function testFrageboegenList() {
  const list = resolveDashboardSurveyAiPageContext(
    "/dashboard/frageboegen",
    params("org=31ddfdea-401b-4744-95d4-05b789adede0"),
  );
  assert.equal(list.page, "survey_list");
  assert.equal(list.surveyId, null);
  assert.equal(list.organisationId, "31ddfdea-401b-4744-95d4-05b789adede0");

  const neu = resolveDashboardSurveyAiPageContext(
    "/dashboard/frageboegen/neu",
    params("org=31ddfdea-401b-4744-95d4-05b789adede0"),
  );
  assert.equal(neu.page, "survey_builder_new");
  assert.equal(neu.surveyId, null);
  assert.equal(neu.organisationId, "31ddfdea-401b-4744-95d4-05b789adede0");
  console.log("frageboegen list/neu: ok");
}

function testFallbackAnywhere() {
  const ctx = resolveDashboardSurveyAiPageContext(
    "/dashboard/verwaltung/seo",
    params("org=31ddfdea-401b-4744-95d4-05b789adede0"),
  );
  assert.equal(ctx.page, "survey_list");
  assert.equal(ctx.organisationId, "31ddfdea-401b-4744-95d4-05b789adede0");
  console.log("fallback anywhere: ok");
}

testAgentsPage();
testSurveyBuilder();
testCreateAgent();
testFrageboegenList();
testFallbackAnywhere();

const leftoverWizard: Survey = {
  version: 1,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Wizard-Rest",
  description: "",
  steps: [
    {
      id: "s1",
      title: "Schritt",
      description: "",
      fields: [
        {
          id: "f1",
          type: "text",
          title: "Frage",
          description: "",
          required: false,
        },
      ],
    },
  ],
};

const openSurvey: Survey = {
  ...leftoverWizard,
  id: "da79cd08-3520-4db0-bf41-d456841e6d95",
  title: "Persona: Unternehmer/Gesellschafter (Westprüfung Kanzlei)",
};

function testOpenEditIgnoresWizardDraft() {
  const resolved = resolveDashboardSurveyAiPageContext(
    "/dashboard/surveys/da79cd08-3520-4db0-bf41-d456841e6d95/edit",
    params(""),
  );
  const ctx = buildStickySurveyAiAssistantContext({
    resolved,
    wizardSurvey: leftoverWizard,
    builderSurvey: openSurvey,
  });
  assert.equal(ctx.page, "survey_builder_edit");
  assert.equal(ctx.surveyId, "da79cd08-3520-4db0-bf41-d456841e6d95");
  assert.equal(ctx.liveWizardDraft, false);
  assert.equal(ctx.currentSurvey?.id, "da79cd08-3520-4db0-bf41-d456841e6d95");
  assert.equal(
    ctx.currentSurvey?.title,
    "Persona: Unternehmer/Gesellschafter (Westprüfung Kanzlei)",
  );
  console.log("open edit ignores leftover wizard draft: ok");
}

function testWizardPageStillUsesDraft() {
  const resolved = resolveDashboardSurveyAiPageContext(
    "/dashboard/frageboegen/neu",
    params(""),
  );
  const ctx = buildStickySurveyAiAssistantContext({
    resolved,
    wizardSurvey: leftoverWizard,
    builderSurvey: null,
  });
  assert.equal(ctx.liveWizardDraft, true);
  assert.equal(ctx.surveyId, leftoverWizard.id);
  console.log("wizard page uses draft: ok");
}

testOpenEditIgnoresWizardDraft();
testWizardPageStillUsesDraft();
console.log("all sticky survey ai context tests passed");
