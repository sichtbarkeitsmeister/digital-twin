/**
 * Crawl prefill heuristics for Fragebogen wizard.
 * Run: npx tsx scripts/test-org-crawl-prefill.ts
 */
import assert from "node:assert/strict";

import {
  suggestPrefillsFromCrawl,
  classifyCrawlPage,
  crawlPageKindLabel,
  crawlPagePriority,
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
      text: "Online Media Atelier · Strategische Social-Media-Beratung für den Mittelstand. Unser Fokus liegt auf nachhaltiger Befähigung der Kunden. Wir sind 12 Mitarbeiter in NRW. Gegründet 2014. Was uns unterscheidet: praxisnahe Workshops statt Agentur-Blackbox. Geschäftsführerin: Julia Schröder. Mitbewerber sind oft klassische Social-Media-Agenturen ohne Wissensvermittlung. 4,8 Sterne bei 37 Google Bewertungen. Instagram.com/oma und facebook.com/oma. Adresse: Musterstraße 12, 44135 Dortmund. Öffnungszeiten: Mo–Fr 9–17 Uhr.",
    },
  ],
  summaryText: "",
  seoMetrics: {
    periodMonth: "2026-07-01",
    impressions: 12400,
    totalClicks: 830,
    aiClicks: 42,
    rankingsTop10: 18,
    rankingsTop3: 5,
    visibilityIndex: 12.4,
    topKeywords: ["social media beratung", "workshop nrw"],
  },
};
context.summaryText = `${context.organisationName}\n${context.pageExcerpts[0]!.text}`;

const prefills = suggestPrefillsFromCrawl({
  context,
  hints: [
    { key: "company_name", hint: "org_name" },
    { key: "website", hint: "website" },
    { key: "employee_count", hint: "employee_count" },
    { key: "owner_name", hint: "owner_name" },
    { key: "focus", hint: "focus" },
    { key: "services", hint: "services" },
    { key: "usp", hint: "usp" },
    { key: "region", hint: "region" },
    { key: "competitors", hint: "competitors" },
    { key: "team_members", hint: "team_members" },
    { key: "years_staff", hint: "years_staff" },
    { key: "proven_metrics", hint: "seo_metrics" },
    { key: "reviews", hint: "reviews" },
    { key: "hours", hint: "opening_hours" },
    { key: "nap", hint: "nap_address" },
    { key: "online", hint: "online_channels" },
  ],
});

assert.equal(prefills.company_name?.value, "Online Media Atelier");
assert.equal(prefills.website?.value, "https://onlinemediaatelier.de");
assert.match(prefills.employee_count?.value ?? "", /12/);
assert.equal(prefills.owner_name?.value, "Julia Schröder");
assert.ok(prefills.focus?.value, "focus from crawl");
assert.ok(prefills.services?.value || prefills.focus?.value, "services or focus");
assert.ok(prefills.usp?.value, "usp from crawl");
assert.ok(prefills.region?.value, "region from crawl");
assert.ok(prefills.competitors?.value, "competitors from crawl");
assert.match(prefills.team_members?.value ?? "", /Julia Schröder/);
assert.match(prefills.years_staff?.value ?? "", /2014/);
assert.match(prefills.years_staff?.value ?? "", /12/);
assert.match(prefills.proven_metrics?.value ?? "", /12400/);
assert.match(prefills.reviews?.value ?? "", /37/);
assert.match(prefills.hours?.value ?? "", /Öffnungszeiten|Mo/i);
assert.match(prefills.nap?.value ?? "", /Musterstraße|Dortmund/);
assert.match(prefills.online?.value ?? "", /Instagram/);

assert.equal(classifyCrawlPage("https://example.de/presse/mitteilung", "Presse"), "press");
assert.equal(classifyCrawlPage("https://example.de/ueber-uns", "Über uns"), "about");
assert.equal(classifyCrawlPage("https://example.de/team", "Unser Team"), "team");
assert.equal(classifyCrawlPage("https://example.de/leistungen", "Leistungen"), "services");
assert.equal(classifyCrawlPage("https://example.de/kontakt", "Kontakt"), "other");
assert.ok(crawlPagePriority("press") > crawlPagePriority("other"));
assert.equal(crawlPageKindLabel("services"), "Leistungen");

console.log("org-crawl-prefill: ok");
