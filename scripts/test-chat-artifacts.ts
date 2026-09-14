/**
 * Chat artifacts (HTML/text downloads) for DigitalTwin replies.
 * Run: npx tsx scripts/test-chat-artifacts.ts
 */
import assert from "node:assert/strict";

import {
  contentWithDtChatArtifactsForLlm,
  extractDtChatArtifactsFromMessage,
  parseDtChatArtifactsFromText,
  sanitizeDtChatArtifactFilename,
  stripDtChatArtifactBlocks,
} from "../lib/dt/chat-artifacts";
import { finalizeDtAssistantContent } from "../lib/dt/finalize-assistant-message";
import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  buildDtChatStaticSystemText,
  buildProspectStaticSystemText,
} from "../lib/dt/prompts/system-static";
import { DT_SEO_MODE_INSTRUCTIONS } from "../lib/dt/seo/build-seo-context";

const NAV_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Westprüfung Navigation</title>
  <style>
    body { font-family: sans-serif; margin: 0; }
    nav { background: #123; color: #fff; padding: 12px 20px; }
    a { color: #fff; margin-right: 16px; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Start</a>
    <a href="/leistungen">Leistungen</a>
    <a href="/kontakt">Kontakt</a>
  </nav>
  <main><h1>Navigations-Prototyp</h1><p>Klickbare Struktur zum Ausprobieren.</p></main>
</body>
</html>`;

function testHeaderHtmlArtifact() {
  const text = [
    "Hier der klickbare Navigationsprototyp.",
    "",
    "```dt-artifact",
    "filename: westpruefung-navigation-prototyp.html",
    "mimeType: text/html",
    "",
    NAV_HTML,
    "```",
  ].join("\n");

  const artifacts = parseDtChatArtifactsFromText(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.filename, "westpruefung-navigation-prototyp.html");
  assert.equal(artifacts[0]?.mimeType, "text/html");
  assert.match(artifacts[0]?.content ?? "", /<!DOCTYPE html>/);
  assert.match(artifacts[0]?.content ?? "", /Westprüfung Navigation/);

  const stripped = stripDtChatArtifactBlocks(text);
  assert.match(stripped, /klickbare Navigationsprototyp/);
  assert.doesNotMatch(stripped, /dt-artifact/);
  assert.doesNotMatch(stripped, /<!DOCTYPE html>/);
  console.log("header html artifact: ok");
}

function testBareHtmlFenceBecomesDownload() {
  const text = `Vorschau der neuen Navigation:\n\n\`\`\`html\n${NAV_HTML}\n\`\`\``;
  const artifacts = parseDtChatArtifactsFromText(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.mimeType, "text/html");
  assert.match(artifacts[0]?.filename ?? "", /\.html$/);
  assert.match(artifacts[0]?.filename ?? "", /Westpr/i);
  console.log("bare html fence: ok");
}

function testSmallHtmlSnippetIsNotAnArtifact() {
  const text = "Beispiel:\n\n```html\n<div class=\"nav\">Home</div>\n```\n";
  assert.equal(parseDtChatArtifactsFromText(text).length, 0);
  assert.match(stripDtChatArtifactBlocks(text), /class="nav"/);
  console.log("small html snippet ignored: ok");
}

function testNamedTextFile() {
  const text = [
    "```md:ia-vorschlag.md",
    "# Start",
    "- Leistungen",
    "- Kontakt",
    "```",
  ].join("\n");
  const artifacts = parseDtChatArtifactsFromText(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.filename, "ia-vorschlag.md");
  assert.equal(artifacts[0]?.mimeType, "text/markdown");
  console.log("named markdown file: ok");
}

function testJsonArtifactAndNul() {
  const payload = {
    filename: "notizen.txt",
    mimeType: "text/plain",
    content: "Zeile 1\u0000\nZeile 2",
  };
  const text = "```dt-artifact\n" + JSON.stringify(payload) + "\n```";
  const artifacts = parseDtChatArtifactsFromText(text);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.content.includes("\u0000"), false);
  assert.match(artifacts[0]?.content ?? "", /Zeile 2/);
  console.log("json artifact + nul: ok");
}

function testLeavesSeoTaskFence() {
  const text = [
    "Maßnahmen:",
    "```dt-tasks",
    '[{"title":"Title kürzen","keyword":"test","url":"https://example.de/","action":"Title anpassen"}]',
    "```",
    "",
    "```dt-artifact",
    "filename: notes.txt",
    "mimeType: text/plain",
    "",
    "Bitte intern prüfen.",
    "```",
  ].join("\n");
  const stripped = stripDtChatArtifactBlocks(text);
  assert.match(stripped, /dt-tasks/);
  assert.doesNotMatch(stripped, /dt-artifact/);
  const finalized = finalizeDtAssistantContent(text, "seo");
  assert.equal(finalized.artifacts.length, 1);
  assert.equal(finalized.seoTaskProposals.length, 1);
  assert.doesNotMatch(finalized.content, /dt-tasks/);
  assert.doesNotMatch(finalized.content, /Bitte intern prüfen/);
  console.log("seo tasks survive artifact strip: ok");
}

function testMetadataRoundtrip() {
  const original = [
    "Erklärung",
    "```dt-artifact",
    "filename: proto.html",
    "mimeType: text/html",
    "",
    NAV_HTML,
    "```",
  ].join("\n");
  const finalized = finalizeDtAssistantContent(original, "default");
  const fromMeta = extractDtChatArtifactsFromMessage({
    content: finalized.content,
    metadata: { chat_artifacts: finalized.artifacts },
  });
  assert.equal(fromMeta.length, 1);
  const forLlm = contentWithDtChatArtifactsForLlm(finalized.content, {
    chat_artifacts: finalized.artifacts,
  });
  assert.match(forLlm, /Erklärung/);
  assert.match(forLlm, /dt-artifact/);
  assert.match(forLlm, /<!DOCTYPE html>/);
  console.log("metadata roundtrip: ok");
}

function testFilenameSanitizesPath() {
  assert.equal(
    sanitizeDtChatArtifactFilename("../../westprüfung nav.html", ".html"),
    "westprüfung_nav.html",
  );
  console.log("filename sanitize: ok");
}

function testStaffPromptHasArtifactsProspectDoesNot() {
  const staff = buildDtChatStaticSystemText();
  assert.match(staff, /dt-artifact/);
  assert.match(staff, /text\/html/);
  const prospect = buildProspectStaticSystemText();
  assert.doesNotMatch(prospect, /dt-artifact/);

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
  });
  assert.match(seo, /dt-artifact/);
  assert.match(seo, /HTML-Prototypen/);
  assert.match(DT_SEO_MODE_INSTRUCTIONS, /HTML-Prototypen/);

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
  });
  assert.doesNotMatch(persona, /dt-artifact/);
  console.log("prompt gating: ok");
}

testHeaderHtmlArtifact();
testBareHtmlFenceBecomesDownload();
testSmallHtmlSnippetIsNotAnArtifact();
testNamedTextFile();
testJsonArtifactAndNul();
testLeavesSeoTaskFence();
testMetadataRoundtrip();
testFilenameSanitizesPath();
testStaffPromptHasArtifactsProspectDoesNot();
console.log("ok: chat artifacts");
