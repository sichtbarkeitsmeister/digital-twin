import assert from "node:assert/strict";

import { suggestedSurveyFolderName } from "../lib/dt/ensure-organisation-survey-folder";

assert.equal(suggestedSurveyFolderName({ name: "arctictub", displayName: "ArcticTub" }), "ArcticTub");
assert.equal(suggestedSurveyFolderName({ name: "Arctic Tub", slug: "arctictub" }), "Arctic Tub");
assert.equal(
  suggestedSurveyFolderName({ slug: "arctictub" }),
  "arctictub",
);
assert.equal(suggestedSurveyFolderName({ name: "A".repeat(120) }).length, 80);

console.log("ensure-organisation-survey-folder: all ok");
