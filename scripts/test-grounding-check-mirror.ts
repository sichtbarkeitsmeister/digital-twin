/**
 * Grounding check: HTML template, HTML ↔ JSON-LD mirror validator, review stamp, refresh.
 * Run: npx tsx scripts/test-grounding-check-mirror.ts
 */
import assert from "node:assert/strict";

import { applyFactToggles } from "../lib/dt/seo/grounding-check/fact-model";
import { parseJsonLdFromHtml } from "../lib/dt/seo/grounding-check/jsonld";
import { REVIEW_NOTICE_MARKER, renderGroundingHtml } from "../lib/dt/seo/grounding-check/render-html";
import { applyReviewToHtml, refreshDatesInHtml } from "../lib/dt/seo/grounding-check/review-stamp";
import {
  jsonLdValuesNotVisible,
  validateFactModelSources,
  validateGroundingDraft,
  validateGroundingHtml,
  validateProse,
  visibleFactsNotInJsonLd,
} from "../lib/dt/seo/grounding-check/validate";
import { EXISTING_PAGE_HTML, PAGE_URL, websiteModel } from "./grounding-check-fixtures";

const errors = <T extends { severity: string }>(issues: T[]) => issues.filter((i) => i.severity === "error");
/** Top-level @graph member (nested references share the @id). */
const graphNode = (page: string, match: (n: Record<string, unknown>) => boolean) =>
  ((parseJsonLdFromHtml(page).documents[0] as { "@graph": Array<Record<string, unknown>> })["@graph"]).find(match)!;
const model = websiteModel();
const html = renderGroundingHtml({ model, createdDay: "2026-10-01", modifiedDay: "2026-10-23", sourceTitles: { "https://www.beispiel-bau.de/impressum/": "Impressum | Beispiel Bau" } });

// --- the template mirrors itself --------------------------------------------------------------
const draftIssues = validateGroundingHtml(html, { reviewed: false });
assert.deepEqual(errors(draftIssues), [], `draft has mirror errors: ${JSON.stringify(errors(draftIssues), null, 2)}`);
assert.deepEqual(jsonLdValuesNotVisible(html), []);
assert.deepEqual(visibleFactsNotInJsonLd(html), []);

// Structure: entity name in headings, definition, Abgrenzung, FAQ, sources, no review notice yet.
assert.ok(html.startsWith("<!doctype html>"));
assert.match(html, /<html lang="de">/);
assert.match(html, /<h1>Beispiel Bau GmbH<\/h1>/);
assert.match(html, /<h2>Beispiel Bau GmbH: Kerndaten<\/h2>/);
assert.match(html, /<h3>Dachsanierung<\/h3>/);
assert.match(html, /<h2>Abgrenzung von Beispiel Bau GmbH<\/h2>/);
assert.match(html, /<h2>Häufige Fragen zu Beispiel Bau GmbH<\/h2>/);
assert.match(html, /<h2>Weiterführende Informationen zu Beispiel Bau GmbH<\/h2>/);
assert.match(html, /<a href="https:\/\/www\.beispiel-bau\.de\/impressum\/">Impressum<\/a>/, "source title without site suffix");
assert.match(html, /25 <span class="stand">\(Stand: Oktober 2026\)<\/span>/, "volatile values carry Stand");
assert.ok(!/Zuletzt von einem Menschen geprüft/.test(html), "no review notice before the review");
assert.ok(html.includes(REVIEW_NOTICE_MARKER));
assert.match(html, /Grounding Page Standard v1\.6/);
assert.ok(!/4,9 von 5/.test(html), "switched-off rating is not on the page");
assert.ok(!/<script(?![^>]*ld\+json)/.test(html), "no JavaScript");

// JSON-LD: stable org @id, LocalBusiness subtype, links between entities, no review fields yet.
const parsed = parseJsonLdFromHtml(html);
const org = graphNode(html, (n) => n["@id"] === "https://www.beispiel-bau.de/#organization");
assert.equal(org["@type"], "RoofingContractor");
assert.equal(org.legalName, "Beispiel Bau GmbH");
assert.equal(org.vatID, "DE123456789");
assert.deepEqual(org.address, { "@type": "PostalAddress", streetAddress: "Musterstraße 12", postalCode: "59065", addressLocality: "Hamm", addressCountry: "DE" });
assert.deepEqual(org.employee, { "@type": "Person", name: "Anna Muster", "@id": `${PAGE_URL}#anna-muster`, jobTitle: "Geschäftsführung" });
assert.equal(org.foundingDate, "2012-03");
assert.equal(org.aggregateRating, undefined, "no self-serving rating markup");
const person = graphNode(html, (n) => n["@id"] === `${PAGE_URL}#anna-muster`);
assert.deepEqual(person.worksFor, { "@id": "https://www.beispiel-bau.de/#organization", name: "Beispiel Bau GmbH" });
const webPage = parsed.nodes.find((n) => n["@type"] === "WebPage")!;
assert.equal(webPage.dateModified, "2026-10-23");
assert.equal(webPage.lastReviewed, undefined);
assert.ok(parsed.nodes.some((n) => n["@type"] === "FAQPage"));
assert.ok(parsed.nodes.some((n) => n["@type"] === "BreadcrumbList"));
assert.equal(validateGroundingHtml(html, { reviewed: true }).some((i) => i.code === "review_notice"), true, "unreviewed page fails the reviewed check");

// --- the validator catches breaks in both directions ------------------------------------------
const visibleChanged = html.replace(">02381 98765-0</a>", ">02381 11111</a>");
assert.ok(errors(validateGroundingHtml(visibleChanged, { reviewed: false })).some((i) => i.code === "mirror_fact" && /Telefon/.test(i.message)));

const jsonOnly = html.replace('"vatID": "DE123456789"', '"vatID": "DE123456789",\n      "slogan": "Die besten Dächer"');
assert.ok(errors(validateGroundingHtml(jsonOnly, { reviewed: false })).some((i) => i.code === "mirror_invisible" && /besten Dächer/.test(i.message)));

const faqChanged = html.replace("<p>Die Beispiel Bau GmbH arbeitet in Hamm, Dortmund und Umgebung.</p>", "<p>Nur in Hamm.</p>");
assert.ok(errors(validateGroundingHtml(faqChanged, { reviewed: false })).some((i) => i.code === "mirror_faq"));

const broken = html.replace('"@context": "https://schema.org"', '"@context": "https://schema.org",,');
assert.ok(errors(validateGroundingHtml(broken, { reviewed: false })).some((i) => i.code === "jsonld_invalid"));

const scripted = html.replace("</main>", "<script>alert(1)</script></main>");
assert.ok(errors(validateGroundingHtml(scripted, { reviewed: false })).some((i) => i.code === "javascript"));
assert.ok(!errors(validateGroundingHtml(scripted, { reviewed: false, strict: false })).some((i) => i.code === "javascript"), "CMS pages may keep scripts");

const claimsReview = html.replace("Grounding Page Standard v1.6</p>", "Grounding Page Standard v1.7</p>");
assert.ok(errors(validateGroundingHtml(claimsReview, { reviewed: false })).some((i) => i.code === "standard_version"), "v1.7 needs a review");

// --- review stamp -----------------------------------------------------------------------------
const reviewed = applyReviewToHtml(html, { day: "2026-10-24" });
assert.match(reviewed, /<p class="review-notice">Fakten geprüft von Sichtbarkeitsmeister GmbH · Zuletzt von einem Menschen geprüft: <time datetime="2026-10-24">24\. Oktober 2026<\/time><\/p>/);
assert.ok(!reviewed.includes(REVIEW_NOTICE_MARKER));
assert.match(reviewed, /Grounding Page Standard v1\.7<\/p>/);
assert.match(reviewed, /<!-- Grounding Page Standard v1\.7/);
const reviewedPage = parseJsonLdFromHtml(reviewed).nodes.find((n) => n["@type"] === "WebPage")!;
assert.equal(reviewedPage.lastReviewed, "2026-10-24");
assert.deepEqual(reviewedPage.reviewedBy, { "@type": "Organization", name: "Sichtbarkeitsmeister GmbH" });
assert.equal(reviewedPage.dateModified, "2026-10-23", "the review does not move dateModified");
assert.deepEqual(errors(validateGroundingHtml(reviewed, { reviewed: true })), []);
// Stamping again (re-approval) replaces, never duplicates.
const again = applyReviewToHtml(reviewed, { day: "2026-10-25" });
assert.equal((again.match(/class="review-notice"/g) ?? []).length, 1);
assert.match(again, /datetime="2026-10-25"/);
assert.deepEqual(errors(validateGroundingHtml(again, { reviewed: true })), []);

// An existing page without marker or notice gets one before </footer> / </main>.
const foreign = applyReviewToHtml(EXISTING_PAGE_HTML, { day: "2026-10-24" });
assert.match(foreign, /Zuletzt von einem Menschen geprüft: <time datetime="2026-10-24">/);
assert.match(foreign, /Grounding Page Standard v1\.7/);
assert.equal(parseJsonLdFromHtml(foreign).nodes.find((n) => n["@type"] === "WebPage")?.lastReviewed, "2026-10-24");

// --- refresh only -----------------------------------------------------------------------------
const refreshed = refreshDatesInHtml(reviewed, { day: "2027-01-20", month: "2027-01" });
assert.match(refreshed.text, /\(Stand: Januar 2027\)/);
assert.match(refreshed.text, /Zuletzt aktualisiert: <time datetime="2027-01-20">20\. Januar 2027<\/time>/);
assert.equal(parseJsonLdFromHtml(refreshed.text).nodes.find((n) => n["@type"] === "WebPage")?.dateModified, "2027-01-20");
assert.equal(parseJsonLdFromHtml(refreshed.text).nodes.find((n) => n["@type"] === "WebPage")?.lastReviewed, "2026-10-24", "lastReviewed waits for the next approval");
assert.ok(refreshed.changes.some((c) => c.startsWith("dateModified: 2026-10-23 → 2027-01-20")));
assert.deepEqual(errors(validateGroundingHtml(refreshed.text, { reviewed: true })), []);

// --- toggles, sources, prose ------------------------------------------------------------------
const withoutPerson = applyFactToggles(model, { facts: [{ entityId: "anna-muster", included: false }] });
const htmlWithoutPerson = renderGroundingHtml({ model: withoutPerson, createdDay: "2026-10-01", modifiedDay: "2026-10-23" });
assert.ok(!/<h3>Anna Muster<\/h3>/.test(htmlWithoutPerson));
assert.deepEqual(errors(validateGroundingHtml(htmlWithoutPerson, { reviewed: false })), [], "managing director without person entity still mirrors");
const orgCannotBeOff = applyFactToggles(model, { facts: [{ entityId: "organisation", included: false }] });
assert.equal(orgCannotBeOff.entities[0]!.included, true);

const unsourced = websiteModel();
unsourced.entities[0]!.facts[0]!.quote = "";
assert.ok(validateFactModelSources(unsourced).some((i) => i.severity === "error" && /keine Quelle/.test(i.message)));
assert.deepEqual(errors(validateFactModelSources(model)), []);

const marketing = websiteModel();
marketing.prose!.lead = ["Die Beispiel Bau GmbH ist der beste Dachdecker seit 1999 in Hamm."];
const marketingHtml = renderGroundingHtml({ model: marketing, createdDay: "2026-10-01", modifiedDay: "2026-10-23" });
const proseIssues = validateProse(marketing, marketingHtml);
assert.ok(proseIssues.some((i) => i.code === "marketing" && /beste/.test(i.message)));
assert.ok(proseIssues.some((i) => i.code === "prose_numbers" && /1999/.test(i.message)));
assert.ok(!validateProse(model, html).some((i) => i.code === "prose_numbers"), "2012 is a fact");

const full = validateGroundingDraft({ html, llmsTxt: "# x\n", model, reviewed: false, generated: true });
assert.equal(full.ok, true, JSON.stringify(errors(full.issues)));

console.log("grounding-check mirror tests: ok");
