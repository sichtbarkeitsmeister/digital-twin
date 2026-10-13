/**
 * Grounding page prompt: target groups and the output gate.
 * Run: npx tsx scripts/test-grounding-pages-prompt.ts
 */
import assert from "node:assert/strict";

import {
  GROUNDING_PAGES_AUDIENCE_TOKEN,
  buildGroundingPagesPrompt,
  defaultGroundingPagesRules,
  isDefaultGroundingPagesRules,
  resolveGroundingPagesRules,
} from "../lib/dt/prompts/grounding-pages-prompt";
import {
  groundingStartDraft,
  parseGroundingEntityPages,
  slugifyGroundingName,
} from "../lib/dt/seo/grounding-pages";
import { extractGroundingLiveFacts } from "../lib/dt/seo/detect-grounding-page-date";

const prompt = buildGroundingPagesPrompt({
  websiteUrl: "https://www.existenzstand.de",
  customerSlug: "existenzstand",
  competitors: ["Gründercoach A"],
  llmsTxtUrl: "https://existenzstand.de/llms.txt",
  hubUrl: "https://existenzstand.de/grounding/",
  hub: {
    url: "https://existenzstand.de/grounding/",
    uploadedAt: "2026-09-01T12:00:00.000Z",
    dateModified: "2026-09-02T12:00:00.000Z",
    lastReviewed: "2026-01-15T12:00:00.000Z",
    reviewedBy: null,
    notes: null,
    releaseStatus: "draft",
    standardVersion: "v1.6",
  },
  entities: [
    {
      title: "AVGS",
      slug: "avgs",
      url: "https://existenzstand.de/grounding/avgs/",
      uploadedAt: null,
      dateModified: null,
      lastReviewed: null,
      reviewedBy: null,
      notes: null,
      releaseStatus: "draft",
      standardVersion: null,
    },
  ],
  command: "erstelle",
  explicitRebuild: true,
  audienceText: [
    "### Wunschkunde: Markus (Gründungsinteressent)",
    "Will einen AVGS-Antrag stellen.",
    "",
    "### Wunschkunde: Daniel (Wachstumsgründer)",
    "Sucht Begleitung nach dem Start.",
  ].join("\n"),
  now: "2026-10-12T12:00:00.000Z",
});

assert.match(prompt, /Ziel-Domain: existenzstand\.de/);
assert.match(prompt, /grounding_existenzstand\.html/);
assert.match(prompt, /Hinterlegt sind 2 Zielgruppen/);
assert.match(prompt, /einen je Zielgruppe/);
assert.match(prompt, /Avatar-Namen/);
assert.match(prompt, /### Wunschkunde: Markus/);
assert.match(prompt, /entity-cards/);
assert.match(prompt, /Anfragen & Lösungen/);
assert.match(prompt, /Stammdaten nur einmal/);
assert.match(prompt, /Weitere Grounding Pages/);
assert.match(prompt, /kein img/);
assert.match(prompt, /überfällig/);
assert.match(prompt, /Neubau ausdrücklich/);
assert.match(prompt, /https:\/\/existenzstand\.de\/grounding\/avgs\//);
assert.doesNotMatch(prompt, /\{DOMAIN\}/);
assert.doesNotMatch(prompt, /\{KUNDE\}/);
assert.doesNotMatch(prompt, /\{\{ZIELGRUPPEN\}\}/);
assert.equal(prompt.split("## ROLLE").length - 1, 1);
assert.equal(prompt.split("## AUSGABESPERRE").length - 1, 1);
assert.equal(prompt.split("## MODUL 0").length - 1, 1);
assert.ok(prompt.indexOf("## AKTUELLER TOOL-KONTEXT") < prompt.indexOf("## ROLLE"));
assert.ok(prompt.indexOf("## AUSGABESPERRE") < prompt.indexOf("## DIESER AUFTRAG"));
assert.equal(isDefaultGroundingPagesRules(defaultGroundingPagesRules()), true);
assert.equal(isDefaultGroundingPagesRules("  "), true);
assert.equal(resolveGroundingPagesRules(null), defaultGroundingPagesRules());

const custom = buildGroundingPagesPrompt({
  websiteUrl: "https://www.existenzstand.de",
  customerSlug: "existenzstand",
  competitors: [],
  llmsTxtUrl: null,
  hubUrl: null,
  hub: {
    url: null,
    uploadedAt: null,
    dateModified: null,
    lastReviewed: null,
    reviewedBy: null,
    notes: null,
    releaseStatus: null,
    standardVersion: null,
  },
  entities: [],
  command: "pruefe",
  explicitRebuild: false,
  audienceText: "### Wunschkunde: Markus (Gründungsinteressent)\nWill einen AVGS-Antrag stellen.",
  rulesText: `Eigene Regel für {KUNDE} vor dem Profil.\n\n${GROUNDING_PAGES_AUDIENCE_TOKEN}\n\nDanach nichts aus Modul 0.`,
});
assert.match(custom, /Eigene Regel für existenzstand/);
assert.match(custom, /Hinterlegt sind 1 Zielgruppe/);
assert.match(custom, /### Wunschkunde: Markus/);
assert.doesNotMatch(custom, /## MODUL 0/);
assert.doesNotMatch(custom, /\{\{ZIELGRUPPEN\}\}/);
assert.match(custom, /Ziel-Domain: existenzstand\.de/);

const withoutToken = buildGroundingPagesPrompt({
  websiteUrl: null,
  customerSlug: null,
  competitors: [],
  llmsTxtUrl: null,
  hubUrl: null,
  hub: {
    url: null,
    uploadedAt: null,
    dateModified: null,
    lastReviewed: null,
    reviewedBy: null,
    notes: null,
    releaseStatus: null,
    standardVersion: null,
  },
  entities: [],
  command: "aktualisiere",
  explicitRebuild: false,
  audienceText: "### Wunschkunde: Daniel (Wachstumsgründer)\nSucht Begleitung.",
  rulesText: "Nur diese Zeile, ohne Token.",
});
assert.match(withoutToken, /Nur diese Zeile, ohne Token/);
assert.match(withoutToken, /### Wunschkunde: Daniel/);
assert.match(withoutToken, /Hinterlegt sind 1 Zielgruppe/);
assert.ok(withoutToken.indexOf("Nur diese Zeile") < withoutToken.indexOf("### Wunschkunde: Daniel"));

const emptyAudiences = buildGroundingPagesPrompt({
  websiteUrl: null,
  customerSlug: null,
  competitors: [],
  llmsTxtUrl: null,
  hubUrl: null,
  hub: {
    url: null,
    uploadedAt: null,
    dateModified: null,
    lastReviewed: null,
    reviewedBy: null,
    notes: null,
    releaseStatus: null,
    standardVersion: null,
  },
  entities: [],
  command: "pruefe",
  explicitRebuild: false,
  audienceText: "Noch keine Wunschkunden hinterlegt.",
});
assert.match(emptyAudiences, /Erfinde keine/);
assert.match(emptyAudiences, /Befehl des Nutzers: prüfe/);

assert.equal(slugifyGroundingName("Tragfähigkeitsbescheinigung"), "tragfaehigkeitsbescheinigung");
assert.equal(
  parseGroundingEntityPages([
    { title: "AVGS", slug: "avgs" },
    { title: "Doppelt", slug: "avgs" },
    { title: "", slug: "leer" },
  ]).map((page) => page.slug).join(","),
  "avgs",
);

assert.match(groundingStartDraft("aktualisiere", true), /^aktualisiere$/);
assert.match(groundingStartDraft("erstelle", true), /Neubau ausdrücklich/);

const facts = extractGroundingLiveFacts({
  now: new Date("2026-10-12T12:00:00.000Z"),
  html: `
    <html><body>
      <p>Zuletzt geprüft: 9. Oktober 2026</p>
      <p>Prüfer: ExistenzStand GmbH</p>
      <script type="application/ld+json">
        {"@type":"WebPage","dateModified":"2026-09-02","lastReviewed":"2026-09-01","reviewedBy":{"@type":"Organization","name":"ExistenzStand GmbH"}}
      </script>
    </body></html>
  `,
});
assert.equal(facts.lastReviewed?.sourceLabel, "JSON-LD lastReviewed");
assert.equal(facts.lastReviewed?.at.slice(0, 10), "2026-09-01");
assert.equal(facts.dateModified?.sourceLabel, "JSON-LD dateModified");
assert.equal(facts.reviewedBy?.name, "ExistenzStand GmbH");
assert.equal(facts.reviewedBy?.sourceLabel, "JSON-LD reviewedBy");

const visibleOnly = extractGroundingLiveFacts({
  now: new Date("2026-10-12T12:00:00.000Z"),
  html: "<p>Zuletzt geprüft: 09.10.2026. Geprüft von: Martina Beispiel.</p>",
});
assert.equal(visibleOnly.lastReviewed?.sourceLabel, "sichtbarer Prüfhinweis");
assert.equal(visibleOnly.lastReviewed?.at.slice(0, 10), "2026-10-09");
assert.match(visibleOnly.reviewedBy?.name ?? "", /Martina Beispiel/);

console.log("grounding-pages-prompt tests: ok");
