/**
 * Diktieren im Chat: text merging and recogniser result handling (pure helpers).
 * Run: npx tsx scripts/test-speech-dictation.ts
 */
import assert from "node:assert/strict";

import {
  cleanTranscript,
  collectDictationResults,
  dictationErrorMessage,
  isSpeechRecognitionSupported,
  mergeDictationText,
  normalizeDictationError,
} from "../lib/shared/speech-dictation";

assert.equal(cleanTranscript("  hallo   welt , wie geht es ?  "), "hallo welt, wie geht es?");

assert.equal(mergeDictationText("", "Hallo Peter"), "Hallo Peter");
assert.equal(mergeDictationText("Hallo", "Peter"), "Hallo Peter");
assert.equal(mergeDictationText("Hallo ", "Peter"), "Hallo Peter");
assert.equal(mergeDictationText("Erste Zeile\n", "zweite Zeile"), "Erste Zeile\nzweite Zeile");
assert.equal(mergeDictationText("Bleibt", "   "), "Bleibt");

const results = [
  { isFinal: true, 0: { transcript: "Hallo, " }, length: 1 },
  { isFinal: true, 0: { transcript: "stell dich bitte kurz vor." }, length: 1 },
  { isFinal: false, 0: { transcript: " was weißt" }, length: 1 },
];
const collected = collectDictationResults(results);
assert.equal(collected.finalText, "Hallo, stell dich bitte kurz vor.");
assert.equal(collected.interimText, "was weißt");
assert.equal(
  mergeDictationText("Vorab:", `${collected.finalText} ${collected.interimText}`),
  "Vorab: Hallo, stell dich bitte kurz vor. was weißt",
);

assert.equal(normalizeDictationError("service-not-allowed"), "not-allowed");
assert.equal(normalizeDictationError("something-else"), "unknown");
assert.ok(dictationErrorMessage("not-allowed").includes("Mikrofon"));
assert.ok(dictationErrorMessage("unsupported").includes("Chrome"));

// Node has no window: the helper must say "unsupported" instead of throwing.
assert.equal(isSpeechRecognitionSupported(), false);

console.log("speech-dictation tests: ok");
