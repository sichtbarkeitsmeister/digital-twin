import assert from "node:assert/strict";

import { resolveDashboardSurveyAiPageContext } from "../app/dashboard/_components/dashboard-sticky-survey-ai-assistant";

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

  const neu = resolveDashboardSurveyAiPageContext("/dashboard/surveys/new", params(""));
  assert.equal(neu.page, "survey_builder_new");
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
testFallbackAnywhere();
console.log("all sticky survey ai context tests passed");
