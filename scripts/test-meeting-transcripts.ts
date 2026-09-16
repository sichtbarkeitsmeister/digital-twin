/**
 * Meeting-transcript extract/merge helpers.
 * Run: npx tsx scripts/test-meeting-transcripts.ts
 */
import assert from "node:assert/strict";

import { mergeMarkedBlock } from "../lib/dt/transcripts/apply-knowledge";
import { formatTranscriptKnowledgeForPrompt } from "../lib/dt/transcripts/format-for-prompt";
import { parseTranscriptExtractJson } from "../lib/dt/transcripts/parse-extract";
import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  clipTranscriptRaw,
  sanitizeTranscriptText,
  slugFromPersonaName,
} from "../lib/dt/transcripts/sanitize";
import {
  TRANSCRIPT_ANBIETER_END,
  TRANSCRIPT_ANBIETER_START,
} from "../lib/dt/transcripts/types";

function testSanitizeAndSlug() {
  assert.equal(sanitizeTranscriptText("Hallo\u0000 Welt").includes("\u0000"), false);
  const long = "x".repeat(200_000);
  assert.ok(clipTranscriptRaw(long).length < 200_000);
  assert.equal(slugFromPersonaName("Jürgen Maßmann"), "juergen_massmann");
  console.log("sanitize + slug: ok");
}

function testParseExtract() {
  const extract = parseTranscriptExtractJson({
    title: "Kick-off Westprüfung",
    summary: "Gespräch über Wunschkunden und Leistungen der Kanzlei.",
    anbieterMarkdown: "## Leistungen\n- Jahresabschluss\n- Lohn",
    personas: [
      {
        name: "Leitung Pflegeheim",
        role: "Einrichtungsleitung",
        priority: "A",
        isPrimary: true,
        description: "Sucht verlässliche Steuerberatung für stationäre Pflege.",
        goals: "Rechtssicherheit",
        pains: "Fristen",
        objections: "Wechselaufwand",
        language: "klar, wenig Fachchinesisch",
        buyingTriggers: "Steuerberater geht in Ruhestand",
        promptAppend:
          "Ich leite ein Pflegeheim und brauche jemanden, der Fristen im Blick hat und nicht mit Floskeln kommt. ".repeat(
            3,
          ),
      },
    ],
  });
  assert.equal(extract.personas.length, 1);
  assert.equal(extract.personas[0]?.priority, "A");
  assert.match(extract.anbieterMarkdown, /Jahresabschluss/);
  console.log("parse extract: ok");
}

function testMergeBlock() {
  const first = mergeMarkedBlock(
    "Bestehender Text",
    TRANSCRIPT_ANBIETER_START,
    TRANSCRIPT_ANBIETER_END,
    "Fakt A",
    "## Anbieter-Wissen (Meeting-Transkripte)",
  );
  assert.match(first, /Bestehender Text/);
  assert.match(first, /Fakt A/);
  const second = mergeMarkedBlock(
    first,
    TRANSCRIPT_ANBIETER_START,
    TRANSCRIPT_ANBIETER_END,
    "Fakt B",
    "## Anbieter-Wissen (Meeting-Transkripte)",
  );
  assert.doesNotMatch(second, /Fakt A/);
  assert.match(second, /Fakt B/);
  assert.equal(second.indexOf(TRANSCRIPT_ANBIETER_START), second.lastIndexOf(TRANSCRIPT_ANBIETER_START));
  const cleared = mergeMarkedBlock(
    second,
    TRANSCRIPT_ANBIETER_START,
    TRANSCRIPT_ANBIETER_END,
    "",
    "## Anbieter-Wissen (Meeting-Transkripte)",
  );
  assert.doesNotMatch(cleared, /Fakt B/);
  assert.match(cleared, /Bestehender Text/);
  assert.equal(cleared.includes(TRANSCRIPT_ANBIETER_START), false);
  console.log("merge block: ok");
}

function testPromptFormatAndGating() {
  const text = formatTranscriptKnowledgeForPrompt({
    transcripts: [
      {
        title: "Kick-off",
        filename: "meeting.txt",
        summary: "Wir haben A-Mandate in der Pflege definiert.",
        anbieterMarkdown: "Kanzlei sitzt in Münster.",
        personas: [
          {
            name: "Leitung Pflegeheim",
            role: "Einrichtungsleitung",
            priority: "A",
            isPrimary: true,
            description: "Sucht Verlässlichkeit.",
            goals: null,
            pains: null,
            objections: null,
            language: null,
            buyingTriggers: null,
            promptAppend: "Ich leite ein Heim.",
          },
        ],
        processedAt: "2026-09-16T10:00:00.000Z",
      },
    ],
  });
  assert.match(text, /Meeting-Transkripte/);
  assert.match(text, /Anbieterwissen/);
  assert.match(text, /Leitung Pflegeheim/);

  const seo = buildDtSystemPrompt({
    agent: {
      name: "SEO-Berater",
      role: "SEO",
      prompt_template: "Du berätst zu SEO.",
      kind: "seo_advisor",
      slug: "seo_advisor",
    },
    org: { display_name: "Beispiel GmbH" },
    mode: "seo",
    transcriptKnowledgeText: text,
  });
  assert.match(seo, /Kick-off/);
  assert.match(seo, /A-Mandate/);

  const persona = buildDtSystemPrompt({
    agent: {
      name: "Joachim",
      role: "Interessent",
      prompt_template: "Ich bin Interessent.",
      kind: "persona",
      slug: "joachim",
    },
    org: { display_name: "Beispiel GmbH" },
    mode: "default",
    transcriptKnowledgeText: text,
  });
  assert.doesNotMatch(persona, /A-Mandate/);
  console.log("prompt format + gating: ok");
}

testSanitizeAndSlug();
testParseExtract();
testMergeBlock();
testPromptFormatAndGating();
console.log("ok: meeting transcripts");
