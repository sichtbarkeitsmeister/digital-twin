/**
 * Grounding check: key-page selection, robots.txt for AI crawlers, footer link hint.
 * Run: npx tsx scripts/test-grounding-check-crawl.ts
 */
import assert from "node:assert/strict";

import {
  extractGroundingUrlFromFooterHtml,
  inspectFooterGroundingLink,
} from "../lib/dt/seo/discover-grounding-page-url";
import {
  MAX_KEY_PAGES,
  classifyKeyPage,
  extractJsonLdBlocks,
  homePageText,
  homepageLinks,
  profileLinks,
  readableText,
  selectKeyPages,
} from "../lib/dt/seo/grounding-check/crawl";
import { evaluateAiCrawlerAccess, isPathAllowed, parseRobotsTxt } from "../lib/dt/seo/grounding-check/robots";

// --- classification ---------------------------------------------------------------------------
const site = "https://www.beispiel.de";
assert.equal(classifyKeyPage(`${site}/`), "home");
assert.equal(classifyKeyPage(`${site}/impressum/`), "impressum");
assert.equal(classifyKeyPage(`${site}/kontakt/`), "contact");
assert.equal(classifyKeyPage(`${site}/ueber-uns/`), "about");
assert.equal(classifyKeyPage(`${site}/unternehmen/team/`), "team");
// The last segment decides: a services page below „unternehmen“.
assert.equal(classifyKeyPage(`${site}/unternehmen/leistungen/`), "services");
assert.equal(classifyKeyPage(`${site}/standorte/hamm/`), "locations");
assert.equal(classifyKeyPage(`${site}/faq/`), "faq");
assert.equal(classifyKeyPage(`${site}/referenzen/`), "references");
assert.equal(classifyKeyPage(`${site}/datenschutz/`), "excluded");
assert.equal(classifyKeyPage(`${site}/agb/`), "excluded");
assert.equal(classifyKeyPage(`${site}/blog/seo-tipps/`), "excluded");
assert.equal(classifyKeyPage(`${site}/2024/05/neuer-beitrag/`), "excluded");
assert.equal(classifyKeyPage(`${site}/grounding/`), "excluded");
assert.equal(classifyKeyPage(`${site}/local-seo/`), null);
assert.equal(classifyKeyPage(`${site}/seite-123/`, "Impressum | Beispiel GmbH"), "impressum");

// --- selection --------------------------------------------------------------------------------
const inventory = [
  "/",
  "/impressum/",
  "/kontakt/",
  "/ueber-uns/",
  "/unternehmen/team/",
  "/datenschutz/",
  "/blog/seo-tipps/",
  "/local-seo/",
  "/local-seo/bewertungen/",
  "/local-seo/listing-sync/",
  "/local-seo/listing-sync/details/",
  "/zufall/",
  "/faq/",
  "/grounding/",
  "/standorte/hamm/",
  "/referenzen/",
  "https://andere-domain.de/kontakt/",
  "/kontakt/?utm_source=x",
].map((path, i) => ({
  url: path.startsWith("http") ? path : `${site}${path}`,
  inNav: path === "/local-seo/" || path === "/ueber-uns/",
  order: i,
}));
const selected = selectKeyPages(inventory, { origin: site, homeUrl: `${site}/`, excludeUrls: [`${site}/faq/`] });
const byUrl = new Map(selected.map((s) => [s.url, s.category]));
assert.equal(selected[0]?.category, "home");
assert.equal(byUrl.get(`${site}/impressum`), "impressum");
assert.equal(byUrl.get(`${site}/kontakt`), "contact");
assert.equal(byUrl.get(`${site}/local-seo`), "services", "nav link without category counts as a service hub");
assert.equal(byUrl.get(`${site}/local-seo/bewertungen`), "references", "a page with its own category keeps it");
assert.equal(byUrl.get(`${site}/local-seo/listing-sync`), "services", "direct subpage of a hub");
assert.ok(!byUrl.has(`${site}/local-seo/listing-sync/details`), "grandchildren of a hub are not taken");
assert.ok(!byUrl.has(`${site}/zufall`), "uncategorised non-nav pages stay out");
assert.ok(!byUrl.has(`${site}/datenschutz`));
assert.ok(!byUrl.has(`${site}/grounding`));
assert.ok(!byUrl.has(`${site}/faq`), "excluded URLs stay out");
assert.ok(![...byUrl.keys()].some((u) => u.includes("andere-domain")), "same site only");
assert.equal(new Set(selected.map((s) => s.url)).size, selected.length, "no duplicates (tracking params stripped)");

const many = Array.from({ length: 200 }, (_, i) => ({ url: `${site}/leistungen/l-${i}/`, order: i }));
assert.ok(selectKeyPages(many, { origin: site, homeUrl: `${site}/` }).length <= MAX_KEY_PAGES);

// --- homepage links and JSON-LD ---------------------------------------------------------------
const homeHtml = `<html><body><header><nav><a href="/leistungen/">Leistungen</a></nav></header>
<main><a href="/ueber-uns/">Über uns</a><a href="https://extern.de/">Extern</a></main>
<script type="application/ld+json">{"@type":"Organization","name":"Beispiel GmbH"}</script>
<script type="application/ld+json">{ kaputt </script></body></html>`;
const links = homepageLinks(homeHtml, `${site}/`, site);
assert.equal(links.find((l) => l.url === `${site}/leistungen`)?.inNav, true);
assert.equal(links.find((l) => l.url === `${site}/ueber-uns`)?.inNav, false);
assert.ok(!links.some((l) => l.url.includes("extern.de")));
assert.deepEqual(extractJsonLdBlocks(homeHtml), ['{"@type":"Organization","name":"Beispiel GmbH"}']);

const profiles = profileLinks(
  `<footer><a href="https://www.linkedin.com/company/beispiel/">LinkedIn</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">Teilen</a><a href="https://www.instagram.com/">Instagram</a><a href="https://example.com/">x</a></footer>`,
  `${site}/`,
);
assert.deepEqual(profiles, ["https://www.linkedin.com/company/beispiel/"], "own profiles only, no share buttons or bare hosts");

const homeText = homePageText("x".repeat(20_000), "Musterstraße 12, 59065 Hamm", ["https://www.linkedin.com/company/beispiel/"]);
assert.ok(homeText.startsWith("[Profile] https://www.linkedin.com/company/beispiel/\n[Footer] Musterstraße 12"), "profiles and footer survive clipping");
assert.ok(homeText.length <= 12_000);
assert.equal(homePageText("Nur Text", "", []), "Nur Text");

const wordpress = `<html><body><header><nav><a href="/">Start</a><a href="/leistungen/">Leistungen</a></nav></header>
<div class="content"><h1>Impressum</h1><p>Beispiel Bau GmbH</p><ul><li>Von-Galen-Straße 40</li><li>59063 Hamm</li></ul>
<p>Geschäftsführerin:<br>Anna Muster</p><span>Tel.</span><span>02381 1</span><script>var x = 1;</script></div>
<footer><p>Standort in Hamm</p></footer></body></html>`;
const readable = readableText(wordpress);
assert.ok(readable.includes("Von-Galen-Straße 40\n59063 Hamm"), "block elements do not glue numbers");
assert.ok(readable.includes("Geschäftsführerin:\nAnna Muster"));
assert.ok(!readable.includes("Leistungen"), "menus are dropped");
assert.ok(!readable.includes("Standort in Hamm"), "footer is read separately");
assert.ok(!readable.includes("var x"));
assert.ok(readableText(wordpress, { stripChrome: false }).includes("Standort in Hamm"));

// --- robots.txt -------------------------------------------------------------------------------
const robots = `
User-agent: *
Disallow: /intern/

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /grounding/
Allow: /grounding/$

User-agent: PerplexityBot
Disallow:
`;
const groups = parseRobotsTxt(robots);
assert.equal(groups.length, 4);
assert.deepEqual(groups[1]?.agents, ["gptbot", "ccbot"]);
assert.equal(isPathAllowed(groups, "GPTBot", "/").allowed, false);
assert.equal(isPathAllowed(groups, "OAI-SearchBot", "/intern/x").allowed, false, "falls back to *");
assert.equal(isPathAllowed(groups, "OAI-SearchBot", "/").allowed, true);
assert.equal(isPathAllowed(groups, "ClaudeBot", "/grounding/").allowed, true, "Allow wins on equal length via $");
assert.equal(isPathAllowed(groups, "ClaudeBot", "/grounding/team/").allowed, false);
assert.equal(isPathAllowed(groups, "PerplexityBot", "/intern/").allowed, true, "own group with empty Disallow");

const access = new Map(evaluateAiCrawlerAccess(robots, "/grounding/").map((a) => [a.bot, a.status]));
assert.equal(access.get("GPTBot"), "blocked");
assert.equal(access.get("ClaudeBot"), "allowed");
assert.equal(access.get("OAI-SearchBot"), "allowed");
assert.equal(access.get("Google-Extended"), "allowed");
assert.equal(new Map(evaluateAiCrawlerAccess(robots, "/intern/fakten/").map((a) => [a.bot, a.status])).get("ChatGPT-User"), "partial");
assert.ok(evaluateAiCrawlerAccess(null, "/grounding/").every((a) => a.status === "allowed"), "no robots.txt = allowed");
assert.equal(
  new Map(evaluateAiCrawlerAccess("User-agent: *\nDisallow: /\n", "/grounding/").map((a) => [a.bot, a.status])).get("PerplexityBot"),
  "blocked",
);

// --- footer link ------------------------------------------------------------------------------
const footer = `<html><body><footer><ul>
<li><a href="/impressum/">Impressum</a></li><li><a href="/datenschutz/">Datenschutz</a></li>
<li><a href="https://beispiel.de/grounding">Fakten</a></li></ul></footer></body></html>`;
assert.deepEqual(inspectFooterGroundingLink(footer, `${site}/`, `${site}/grounding/`), {
  inFooter: true,
  nextToLegal: true,
  label: "fakten",
});
const footerElsewhere = `<html><body><footer><p><a href="/grounding/">Unternehmensdaten</a></p>
<ul><li><a href="/impressum/">Impressum</a></li></ul></footer></body></html>`;
assert.deepEqual(inspectFooterGroundingLink(footerElsewhere, `${site}/`, `${site}/grounding/`), {
  inFooter: true,
  nextToLegal: false,
  label: "unternehmensdaten",
});
assert.equal(inspectFooterGroundingLink("<footer></footer>", `${site}/`, `${site}/grounding/`).inFooter, false);
// Discovery now also accepts the label the standard suggests.
assert.equal(extractGroundingUrlFromFooterHtml(footer, `${site}/`), "https://beispiel.de/grounding");

console.log("grounding-check crawl tests: ok");
