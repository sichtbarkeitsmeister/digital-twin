import assert from "node:assert/strict";

import { organisationSurveyOpenHref } from "../lib/dt/organisation-survey-open-href";

const surveyId = "11111111-1111-1111-1111-111111111111";
const responseId = "22222222-2222-2222-2222-222222222222";

assert.equal(
  organisationSurveyOpenHref({
    surveyId,
    slug: "persona-max-mustermann-sichtbarkeitsmeister",
    visibility: "public",
    responseId,
  }),
  "/s/persona-max-mustermann-sichtbarkeitsmeister",
  "published surveys open the fill UI, not Antwort-Details",
);

assert.equal(
  organisationSurveyOpenHref({
    surveyId,
    slug: "  persona-max-mustermann-sichtbarkeitsmeister  ",
    visibility: "public",
    responseId,
  }),
  "/s/persona-max-mustermann-sichtbarkeitsmeister",
);

assert.equal(
  organisationSurveyOpenHref({
    surveyId,
    slug: "persona-draft",
    visibility: "private",
    responseId,
  }),
  `/dashboard/surveys/${surveyId}/responses/${responseId}`,
  "unpublished surveys with answers stay on Antwort-Details",
);

assert.equal(
  organisationSurveyOpenHref({
    surveyId,
    slug: null,
    visibility: "private",
    responseId: null,
  }),
  `/dashboard/surveys/${surveyId}/edit`,
);

console.log("organisation-survey-open-href: all ok");
