/**
 * text_list answer helpers + schema acceptance.
 * Run: npx tsx scripts/test-survey-text-list.ts
 */
import assert from "node:assert/strict";

import { surveySchema } from "../lib/surveys/schema";
import {
  coerceTextListState,
  isTextListAnswerValid,
  setTextListEntryValue,
  textListPayloadFromFreeText,
} from "../lib/surveys/text-list-answer";

const optionIds = ["p1", "p2", "p3"];

const empty = coerceTextListState(undefined, optionIds);
assert.equal(empty.entries.length, 3);
assert.equal(isTextListAnswerValid(empty, optionIds, true), false);
assert.equal(isTextListAnswerValid(empty, optionIds, false), false);

let state = setTextListEntryValue(empty, optionIds, "p1", "Foo");
state = setTextListEntryValue(state, optionIds, "p2", "Bar");
assert.equal(isTextListAnswerValid(state, optionIds, true), false);
state = setTextListEntryValue(state, optionIds, "p3", "Baz");
assert.equal(isTextListAnswerValid(state, optionIds, true), true);

const parsed = surveySchema.safeParse({
  version: 1,
  id: "survey_1",
  title: "T",
  description: "",
  steps: [
    {
      id: "step_1",
      title: "S",
      description: "",
      fields: [
        {
          id: "field_1",
          type: "text_list",
          title: "Formulierungen",
          description: "Bitte ausfüllen",
          required: true,
          options: [
            { id: "p1", label: "Mir ist aufgefallen, dass…" },
            { id: "p2", label: "Das Kind hat Probleme mit…" },
          ],
          allowExtraEntries: true,
        },
      ],
    },
  ],
});
assert.equal(parsed.success, true);

const fromLines = textListPayloadFromFreeText(
  "Anna Müller, Inhaberin\nMax Schmidt, Beratung\nLisa",
  ["team_1", "team_2", "team_3"],
);
assert.equal(fromLines.entries[0]?.value, "Anna Müller, Inhaberin");
assert.equal(fromLines.entries[1]?.value, "Max Schmidt, Beratung");
assert.equal(fromLines.entries[2]?.value, "Lisa");

console.log("ok: survey text_list");
