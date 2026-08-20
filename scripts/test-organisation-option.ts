/**
 * Organisation switcher labels and search.
 * Run: npx tsx scripts/test-organisation-option.ts
 */
import assert from "node:assert/strict";

import { pickSurveyFolderToRename } from "../lib/dt/organisation-rename";
import {
  filterOrganisationOptions,
  matchesSearchQuery,
  organisationOptionLabel,
} from "../lib/shared/organisation-option";

assert.equal(
  organisationOptionLabel({ id: "1", name: "arctictub", displayName: "ArcticTub" }),
  "ArcticTub",
);
assert.equal(
  organisationOptionLabel({ id: "1", name: "arctictub", displayName: null }),
  "arctictub",
);

assert.equal(matchesSearchQuery("ArcticTub\narctictub", "arctic"), true);
assert.equal(matchesSearchQuery("arctictub", "arctic tub"), true);
assert.equal(matchesSearchQuery("Sichtbarkeitsmeister", "arctic"), false);

const orgs = [
  { id: "a", name: "arctictub", slug: "arctictub", displayName: "ArcticTub" },
  { id: "s", name: "Sichtbarkeitsmeister", slug: "sichtbarkeitsmeister", displayName: null },
];
assert.deepEqual(
  filterOrganisationOptions(orgs, "Arctic").map((o) => o.id),
  ["a"],
);
assert.deepEqual(
  filterOrganisationOptions(orgs, "arctic tub").map((o) => o.id),
  ["a"],
);

const folders = [
  { id: "f1", name: "Arctic Tub" },
  { id: "f2", name: "Sichtbarkeitsmeister" },
];
assert.deepEqual(
  pickSurveyFolderToRename({
    folders,
    previousLabels: ["arctictub", "ArcticTub"],
    nextName: "ArcticTub",
  }),
  { id: "f1", from: "Arctic Tub", to: "ArcticTub" },
);
assert.equal(
  pickSurveyFolderToRename({
    folders: [{ id: "f1", name: "ArcticTub" }],
    previousLabels: ["ArcticTub"],
    nextName: "ArcticTub",
  }),
  null,
);
assert.equal(
  pickSurveyFolderToRename({
    folders: [
      { id: "f1", name: "Arctic Tub" },
      { id: "f2", name: "ArcticTub" },
    ],
    previousLabels: ["arctictub"],
    nextName: "ArcticTub",
  }),
  null,
);

console.log("organisation-option: all ok");
