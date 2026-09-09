/**
 * Website-structure parser (IA upload for SEO twin).
 * Run: npx tsx scripts/test-website-structure.ts
 */
import assert from "node:assert/strict";

import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  formatWebsiteStructureForPrompt,
  parseWebsiteStructure,
} from "../lib/dt/seo/website-structure";

function testMarkdownTree() {
  const parsed = parseWebsiteStructure(`
- Startseite /
  - Leistungen /leistungen
    - SEO /leistungen/seo
    - Websites /leistungen/websites
  - Über uns /ueber-uns
  - Kontakt /kontakt
`);
  assert.equal(parsed.format, "markdown");
  assert.equal(parsed.nodeCount, 6);
  assert.match(parsed.outline, /Startseite/);
  assert.match(parsed.outline, /Leistungen — \/leistungen/);
  assert.match(parsed.outline, /SEO — \/leistungen\/seo/);
  console.log("markdown tree: ok");
}

function testSitemapXml() {
  const parsed = parseWebsiteStructure(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/leistungen</loc></url>
  <url><loc>https://example.com/leistungen/seo</loc></url>
</urlset>`);
  assert.equal(parsed.format, "sitemap");
  assert.ok(parsed.nodeCount >= 3);
  assert.match(parsed.outline, /leistungen/i);
  console.log("sitemap xml: ok");
}

function testJsonTree() {
  const parsed = parseWebsiteStructure(
    JSON.stringify({
      pages: [
        {
          label: "Home",
          path: "/",
          children: [{ title: "Blog", url: "/blog" }],
        },
      ],
    }),
  );
  assert.equal(parsed.format, "json");
  assert.equal(parsed.nodeCount, 2);
  assert.match(parsed.outline, /Home/);
  assert.match(parsed.outline, /Blog/);
  console.log("json tree: ok");
}

function testUrlList() {
  const parsed = parseWebsiteStructure(`
https://firma.de/
https://firma.de/team
https://firma.de/team/anna
`);
  assert.ok(parsed.nodeCount >= 3);
  assert.match(parsed.outline, /team/i);
  console.log("url list: ok");
}

function testCsv() {
  const parsed = parseWebsiteStructure(`title,url
Startseite,https://example.com/
Kontakt,https://example.com/kontakt
`);
  assert.equal(parsed.format, "csv");
  assert.ok(parsed.nodeCount >= 2);
  assert.match(parsed.outline, /Kontakt/i);
  console.log("csv: ok");
}

function testPromptIncludesImprovementHint() {
  const parsed = parseWebsiteStructure("- Home /\n  - Blog /blog\n");
  const text = formatWebsiteStructureForPrompt({
    outline: parsed.outline,
    nodeCount: parsed.nodeCount,
    filename: "struktur.md",
    uploadedAt: "2026-09-09T12:00:00.000Z",
  });
  assert.match(text, /## Webseitenstruktur \(hochgeladen\)/);
  assert.match(text, /Verbesserungen/);
  assert.match(text, /Crawl/);
  console.log("prompt format: ok");
}

function testSeoPromptInjectsStructure() {
  const parsed = parseWebsiteStructure("- Home /\n  - Leistungen /leistungen\n");
  const structureText = formatWebsiteStructureForPrompt({
    outline: parsed.outline,
    nodeCount: parsed.nodeCount,
    filename: "ia.md",
  });
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "SEO-Berater",
      role: "SEO",
      prompt_template: "Du berätst zu SEO.",
      kind: "seo_advisor",
      slug: "seo_advisor",
    },
    org: { display_name: "Beispiel GmbH", website_url: "https://example.com" },
    mode: "seo",
    websiteStructureText: structureText,
  });
  assert.match(prompt, /Webseitenstruktur/);
  assert.match(prompt, /Leistungen/);
  console.log("seo prompt inject: ok");
}

function testProspectOmitsStructure() {
  const parsed = parseWebsiteStructure("- Home /\n  - Secret /secret\n");
  const structureText = formatWebsiteStructureForPrompt({
    outline: parsed.outline,
    nodeCount: parsed.nodeCount,
  });
  const prompt = buildDtSystemPrompt({
    agent: {
      name: "Joachim",
      role: "Interessent",
      prompt_template: "Ich bin Interessent.",
      kind: "persona",
      slug: "joachim",
    },
    org: { display_name: "Beispiel GmbH" },
    mode: "default",
    websiteStructureText: structureText,
  });
  assert.doesNotMatch(prompt, /Webseitenstruktur/);
  assert.doesNotMatch(prompt, /\/secret/);
  console.log("prospect omits structure: ok");
}

function testEmptyRejected() {
  assert.throws(() => parseWebsiteStructure("   \n  "), /kein text/i);
  console.log("empty rejected: ok");
}

testMarkdownTree();
testSitemapXml();
testJsonTree();
testUrlList();
testCsv();
testPromptIncludesImprovementHint();
testSeoPromptInjectsStructure();
testProspectOmitsStructure();
testEmptyRejected();
console.log("ok: website structure");
