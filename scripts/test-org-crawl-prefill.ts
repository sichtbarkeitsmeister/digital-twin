/**
 * Crawl prefill heuristics for Fragebogen wizard.
 * Run: npx tsx scripts/test-org-crawl-prefill.ts
 */
import assert from "node:assert/strict";

import {
  suggestPrefillsFromCrawl,
  type OrgCrawlContext,
} from "../lib/surveys/org-crawl-prefill";

const context: OrgCrawlContext = {
  organisationId: "00000000-0000-0000-0000-000000000001",
  organisationName: "Online Media Atelier",
  websiteUrl: "https://onlinemediaatelier.de",
  pageCount: 3,
  snippets: [
    {
      url: "https://onlinemediaatelier.de/leistungen",
      title: "Leistungen",
      snippet:
        "Wir bieten strategische Social-Media-Beratung mit integrierter Wissensvermittlung.",
    },
  ],
  pageExcerpts: [
    {
      url: "https://onlinemediaatelier.de/",
      title: "Home",
      text: "Online Media Atelier · Strategische Social-Media-Beratung für den Mittelstand. Unser Fokus liegt auf nachhaltiger Befähigung der Kunden. Wir sind 12 Mitarbeiter in NRW. Was uns unterscheidet: praxisnahe Workshops statt Agentur-Blackbox.",
    },
  ],
  summaryText: "",
};
context.summaryText = `${context.organisationName}\n${context.pageExcerpts[0]!.text}`;

const prefills = suggestPrefillsFromCrawl({
  context,
  hints: [
    { key: "company_name", hint: "org_name" },
    { key: "website", hint: "website" },
    { key: "employee_count", hint: "employee_count" },
    { key: "focus", hint: "focus" },
    { key: "services", hint: "services" },
    { key: "usp", hint: "usp" },
    { key: "region", hint: "region" },
  ],
});

assert.equal(prefills.company_name?.value, "Online Media Atelier");
assert.equal(prefills.website?.value, "https://onlinemediaatelier.de");
assert.match(prefills.employee_count?.value ?? "", /12/);
assert.ok(prefills.focus?.value, "focus from crawl");
assert.ok(prefills.services?.value || prefills.focus?.value, "services or focus");
assert.ok(prefills.usp?.value, "usp from crawl");
assert.ok(prefills.region?.value, "region from crawl");

console.log("org-crawl-prefill: ok");
