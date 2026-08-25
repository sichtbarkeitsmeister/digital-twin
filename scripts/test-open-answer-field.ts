/**
 * Open-question answer fields wrap up to 3 lines, then scroll.
 * Run: npx tsx scripts/test-open-answer-field.ts
 */
import assert from "node:assert/strict";

import { OPEN_ANSWER_MAX_ROWS, measureOpenAnswerHeight } from "../lib/surveys/open-answer-field";

assert.equal(OPEN_ANSWER_MAX_ROWS, 3);

const line = 22;
const pad = 16;
const oneLine = line + pad;

const empty = measureOpenAnswerHeight({
  scrollHeight: oneLine,
  lineHeight: line,
  paddingY: pad,
});
assert.equal(empty.height, oneLine);
assert.equal(empty.overflowY, "hidden");

const twoLines = measureOpenAnswerHeight({
  scrollHeight: line * 2 + pad,
  lineHeight: line,
  paddingY: pad,
});
assert.equal(twoLines.height, line * 2 + pad);
assert.equal(twoLines.overflowY, "hidden");

const threeLines = measureOpenAnswerHeight({
  scrollHeight: line * 3 + pad,
  lineHeight: line,
  paddingY: pad,
});
assert.equal(threeLines.height, line * 3 + pad);
assert.equal(threeLines.overflowY, "hidden");

const fourLines = measureOpenAnswerHeight({
  scrollHeight: line * 4 + pad,
  lineHeight: line,
  paddingY: pad,
});
assert.equal(fourLines.height, line * 3 + pad);
assert.equal(fourLines.overflowY, "auto");

const withCssMin = measureOpenAnswerHeight({
  scrollHeight: 10,
  lineHeight: line,
  paddingY: pad,
  cssMinHeight: 44,
});
assert.equal(withCssMin.height, 44);
assert.equal(withCssMin.overflowY, "hidden");

const cssCapped = measureOpenAnswerHeight({
  scrollHeight: line * 5 + pad,
  lineHeight: line,
  paddingY: pad,
  cssMaxHeight: line * 3 + pad - 4,
});
assert.equal(cssCapped.height, line * 3 + pad - 4);
assert.equal(cssCapped.overflowY, "auto");

console.log("ok");
