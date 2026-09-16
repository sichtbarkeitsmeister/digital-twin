/**
 * Meeting-transcript extract/merge helpers.
 * Run: npx tsx scripts/test-meeting-transcripts.ts
 */
import assert from "node:assert/strict";

import type Anthropic from "@anthropic-ai/sdk";

import {
  closeTruncatedJsonObject,
  stripTrailingCommasInJson,
  tryParseJsonObject,
} from "../lib/ai/anthropic-helpers";
import { mergeMarkedBlock } from "../lib/dt/transcripts/apply-knowledge";
import { jsonFromTranscriptResponse } from "../lib/dt/transcripts/extract";
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

function testLlmJsonRepair() {
  const trailing = tryParseJsonObject(`{"title":"Kick-off","summary":"Gespräch über Mandate",}`);
  assert.equal(trailing?.title, "Kick-off");
  assert.equal(trailing?.summary, "Gespräch über Mandate");

  const smart = tryParseJsonObject(`{“title”: “Kick-off”, “summary”: “Gespräch”}`);
  assert.equal(smart?.title, "Kick-off");
  assert.equal(smart?.summary, "Gespräch");

  const fenced = tryParseJsonObject('```json\n{"title":"A","summary":"B"}\n```');
  assert.equal(fenced?.title, "A");

  const truncatedRaw =
    '{"title":"Kick-off","summary":"Gespräch über Wunschkunden","anbieterMarkdown":"## Kanzlei\\n- Lohn","personas":[{"name":"Leitung Pflegeheim","description":"Sucht Verlässlichkeit.","promptAppend":"Ich leite ein Heim und brauche';
  const closed = closeTruncatedJsonObject(truncatedRaw);
  assert.ok(closed);
  const truncated = tryParseJsonObject(truncatedRaw);
  assert.equal(truncated?.title, "Kick-off");
  assert.equal(typeof truncated?.personas, "object");
  assert.equal(stripTrailingCommasInJson('{"a":1,}'), '{"a":1}');
  console.log("llm json repair: ok");
}

function testParseExtractSkipsBrokenPersona() {
  const extract = parseTranscriptExtractJson({
    title: "Kick-off",
    summary: "Gespräch über Wunschkunden und Leistungen der Kanzlei.",
    anbieterMarkdown: "## Leistungen\n- Jahresabschluss",
    personas: [
      {
        name: "Leitung Pflegeheim",
        role: "Einrichtungsleitung",
        priority: "a",
        description: "Sucht verlässliche Steuerberatung für stationäre Pflege.",
        promptAppend:
          "Ich leite ein Pflegeheim und brauche jemanden, der Fristen im Blick hat. ".repeat(4),
      },
      { name: "x" },
      "kein objekt",
    ],
  });
  assert.equal(extract.personas.length, 1);
  assert.equal(extract.personas[0]?.priority, "A");
  console.log("parse extract skips broken persona: ok");
}

function testJsonFromTranscriptResponse() {
  const fromTool = jsonFromTranscriptResponse({
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "submit_transcript_extract",
        input: {
          title: "Kick-off",
          summary: "Gespräch.",
          anbieterMarkdown: "- Lohn",
          personas: [],
        },
      },
    ],
  } as Anthropic.Messages.Message);
  assert.equal((fromTool as { title?: string } | null)?.title, "Kick-off");

  const fromText = jsonFromTranscriptResponse({
    content: [
      {
        type: "text",
        text: 'Hier:\n{"title":"Westprüfung","summary":"Interview.","anbieterMarkdown":"- Steuer","personas":[]}',
      },
    ],
  } as Anthropic.Messages.Message);
  assert.equal((fromText as { title?: string } | null)?.title, "Westprüfung");
  console.log("json from transcript response: ok");
}

testSanitizeAndSlug();
testParseExtract();
testParseExtractSkipsBrokenPersona();
testLlmJsonRepair();
testJsonFromTranscriptResponse();
testMergeBlock();
testPromptFormatAndGating();
console.log("ok: meeting transcripts");
