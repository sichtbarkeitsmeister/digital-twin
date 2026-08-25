/**
 * Crawl prefill heuristics for Fragebogen wizard.
 * Run: npx tsx scripts/test-org-crawl-prefill.ts
 */
import assert from "node:assert/strict";

import { customizeCoreQuestion } from "../lib/surveys/customize-fragebogen";
import { ANBIETER_CORE_QUESTIONS } from "../lib/surveys/core-question-templates";
import {
  suggestPrefillsFromCrawl,
  classifyCrawlPage,
  crawlPageKindLabel,
  crawlPagePriority,
  extractImpressumFacts,
  extractLegalCompanyName,
  extractPricedServiceNames,
  extractServiceLabels,
  isPlausiblePrefill,
  parseServiceLabelList,
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
      text: "Online Media Atelier · Strategische Social-Media-Beratung für den Mittelstand. Unser Fokus liegt auf nachhaltiger Befähigung der Kunden. Wir sind 12 Mitarbeiter in NRW. Gegründet 2014. Was uns unterscheidet: praxisnahe Workshops statt Agentur-Blackbox. Geschäftsführerin: Julia Schröder. Mitbewerber sind oft klassische Social-Media-Agenturen ohne Wissensvermittlung. 4,8 Sterne bei 37 Google Bewertungen. Instagram.com/oma und facebook.com/oma. Adresse: Musterstraße 12, 44135 Dortmund. Öffnungszeiten: Mo–Fr 9–17 Uhr. Impressum: Online Media Atelier GmbH",
    },
    {
      url: "https://onlinemediaatelier.de/leistungen",
      title: "Leistungen",
      text: "Unsere Leistungen\n- Strategische Social-Media-Beratung\n- Workshops für Teams\n- Redaktionsplanung\n- Community Management",
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

assert.match(prefills.company_name?.value ?? "", /Online Media Atelier GmbH/);
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

const services = extractServiceLabels(context);
assert.ok(services.includes("Workshops für Teams"));
assert.ok(services.includes("Community Management"));
assert.match(prefills.services?.value ?? "", /Workshops für Teams/);

const impressum = extractImpressumFacts(context.pageExcerpts[0]!.text);
assert.match(impressum.legalName ?? "", /GmbH/);
assert.equal(impressum.ownerName, "Julia Schröder");

assert.deepEqual(
  parseServiceLabelList("Arbeitsrecht, Familienrecht und Mietrecht"),
  ["Arbeitsrecht", "Familienrecht", "Mietrecht"],
);

assert.equal(classifyCrawlPage("https://example.de/presse/mitteilung", "Presse"), "press");
assert.equal(classifyCrawlPage("https://example.de/ueber-uns", "Über uns"), "about");
assert.equal(classifyCrawlPage("https://example.de/team", "Unser Team"), "team");
assert.equal(classifyCrawlPage("https://example.de/leistungen", "Leistungen"), "services");
assert.equal(classifyCrawlPage("https://example.de/kontakt", "Kontakt"), "other");
assert.equal(classifyCrawlPage("https://example.de/impressum", "Impressum"), "legal");
assert.equal(classifyCrawlPage("https://example.de/datenschutz", "Datenschutz"), "legal");
assert.ok(crawlPagePriority("press") > crawlPagePriority("other"));
assert.equal(crawlPageKindLabel("services"), "Leistungen");
assert.equal(crawlPageKindLabel("legal"), "Impressum");

const meerbusch: OrgCrawlContext = {
  organisationId: "00000000-0000-0000-0000-000000000002",
  organisationName: "Praxis Meerbusch | Dr. Schürings",
  websiteUrl: "https://www.dermatologie-schuerings.de",
  pageCount: 4,
  snippets: [],
  pageExcerpts: [
    {
      url: "https://www.dermatologie-schuerings.de/impressum",
      title: "Über uns: Impressum - Dermatologie Schürings",
      text: "Impressum. Praxis Dr. Schürings, Hauptstraße 12, 40667 Meerbusch. Inhaber: Dr. med. Thomas Schürings.",
    },
    {
      url: "https://www.dermatologie-schuerings.de/datenschutz",
      title: "Über uns: Datenschutz - Dermatologie Schürings",
      text: "Datenschutzerklärung der Praxis. Verantwortlicher: Dr. Schürings.",
    },
    {
      url: "https://www.dermatologie-schuerings.de/fotona-4d-laser",
      title: "Weitere Seite: Fotona 4D Laser in Meerbusch - Gesichtsstraffung ohne OP",
      text: "Kälte- oder Wärmeanwendungen: Eine K Botox-Injektionen: ab ca. 200 € pro Region Hyaluronsäure-Filler: ab ca. 350 € pro Ampulle Laserbehandlungen: ab ca. 250 € pro Sitzung",
    },
  ],
  summaryText: "",
};
meerbusch.summaryText = `${meerbusch.organisationName}\n${meerbusch.pageExcerpts.map((p) => p.text).join("\n")}`;

const meerbuschPrefills = suggestPrefillsFromCrawl({
  context: meerbusch,
  hints: [
    { key: "company_name", hint: "org_name" },
    { key: "location_catchment", hint: "region" },
    { key: "portfolio", hint: "services" },
  ],
});

assert.equal(
  meerbuschPrefills.company_name?.value,
  "Praxis Meerbusch | Dr. Schürings",
);
assert.equal(/Kälte|Wärmeanwendung|Eine K/.test(meerbuschPrefills.company_name?.value ?? ""), false);
assert.match(meerbuschPrefills.location_catchment?.value ?? "", /Meerbusch/);
assert.equal(/Botox|€|pro Region/.test(meerbuschPrefills.location_catchment?.value ?? ""), false);

assert.deepEqual(
  extractPricedServiceNames(meerbusch.pageExcerpts[2]!.text),
  ["Botox-Injektionen", "Hyaluronsäure-Filler", "Laserbehandlungen"],
);

const meerbuschServices = extractServiceLabels(meerbusch);
assert.equal(meerbuschServices.some((s) => /impressum|datenschutz|Eine K/i.test(s)), false);
assert.ok(meerbuschServices.includes("Botox-Injektionen"), JSON.stringify(meerbuschServices));
assert.ok(meerbuschServices.includes("Hyaluronsäure-Filler"), JSON.stringify(meerbuschServices));
assert.ok(meerbuschServices.includes("Laserbehandlungen"), JSON.stringify(meerbuschServices));
assert.ok(
  meerbuschServices.some((s) => /Fotona/i.test(s)),
  `expected a laser/treatment label, got ${JSON.stringify(meerbuschServices)}`,
);
assert.match(meerbuschPrefills.portfolio?.value ?? "", /Botox-Injektionen/);

const tailored = customizeCoreQuestion({
  template: ANBIETER_CORE_QUESTIONS.find((q) => q.key === "portfolio")!,
  audience: "praxis",
  serviceLabels: meerbuschServices,
});
assert.equal(tailored.options?.some((o) => /vor Versand/.test(o.label)) ?? true, false);
assert.ok(tailored.options?.some((o) => o.label === "Botox-Injektionen"));

const ranked = customizeCoreQuestion({
  template: ANBIETER_CORE_QUESTIONS.find((q) => q.key === "services_ranked")!,
  audience: "praxis",
  serviceLabels: meerbuschServices,
});
assert.equal(ranked.options?.some((o) => /vor Versand/.test(o.label)) ?? true, false);

assert.equal(
  extractLegalCompanyName(
    "Kälte- oder Wärmeanwendungen: Eine K Botox-Injektionen: ab ca. 200 € pro Region",
  ),
  null,
);
assert.equal(
  isPlausiblePrefill("org_name", "Kälte- oder Wärmeanwendungen: Eine K"),
  false,
);
assert.equal(
  isPlausiblePrefill(
    "region",
    "ab:Botox-Injektionen: ab ca. 200 € pro Region Hyaluronsäure-Filler: ab ca. 350 €",
  ),
  false,
);

console.log("org-crawl-prefill: ok");
