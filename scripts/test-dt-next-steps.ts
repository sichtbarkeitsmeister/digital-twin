/**
 * „Nächste Schritte“ buttons under a chat answer (dt-next block).
 * Run: npx tsx scripts/test-dt-next-steps.ts
 */
import assert from "node:assert/strict";

import { extractDtNextStepsFromMessage, parseDtNextStepsFromText, stripDtNextStepBlocks } from "../lib/dt/chat/next-steps";

const text = `Alles klar.\n\n\`\`\`dt-next\n[{"label":"Hub-Entwurf jetzt erstellen","message":"Ja, erstelle den Hub-Entwurf unter https://existenzstand.de/grounding/."},{"label":"Erst Fakten klären","message":"Welche Fakten fehlen noch?"},{"label":"","message":"x"},{"label":"Doppelt","message":"welche fakten fehlen noch?"}]\n\`\`\`\n`;
const steps = parseDtNextStepsFromText(text);
assert.equal(steps.length, 2);
assert.equal(steps[0]?.label, "Hub-Entwurf jetzt erstellen");
assert.equal(stripDtNextStepBlocks(text), "Alles klar.");
assert.equal(parseDtNextStepsFromText("```dt-next\nnicht json\n```").length, 0);
assert.equal(extractDtNextStepsFromMessage({ content: "ohne", metadata: { next_steps: [{ label: "A", message: "a" }] } })[0]?.label, "A");
assert.equal(extractDtNextStepsFromMessage({ content: text, metadata: {} }).length, 2);
console.log("dt-next-steps tests: ok");
