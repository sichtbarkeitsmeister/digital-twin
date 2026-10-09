/**
 * Texte: the Excel briefing parser, page types, the eight new steps and their halting rules.
 * Run: npm run test:content-excel-structure
 */
import assert from "node:assert/strict";

import { planCrawlContentPages, type CrawledSitePage } from "../lib/dt/content/crawl-pages";
import {
  briefingFromStructureTree,
  briefingToStructureText,
  contentPageSlug,
  parseContentStructureSheet,
  parseContentStructureWorkbook,
  parseKeywordsCell,
  parseLinesCell,
  parseVolume,
  summariseBriefing,
} from "../lib/dt/content/excel-structure";
import {
  derivePageType,
  effectiveContentPageType,
  extractCityCandidates,
  guessCrawlPageType,
  isExcludedContentPageName,
} from "../lib/dt/content/page-types";
import {
  CONTENT_HERO_PLACEHOLDER,
  contentStepSpec,
  ensureHeroPlaceholder,
  keepHeroBlock,
  mergeRewrittenBlocks,
  normalizeAnalyse,
  settleHeroSentence,
  type ContentPipelineContext,
  type FaktencheckOutput,
  type TextOutput,
  type VermenschlichungOutput,
} from "../lib/dt/content/pipeline/prompts";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_WATERMARK,
  CONTENT_STEPS,
  contentStepDefinition,
  hasLegacyContentSteps,
  runningPageDetail,
} from "../lib/dt/content/pipeline/steps";
import { callXaiTool, resolveXaiModels, XAI_MISSING_KEY_MESSAGE } from "../lib/dt/content/pipeline/xai";
import { estimateCostEur, priceForModel } from "../lib/dt/content/pricing";
import { parseBlocksFromHtml } from "../lib/dt/content/render";
import {
  CONTENT_TYPE_LOCKED_MESSAGE,
  canEditContentPageType,
  contentPageTypeChangeBlocker,
  contentStructureOutline,
  pageBriefing,
  type ContentPageRow,
} from "../lib/dt/content/store";
import {
  CONTENT_TYPE_PROMPT_KEYS,
  CONTENT_TYPE_PROMPT_MAX_CHARS,
  DEFAULT_CONTENT_TYPE_PROMPTS,
  hasCustomContentTypePrompts,
  normalizeContentTypePrompts,
  renderContentTypePrompt,
} from "../lib/dt/content/type-prompts";
import { parseWebsiteStructure } from "../lib/dt/seo/website-structure";

// --- cells ------------------------------------------------------------------------------------

assert.deepEqual(parseKeywordsCell("Privatumzug (590), Privatumzüge (260)"), {
  main: { text: "Privatumzug", volume: 590 },
  secondary: [{ text: "Privatumzüge", volume: 260 }],
});
assert.deepEqual(parseKeywordsCell("Umzug Köln (1.200); Umzugsfirma\nUmzugsunternehmen Köln (2,5k)"), {
  main: { text: "Umzug Köln", volume: 1200 },
  secondary: [{ text: "Umzugsfirma" }, { text: "Umzugsunternehmen Köln", volume: 2500 }],
});
assert.equal(parseKeywordsCell("   "), null, "an empty cell is no keyword");
assert.equal(parseKeywordsCell("Privatumzug (590)")?.secondary.length, 0);
assert.equal(parseKeywordsCell("Privatumzug")?.main.volume, undefined, "no volume is invented");
assert.deepEqual(parseLinesCell("Option A: Privatumzug Köln\nOption B: Ihr Privatumzug\n- Dritte\n1. Vierte\n„Fünfte“\n\nOption A: Privatumzug Köln"), [
  "Privatumzug Köln",
  "Ihr Privatumzug",
  "Dritte",
  "Vierte",
  "Fünfte",
]);
assert.deepEqual(parseLinesCell("Was kostet ein Umzug?\r\nWie lange dauert ein Umzug?"), ["Was kostet ein Umzug?", "Wie lange dauert ein Umzug?"]);
assert.equal(parseVolume("1 200"), 1200);
assert.equal(parseVolume("ca. 300"), undefined);
console.log("cells: ok");

// --- the old briefing layout (Steiner-like) --------------------------------------------------

const STEINER_ROWS = [
  ["Webseitenstruktur Steiner Umzüge", "", "", "", "", "", "", "", ""],
  [],
  ["URL", "Startseite", "Ebene 1", "Ebene 2", "Traffic", "Keywords", "H1-Optionen", "Nutzerfragen", "KI-Prompt"],
  ["https://steiner-umzuege.de/", "Startseite", "", "", "1200", "Umzugsunternehmen Köln (880)", "Option A: Ihr Umzugsunternehmen in Köln", "Was kostet ein Umzug in Köln?", ""],
  [
    "https://steiner-umzuege.de/privatumzug/",
    "",
    "Privatumzug",
    "",
    "590",
    "Privatumzug (590), Privatumzüge (260), Umzug privat",
    "Option A: Privatumzug Köln – stressfrei\nOption B: Ihr Privatumzug mit Steiner",
    "Was kostet ein Privatumzug?\nWie lange dauert ein Privatumzug?\nWer packt die Kisten?",
    "Bitte den Festpreis betonen.",
  ],
  ["https://steiner-umzuege.de/privatumzug/seniorenumzug/", "", "", "Seniorenumzug", "140", "Seniorenumzug (140)", "", "Wer hilft Senioren beim Umzug?", ""],
  ["https://steiner-umzuege.de/ratgeber/", "", "Ratgeber", "", "", "", "", "", ""],
  ["https://steiner-umzuege.de/ratgeber/umzugscheckliste/", "", "", "Umzugscheckliste", 300, "Umzugscheckliste (2.400)", "", "Was muss ich beim Umzug beachten?", ""],
  ["https://steiner-umzuege.de/regionen/", "", "Regionen", "", "", "", "", "", ""],
  ["https://steiner-umzuege.de/regionen/bonn/", "", "", "Umzug Bonn", "", "Umzug Bonn (320)", "", "", ""],
  ["https://steiner-umzuege.de/kontakt/", "", "Kontakt", "", "", "", "", "", ""],
  ["https://steiner-umzuege.de/impressum/", "", "Impressum", "", "", "", "", "", ""],
];

const steiner = parseContentStructureWorkbook([
  { name: "Notizen", rows: [["Nur Text"], ["ohne Struktur"]] },
  { name: "Webseitenstruktur", rows: STEINER_ROWS },
]);
assert.equal(steiner.sheet, "Webseitenstruktur", "the sheet „Webseitenstruktur“ wins over the first sheet");
assert.equal(steiner.layout, "briefing");
assert.equal(steiner.briefing, true);
assert.deepEqual(
  steiner.pages.map((p) => [p.slug, p.page_role, p.page_type, p.level, p.pillar_name]),
  [
    ["startseite", "startseite", "hauptsilo", 0, null],
    ["privatumzug", "pillar", "hauptsilo", 1, null],
    ["seniorenumzug", "supporting", "unterseite", 2, "Privatumzug"],
    ["ratgeber", "pillar", "ratgeber", 1, null],
    ["umzugscheckliste", "supporting", "ratgeber", 2, "Ratgeber"],
    ["regionen", "pillar", "hauptsilo", 1, null],
    ["bonn", "supporting", "standort", 2, "Regionen"],
    ["kontakt", "pillar", "nicht_bearbeiten", 1, null],
    ["impressum", "pillar", "nicht_bearbeiten", 1, null],
  ],
);
const home = steiner.pages[0]!;
assert.equal(home.path, "/");
assert.equal(home.source_url, "https://steiner-umzuege.de/");
assert.equal(home.estimated_traffic, 1200);
assert.deepEqual(home.keywords, { main: { text: "Umzugsunternehmen Köln", volume: 880 }, secondary: [] });
assert.deepEqual(home.h1_options, ["Ihr Umzugsunternehmen in Köln"]);
assert.deepEqual(home.internal_link_targets, ["Privatumzug", "Ratgeber", "Regionen"], "the Startseite links to the writable silos");

const privat = steiner.pages[1]!;
assert.equal(privat.path, "/privatumzug");
assert.equal(privat.position, 1);
assert.deepEqual(privat.keywords, {
  main: { text: "Privatumzug", volume: 590 },
  secondary: [{ text: "Privatumzüge", volume: 260 }, { text: "Umzug privat" }],
});
assert.deepEqual(privat.h1_options, ["Privatumzug Köln – stressfrei", "Ihr Privatumzug mit Steiner"]);
assert.deepEqual(privat.user_questions, ["Was kostet ein Privatumzug?", "Wie lange dauert ein Privatumzug?", "Wer packt die Kisten?"]);
assert.equal(privat.ki_prompt, "Bitte den Festpreis betonen.");
assert.deepEqual(privat.internal_link_targets, ["Seniorenumzug"], "a Hauptsilo links to its Unterseiten");

const senior = steiner.pages[2]!;
assert.equal(senior.internal_link_targets[0], "Privatumzug", "an Unterseite always links to its Hauptsilo");
assert.equal(senior.estimated_traffic, 140);

const checkliste = steiner.pages[4]!;
assert.equal(checkliste.keywords?.main.volume, 2400, "„2.400“ is a German thousand separator");
assert.equal(checkliste.estimated_traffic, 300, "numbers arrive as numbers too");
assert.ok(!steiner.pages[5]!.internal_link_targets.includes("Kontakt"), "pages that get no text are no link targets");

assert.deepEqual(summariseBriefing(steiner.pages), { pages: 9, keywords: 5, questions: 4, h1_options: 2, skipped: 2 });
console.log("briefing layout: ok");

// The same pages as the SEO parser's tree: SEO → Struktur shows what Texte works with, and
// a later sync from that outline lands on the same slugs.
const tree = parseWebsiteStructure(briefingToStructureText(steiner.pages));
assert.equal(tree.nodeCount, 9);
assert.equal(tree.nodes.length, 1, "the Startseite is the root");
assert.equal(tree.nodes[0]?.path, "/");
assert.equal(tree.nodes[0]?.children.length, 5);
assert.equal(tree.nodes[0]?.children[0]?.children[0]?.label, "Seniorenumzug");
assert.equal(tree.nodes[0]?.children[0]?.children[0]?.path, "/privatumzug/seniorenumzug");
const fromTree = briefingFromStructureTree(tree.nodes);
assert.deepEqual(
  fromTree.map((p) => [p.slug, p.page_role, p.page_type, p.pillar_name]),
  steiner.pages.map((p) => [p.slug, p.page_role, p.page_type, p.pillar_name]),
  "tree → pages gives the same roles and slugs as the Excel",
);
assert.equal(fromTree[1]!.keywords, null, "a tree carries no briefing");
console.log("structure text round trip: ok");

// --- the DT template „Ebene 1 … n“, with and without briefing columns ------------------------

const template = parseContentStructureSheet([
  ["Seitenstruktur Muster GmbH", "", "", "", "", "", ""],
  ["Ebene 1", "Ebene 2", "Ebene 3", "URL", "Keywords", "H1-Optionen", "Nutzerfragen"],
  ["Startseite", "", "", "/", "", "", ""],
  ["Leistungen", "", "", "/leistungen", "Dachdecker Köln (720)", "Dachdecker in Köln", "Was kostet ein Dachdecker?"],
  ["", "Dachsanierung", "", "/leistungen/dachsanierung", "Dachsanierung Köln (390)", "", "Wann muss ein Dach saniert werden?\nWie lange hält ein Dach?"],
  ["", "", "Flachdach", "/leistungen/dachsanierung/flachdach", "", "", ""],
  ["Über uns", "", "", "/ueber-uns", "", "", ""],
]);
assert.equal(template.layout, "template");
assert.equal(template.briefing, true);
assert.deepEqual(
  template.pages.map((p) => [p.slug, p.page_role, p.page_type, p.level, p.pillar_name]),
  [
    ["startseite", "startseite", "hauptsilo", 0, null],
    ["leistungen", "pillar", "hauptsilo", 1, null],
    ["dachsanierung", "supporting", "unterseite", 2, "Leistungen"],
    ["flachdach", "supporting", "unterseite", 3, "Leistungen"],
    ["ueber-uns", "pillar", "nicht_bearbeiten", 1, null],
  ],
);
assert.equal(template.pages[1]!.keywords?.main.text, "Dachdecker Köln");
assert.equal(template.pages[2]!.user_questions.length, 2);
assert.deepEqual(template.pages[1]!.internal_link_targets, ["Dachsanierung", "Flachdach"]);
assert.deepEqual(template.pages[3]!.internal_link_targets, ["Leistungen", "Dachsanierung"]);

const plain = parseContentStructureSheet([
  ["Ebene 1", "Ebene 2", "URL"],
  ["Startseite", "", "/"],
  ["Leistungen", "", "/leistungen"],
  ["", "Dachsanierung", "/leistungen/dachsanierung"],
]);
assert.equal(plain.layout, "template");
assert.equal(plain.briefing, false, "the DT template without F/G/H is a structure, not a briefing");
assert.equal(plain.pages[2]!.keywords, null);
assert.deepEqual(plain.pages[2]!.user_questions, []);

// Headerless old layout: columns A–H by position, as the importer read them.
const positional = parseContentStructureSheet([
  ["https://x.de/", "x", "", "", "", "", "", ""],
  ["https://x.de/umzug", "", "Umzug", "", "", "Umzug (100)", "", "Was kostet ein Umzug?"],
  ["https://x.de/umzug/klavier", "", "", "Klaviertransport", "", "", "", ""],
]);
assert.equal(positional.layout, "briefing");
assert.deepEqual(
  positional.pages.map((p) => [p.slug, p.name, p.page_role]),
  [
    ["startseite", "Startseite", "startseite"],
    ["umzug", "Umzug", "pillar"],
    ["klavier", "Klaviertransport", "supporting"],
  ],
);
assert.equal(positional.pages[1]!.keywords?.main.text, "Umzug");

// Flat list: one name column next to a URL column, every page a Hauptsilo.
const flat = parseContentStructureSheet([
  ["Seite", "L1", "URL"],
  ["", "Fenster", "/fenster"],
  ["", "Türen", "/tueren"],
]);
assert.deepEqual(flat.pages.map((p) => [p.slug, p.page_role]), [["fenster", "pillar"], ["tueren", "pillar"]]);

assert.throws(() => parseContentStructureSheet([[], ["", ""]]), /leer/);
assert.throws(() => parseContentStructureWorkbook([{ name: "Leer", rows: [["URL", "Startseite", "Ebene 1"]] }]), /keine Seitenstruktur/);
assert.equal(contentPageSlug("Über uns", null, false), "ueber-uns");
assert.equal(contentPageSlug("Egal", "https://x.de/a/b/", false), "b");
console.log("template and fallbacks: ok");

// --- page types ---------------------------------------------------------------------------------

assert.equal(derivePageType({ name: "Impressum", role: "pillar" }), "nicht_bearbeiten");
assert.equal(derivePageType({ name: "Kontakt & Anfahrt", role: "pillar" }), "nicht_bearbeiten");
assert.equal(derivePageType({ name: "Über uns", role: "pillar" }), "nicht_bearbeiten");
assert.equal(derivePageType({ name: "Team", role: "supporting", path: "/ueber-uns" }), "nicht_bearbeiten", "the path segment counts too");
assert.equal(derivePageType({ name: "Umzugsratgeber", role: "pillar" }), "ratgeber");
assert.equal(derivePageType({ name: "Checkliste", role: "supporting", pillarName: "Ratgeber" }), "ratgeber");
assert.equal(derivePageType({ name: "Umzug Bonn", role: "supporting", pillarName: "Regionen" }), "standort");
assert.equal(derivePageType({ name: "Umzug Bonn", role: "supporting", pillarName: "Leistungen", cities: ["Bonn"] }), "standort");
assert.equal(derivePageType({ name: "Gewissenhafte Planung", role: "supporting", pillarName: "Leistungen" }), "unterseite", "„wissen“ inside a word is no Ratgeber");
assert.equal(derivePageType({ name: "Privatumzug", role: "pillar" }), "hauptsilo");
assert.equal(derivePageType({ name: "Startseite", role: "startseite" }), "hauptsilo");
assert.equal(derivePageType({ name: "Seniorenumzug", role: "supporting", pillarName: "Privatumzug" }), "unterseite");
assert.equal(isExcludedContentPageName("Datenschutzerklärung"), true);
assert.equal(isExcludedContentPageName("Referenzen"), true);
assert.equal(isExcludedContentPageName("Kontaktlinsen"), false, "only whole words");
assert.equal(isExcludedContentPageName("Leistungen", "/kontakt/leistungen"), false, "only the last segment counts");
assert.equal(guessCrawlPageType({ name: "Startseite", path: "/", level: 0 }), "hauptsilo");
assert.equal(guessCrawlPageType({ name: "Dachsanierung", path: "/leistungen/dachsanierung", level: 2 }), "unterseite");
assert.equal(guessCrawlPageType({ name: "Leistungen", path: "/leistungen", level: 1 }), "hauptsilo");
assert.equal(guessCrawlPageType({ name: "5 Tipps", path: "/ratgeber/5-tipps", level: 2 }), "ratgeber");
assert.equal(guessCrawlPageType({ name: "Kontakt", path: "/kontakt", level: 1 }), "nicht_bearbeiten");
assert.equal(effectiveContentPageType({ page_type: null, page_role: null, level: 2, name: "Dach", path: "/a/dach" }), "unterseite");
assert.equal(effectiveContentPageType({ page_type: "standort", page_role: "pillar", level: 1, name: "Köln" }), "standort");
assert.deepEqual(
  extractCityCandidates(
    "Einfach Entrümpelung ist ein Familienbetrieb aus Düsseldorf. Wir arbeiten in der Region Köln und im Raum Frankfurt am Main, auch bei Bad Homburg. In Ihrem Haus räumen wir in Ruhe. Der Sitz in Neuss bleibt.",
  ),
  ["Düsseldorf", "Köln", "Frankfurt am Main", "Bad Homburg", "Neuss"],
);
console.log("page types: ok");

// --- crawl pages need no Excel -----------------------------------------------------------------

const crawledAt = "2026-10-07T10:00:00.000Z";
const site = (patch: Partial<CrawledSitePage> & { url: string }): CrawledSitePage => ({
  title: null, h1: null, text_content: "Text", is_excluded: false, crawled_at: crawledAt, final_url: null, ...patch,
});
const crawlPlan = planCrawlContentPages([], [
  site({ url: "https://x.de/", title: "Start | Firma" }),
  site({ url: "https://x.de/leistungen", title: "Leistungen – Firma" }),
  site({ url: "https://x.de/leistungen/dach", h1: "Dachsanierung" }),
  site({ url: "https://x.de/kontakt/", title: "Kontakt" }),
  site({ url: "https://x.de/ratgeber/tipps", h1: "5 Tipps" }),
]);
assert.deepEqual(
  crawlPlan.inserts.map((p) => [p.slug, p.page_type, p.pillar_name, p.source_url]),
  [
    ["startseite", "hauptsilo", null, "https://x.de/"],
    ["kontakt", "nicht_bearbeiten", null, "https://x.de/kontakt/"],
    ["leistungen", "hauptsilo", null, "https://x.de/leistungen"],
    ["dach", "unterseite", "Leistungen", "https://x.de/leistungen/dach"],
    ["tipps", "ratgeber", null, "https://x.de/ratgeber/tipps"],
  ],
  "crawl pages get a guessed type and their top-level page as Hauptsilo; no Excel needed",
);
assert.ok(crawlPlan.inserts.every((p) => !("keywords" in p)), "the crawl invents no keywords or questions");
console.log("crawl without excel: ok");

// --- the eight steps ----------------------------------------------------------------------------

assert.deepEqual(
  CONTENT_STEPS.map((s) => [s.step, s.name, s.tier, s.writesText, s.provider]),
  [
    [1, "Analyse", "write", false, "anthropic"],
    [2, "SEO", "write", true, "anthropic"],
    [3, "Faktencheck", "check", false, "anthropic"],
    [4, "GEO", "write", true, "anthropic"],
    [5, "Hormozi", "write", true, "anthropic"],
    [6, "Vermenschlichung", "write", true, "anthropic"],
    [7, "Lektorat", "check", true, "anthropic"],
    [8, "Watermark Entfernung", "write", true, "xai"],
    [9, "Endabnahme", "check", false, "anthropic"],
  ],
);
assert.deepEqual([CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_LEKTORAT, CONTENT_STEP_WATERMARK, CONTENT_STEP_ENDABNAHME], [3, 7, 8, 9]);
assert.equal(hasLegacyContentSteps([{ step: 8, name: "Endabnahme" }]), true, "the eight-step order is legacy now");
assert.equal(hasLegacyContentSteps([{ step: 8, name: "Watermark Entfernung" }, { step: 9, name: "Endabnahme" }]), false);
assert.equal(runningPageDetail(2, [{ step: 1, status: "done" }, { step: 2, status: "done" }]), "Schritt 3 von 9 startet: Faktencheck");
assert.equal(hasLegacyContentSteps([{ step: 1, name: "Recherche" }, { step: 2, name: "Gliederung" }]), true);
assert.equal(hasLegacyContentSteps([{ step: 1, name: "Analyse" }, { step: 3, name: "Faktencheck" }]), false);
assert.equal(hasLegacyContentSteps([]), false);

const context = (patch: Partial<ContentPipelineContext["page"]> = {}, extra: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Steiner Umzüge",
  page: {
    name: "Privatumzug",
    path: "/privatumzug",
    level: 1,
    url: "https://steiner-umzuege.de/privatumzug/",
    source: "structure",
    page_role: "pillar",
    page_type: "hauptsilo",
    pillar_name: null,
    estimated_traffic: 590,
    keywords: privat.keywords,
    h1_options: privat.h1_options,
    user_questions: privat.user_questions,
    ki_prompt: "Bitte den Festpreis betonen.",
    internal_link_targets: ["Seniorenumzug", "Firmenumzug"],
    ...patch,
  },
  structureOutline: "- Seniorenumzug (/privatumzug/seniorenumzug) · Unterseite · Hauptsilo: Privatumzug",
  existingText: null,
  sections: [{ key: "unternehmen", label: "Unternehmen & Kern", current: "Steiner Umzüge aus Köln, Festpreis nach Besichtigung." }],
  settings: { anrede: "Sie", branche: "handwerk", tonalitaet: "herzlich", verbotene_woerter: ["billig"] },
  avatar: { name: "Familie Berg", role: "Privatkunde", beschreibung: "Zieht mit zwei Kindern innerhalb Kölns um." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: ["Keine Preise nennen."],
  outputs: {},
  blocks: [],
  title: null,
  metaDescription: null,
  ...extra,
});

const analyse = contentStepSpec(1, context());
assert.match(analyse.system, /Analyse/);
assert.match(analyse.system, /schreibst die Seite NICHT/);
assert.match(analyse.user, /Hauptkeyword aus der Excel \(gesetzt, nicht ersetzen\): Privatumzug \(590\/Monat\)/);
assert.match(analyse.user, /Nutzerfragen aus Spalte H/);
assert.match(analyse.user, /Wer packt die Kisten\?/);
assert.match(analyse.user, /KI-Prompt der Redaktion/);
assert.match(analyse.user, /Erlaubte interne Linkziele \(nur diese, als Marker \[LINK: Seitenname\]\): Seniorenumzug · Firmenumzug/);
assert.match(analyse.user, /Seitentyp: Hauptsilo-Seite/);
assert.match(analyse.user, /Anbieterfakten/);
assert.match(analyse.user, /Avatar \(Wunschkunde/);
assert.match(analyse.user, /Verbotene Wörter.*„billig“/);
assert.match(analyse.user, /Anmerkungen der Redaktion[\s\S]*KI-Prompt aus der Seitenstruktur[\s\S]*Keine Preise nennen/);
assert.equal(analyse.tool.name, "submit_analyse");

const crawlAnalyse = contentStepSpec(1, context({ source: "crawl", page_role: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [] }, { existingText: "Alter Text der Live-Seite" }));
assert.match(crawlAnalyse.system, /aus dem Crawl, ohne Briefing/);
assert.match(crawlAnalyse.user, /Hauptkeyword: nicht vorgegeben/);
assert.match(crawlAnalyse.user, /Bisheriger Text der Seite[\s\S]*unbelegt/);
assert.match(crawlAnalyse.user, /keine internen Links setzen/);

const seo = contentStepSpec(2, context());
assert.match(seo.system, /Hauptsilo-Seite/);
assert.match(seo.system, /2–5 interne Links/);
assert.match(seo.system, new RegExp(CONTENT_HERO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")));
assert.match(seo.system, /Mindestens 3 Frage-Überschriften/);
assert.match(seo.system, /\[BITTE PRÜFEN/);
assert.match(seo.system, /Wir von Steiner Umzüge/);
const seoRatgeber = contentStepSpec(2, context({ page_type: "ratgeber", pillar_name: "Ratgeber" }));
assert.match(seoRatgeber.system, /Ratgeberartikel/);
assert.match(seoRatgeber.system, /Mindestens 5 Frage-Überschriften/);
assert.match(seoRatgeber.system, /Kein erfundener Autor/);
const seoUnterseite = contentStepSpec(2, context({ page_type: "unterseite", page_role: "supporting", pillar_name: "Privatumzug", name: "Seniorenumzug" }));
assert.match(seoUnterseite.system, /verlinkt IMMER auf ihr Hauptsilo „Privatumzug“ \(Marker \[LINK: Privatumzug\]\)/, "[Hauptsilo] becomes the pillar name");
assert.match(contentStepSpec(2, context({ page_type: "standort" })).system, /Standortseite/);

// --- Textvorlagen: the agency's recipes feed the SEO step, and only the SEO step --------------

assert.deepEqual(normalizeContentTypePrompts(null), DEFAULT_CONTENT_TYPE_PROMPTS, "no row → the defaults");
assert.deepEqual(normalizeContentTypePrompts({ hauptsilo: "   ", ratgeber: "" }), DEFAULT_CONTENT_TYPE_PROMPTS, "blank recipes are never stored");
const saved = normalizeContentTypePrompts({ hauptsilo: "  Hauptsilo nach Hausrezept: nur drei Abschnitte.  ", standort: "x".repeat(CONTENT_TYPE_PROMPT_MAX_CHARS + 50) });
assert.equal(saved.hauptsilo, "Hauptsilo nach Hausrezept: nur drei Abschnitte.");
assert.equal(saved.standort.length, CONTENT_TYPE_PROMPT_MAX_CHARS, "capped at the maximum");
assert.equal(saved.unterseite, DEFAULT_CONTENT_TYPE_PROMPTS.unterseite, "untouched recipes keep the default");
assert.equal(hasCustomContentTypePrompts(DEFAULT_CONTENT_TYPE_PROMPTS), false);
assert.equal(hasCustomContentTypePrompts(saved), true);
assert.deepEqual([...CONTENT_TYPE_PROMPT_KEYS], ["hauptsilo", "unterseite", "ratgeber", "standort"], "nicht_bearbeiten has no recipe");
assert.equal(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "nicht_bearbeiten", null), renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "unterseite", null));
assert.match(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "unterseite", null), /auf ihr Hauptsilo „Hauptsilo“/, "without a pillar the word stays");

const customContext = context({ page_type: "hauptsilo" }, { typePrompts: saved });
const seoCustom = contentStepSpec(2, customContext);
assert.match(seoCustom.system, /Hauptsilo nach Hausrezept: nur drei Abschnitte\./, "the saved Hauptsilo recipe is in the SEO system prompt");
assert.doesNotMatch(seoCustom.system, /2–5 interne Links/, "the default Hauptsilo rule is replaced, not appended");
assert.match(seoCustom.system, /Tatsachen \(Leistungen, Zahlen, Namen, Preise/, "the locked rules stay");
assert.match(seoCustom.system, new RegExp(CONTENT_HERO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")), "the hero placeholder stays");
assert.match(contentStepSpec(2, context({ page_type: "unterseite", pillar_name: "Privatumzug" }, { typePrompts: saved })).system, /Marker \[LINK: Privatumzug\]/, "each page still writes with its own type");
for (const step of [1, 3, 4, 5, 6, 7, 8, 9]) {
  assert.doesNotMatch(contentStepSpec(step, customContext).system, /Hausrezept/, `step ${step} does not read the recipes`);
}
console.log("textvorlagen: ok");

// --- who may change the Seitentyp ---------------------------------------------------------------

const excelPage: ContentPageRow = {
  id: "p1", organisation_id: "o1", slug: "privatumzug", name: "Privatumzug", path: "/privatumzug", level: 1, position: 1, source: "structure", source_url: null, crawled_at: null,
  main_keyword: null, page_role: "pillar", page_type: "hauptsilo", pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "nicht_begonnen", step: null, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], error: null, job_id: null, cost_eur: 0, started_by: null, created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:00:00Z",
};
const crawlPage: ContentPageRow = { ...excelPage, id: "p2", slug: "dach", source: "crawl", source_url: "https://x.de/dach", page_role: null, page_type: "unterseite" };
assert.deepEqual(contentPageTypeChangeBlocker(excelPage), { status: 409, message: CONTENT_TYPE_LOCKED_MESSAGE });
assert.equal(CONTENT_TYPE_LOCKED_MESSAGE, "Der Seitentyp kommt aus der Excel und kann hier nicht geändert werden.");
assert.deepEqual(contentPageTypeChangeBlocker({ ...excelPage, page_type: "nicht_bearbeiten" })?.message, CONTENT_TYPE_LOCKED_MESSAGE, "nicht_bearbeiten from the Excel stays locked");
assert.deepEqual(contentPageTypeChangeBlocker({ ...excelPage, state: "fertig" })?.message, CONTENT_TYPE_LOCKED_MESSAGE);
assert.equal(contentPageTypeChangeBlocker(crawlPage), null, "a crawl page may be changed");
assert.equal(contentPageTypeChangeBlocker({ ...crawlPage, page_type: "nicht_bearbeiten" }), null, "a wrongly guessed Kontakt can be corrected");
assert.equal(contentPageTypeChangeBlocker({ ...crawlPage, state: "fertig" }), null, "also after a run");
assert.match(contentPageTypeChangeBlocker({ ...crawlPage, state: "laeuft" })?.message ?? "", /läuft gerade/, "not while it runs");
assert.equal(canEditContentPageType(excelPage), false);
assert.equal(canEditContentPageType(crawlPage), true);
assert.equal(pageBriefing(excelPage).type_editable, false, "the drawer shows a label for Excel pages");
assert.equal(pageBriefing(crawlPage).type_editable, true, "the drawer shows the select for crawl pages");
console.log("seitentyp lock: ok");

const geo = contentStepSpec(4, context());
assert.match(geo.system, /GEO/);
assert.match(geo.system, /Zuletzt aktualisiert: \[DATUM\]/);
assert.match(geo.system, /QUELLE BITTE ERGÄNZEN/);
assert.match(geo.system, /120–180 Wörter/);
const hormozi = contentStepSpec(5, context());
assert.match(hormozi.system, /Hero/);
assert.match(hormozi.system, /Value Equation/);
assert.match(hormozi.system, /H1 bleibt unverändert/);
assert.match(contentStepSpec(5, context({ page_type: "ratgeber" })).system, /Kein harter Verkauf/);
const vermenschlichung = contentStepSpec(6, context());
assert.match(vermenschlichung.system, /Floskeln/);
assert.match(vermenschlichung.system, /In der heutigen schnelllebigen Zeit/);
assert.match(vermenschlichung.system, /höchstens 3 im ganzen Text/);
assert.match(vermenschlichung.system, /self_score/);
assert.ok(vermenschlichung.retryHint && vermenschlichung.score, "the Vermenschlichung may try once more");
assert.match(contentStepSpec(7, context()).system, /Lektorat/);
assert.match(contentStepSpec(8, context()).system, /Schreibe jeden Satz neu/);
assert.match(contentStepSpec(9, context()).system, /Endabnahme/);
for (const step of [3, 7, 9]) {
  assert.match(contentStepSpec(step, context()).user, /Avatar \(Wunschkunde/, `step ${step} still gets the avatar`);
  assert.match(contentStepSpec(step, context()).user, /Anbieterfakten/, `step ${step} still gets the facts`);
}
assert.match(contentStepSpec(9, context()).system, /Schritt 9 Endabnahme/);
assert.throws(() => contentStepSpec(10, context()), /Unbekannter Schritt/);
console.log("step specs: ok");

// --- Analyse normalisation: the Excel wins, Spalte H never falls off ---------------------------

const normalized = normalizeAnalyse(
  {
    intent: { primary: "kommerziell-vergleichend", modifiers: ["lokal", "unsinn"] },
    journey_phase: "falsch",
    conversion_goal: "anfrage",
    content_angle: "problem_loesung",
    main_keyword: "Umzug Köln günstig",
    secondary_keywords: ["Umzugsfirma Köln", "Privatumzug"],
    main_question: "Was kostet ein Privatumzug in Köln?",
    fanout_questions: [
      { question: "Was kostet ein Privatumzug?", source: "Recherche", theme: "Kosten" },
      { question: "Gibt es einen Festpreis?", source: "Anbieterfakten", theme: "Preis" },
    ],
    deferred_questions: [{ question: "Wer hilft Senioren?", link_to: "Seniorenumzug", short_answer_hint: "verweisen" }],
    dropped_questions: [{ question: "Wie wird das Wetter?", reason: "gehört nicht hierher" }],
    hormozi: { traumziel: "Stressfrei umziehen", hauptschmerz: "Chaos", groesste_huerde: "Kosten", moeglicher_beweis: "kein belegter Beweis", gewuenschter_cta: "Besichtigung anfragen" },
    usable_facts: ["Festpreis nach Besichtigung"],
    missing_facts: ["Preisbeispiele"],
    assumptions: [],
  },
  context(),
);
assert.equal(normalized.main_keyword, "Privatumzug", "the Excel keyword is never replaced");
assert.deepEqual(normalized.secondary_keywords, ["Privatumzüge", "Umzug privat", "Umzugsfirma Köln"], "Excel first, the main keyword never a secondary");
assert.deepEqual(normalized.intent, { primary: "kommerziell-vergleichend", modifiers: ["lokal"] });
assert.equal(normalized.journey_phase, "loesungssuche", "unknown values fall back");
assert.deepEqual(
  normalized.fanout_questions.map((q) => [q.question, q.source]),
  [
    ["Was kostet ein Privatumzug?", "Spalte H"],
    ["Gibt es einen Festpreis?", "Anbieterfakten"],
    ["Wie lange dauert ein Privatumzug?", "Spalte H"],
    ["Wer packt die Kisten?", "Spalte H"],
  ],
  "questions from Spalte H keep their source and are never dropped",
);
assert.equal(normalized.deferred_questions[0]?.link_to, "Seniorenumzug");
assert.equal(normalized.hormozi.moeglicher_beweis, "kein belegter Beweis");
console.log("analyse normalisation: ok");

// --- hero placeholder through the steps ---------------------------------------------------------

const h1 = { id: "intro", heading: "Privatumzug Köln", level: 1 as const, html: "" };
const body = { id: "ablauf", heading: "Wie läuft der Umzug ab?", level: 2 as const, html: "<p>So.</p>" };
const seoBlocks = ensureHeroPlaceholder([{ ...h1, level: 2 }, { id: "hero", heading: "Toller Hero", level: 2, html: "<p>nein</p>" }, body]);
assert.deepEqual(
  seoBlocks.map((b) => [b.id, b.heading, b.level, b.html]),
  [["intro", "Privatumzug Köln", 1, ""], ["hero", CONTENT_HERO_PLACEHOLDER, 2, ""], ["ablauf", "Wie läuft der Umzug ab?", 2, "<p>So.</p>"]],
  "SEO never writes a real hero and the first block is the H1",
);
const seoOut = contentStepSpec(2, context()).normalize({ title: "T", meta_description: "M", blocks: [h1, body] }, context()) as TextOutput;
assert.equal(seoOut.blocks[1]?.id, "hero", "a missing hero block is inserted");
const seoPatch = stepPatchFor(contentStepDefinition(2)!, seoOut);
assert.match(String(seoPatch.pagePatch.html), /data-block-id="hero"><h2>\[HERO – wird in Schritt 5 gefuellt\]<\/h2>/);
assert.equal(seoPatch.halted, false);

const kept = keepHeroBlock([h1, body], seoBlocks);
assert.equal(kept[1]?.id, "hero", "a later step that drops the hero gets it back");
assert.equal(kept[1]?.heading, CONTENT_HERO_PLACEHOLDER);
const filled = settleHeroSentence([h1, { id: "hero", heading: "Entspannt umziehen, ohne Chaos.", level: 2, html: "" }, body]);
assert.deepEqual([filled[1]?.heading, filled[1]?.html], [null, "<p><strong>Entspannt umziehen, ohne Chaos.</strong></p>"], "Hormozi's hero is a sentence, not an H2");
const hormoziOut = contentStepSpec(5, context({}, { blocks: seoBlocks })).normalize({ title: "", meta_description: "", blocks: [h1, { id: "hero", heading: "", level: 2, html: "<p>Ihr Umzug ohne Stress.</p>" }, body] }, context({}, { blocks: seoBlocks })) as TextOutput;
assert.equal(hormoziOut.blocks[1]?.html, "<p>Ihr Umzug ohne Stress.</p>");
assert.deepEqual(parseBlocksFromHtml(String(stepPatchFor(contentStepDefinition(5)!, hormoziOut).pagePatch.html)).map((b) => b.id), ["intro", "hero", "ablauf"]);
console.log("hero: ok");

// --- halting rules ------------------------------------------------------------------------------

const blocking: FaktencheckOutput = {
  findings: [],
  questions: [{ kind: "fact", question: "Stimmt der Festpreis?", blocking: true }],
};
const halt = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, blocking);
assert.deepEqual([halt.halted, halt.stepStatus, halt.pagePatch.state, halt.pagePatch.job_id], [true, "waiting", "braucht_sie", null], "blocking questions stop the page for the customer");
const soft = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [{ kind: "fact", question: "Egal", blocking: false }] });
assert.deepEqual([soft.halted, soft.stepStatus, soft.pagePatch.state], [false, "done", undefined]);
const release = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, { unresolved: [], summary: "ok" });
assert.deepEqual([release.halted, release.pagePatch.state, release.pagePatch.released], [true, "fertig", false]);
const geoPatch = stepPatchFor(contentStepDefinition(4)!, { blocks: seoBlocks, title: "T", meta_description: "M" });
assert.deepEqual(geoPatch.pagePatch.findings, [], "the rewrite after the Faktencheck settles its findings");
assert.throws(() => stepPatchFor(contentStepDefinition(4)!, { blocks: [], title: null, meta_description: null }), /keinen Text/);
const vermenschlichungSpec = contentStepSpec(6, context({}, { blocks: seoBlocks }));
const weak = vermenschlichungSpec.normalize({ title: "", meta_description: "", blocks: seoBlocks, self_score: { direktheit: 5, rhythmus: 6, vertrauen: 7, natuerlichkeit: 6, dichte: 6 } }, context({}, { blocks: seoBlocks })) as VermenschlichungOutput;
assert.match(vermenschlichungSpec.retryHint!(weak) ?? "", /30 von 50/, "a weak self-score asks for one more attempt");
const strong = vermenschlichungSpec.normalize({ title: "", meta_description: "", blocks: seoBlocks, self_score: { direktheit: 8, rhythmus: 8, vertrauen: 7, natuerlichkeit: 8, dichte: 7 } }, context({}, { blocks: seoBlocks })) as VermenschlichungOutput;
assert.equal(vermenschlichungSpec.retryHint!(strong), null);
assert.ok(vermenschlichungSpec.score!(strong) > vermenschlichungSpec.score!(weak));
console.log("halting rules: ok");

// --- the outline of the other pages ----------------------------------------------------------

const outline = contentStructureOutline(
  [
    { slug: "startseite", name: "Startseite", path: "/", level: 0, source: "structure", page_role: "startseite", page_type: "hauptsilo", pillar_name: null, main_keyword: null, keywords: null },
    { slug: "privatumzug", name: "Privatumzug", path: "/privatumzug", level: 1, source: "structure", page_role: "pillar", page_type: "hauptsilo", pillar_name: null, main_keyword: null, keywords: privat.keywords },
    { slug: "seniorenumzug", name: "Seniorenumzug", path: "/privatumzug/seniorenumzug", level: 2, source: "structure", page_role: "supporting", page_type: "unterseite", pillar_name: "Privatumzug", main_keyword: "Seniorenumzug", keywords: null },
    { slug: "dach", name: "Dach", path: "/dach", level: 1, source: "crawl", page_role: null, page_type: null, pillar_name: null, main_keyword: null, keywords: null },
  ],
  { slug: "seniorenumzug", name: "Seniorenumzug", pillar_name: "Privatumzug" },
);
assert.deepEqual(outline.split("\n"), [
  "- Privatumzug (/privatumzug) · Hauptsilo-Seite · Keyword: Privatumzug",
  "- Startseite (/) · Hauptsilo-Seite",
  "- Dach (/dach) · Crawl-Seite",
], "the own silo first, the page itself left out");
console.log("outline: ok");

// --- step 8: every sentence rephrased on Grok, nothing else -------------------------------------

const questionBlock = { id: "kosten", heading: "Was kostet ein Privatumzug?", level: 2 as const, html: "<p>Der Preis hängt vom Umfang ab. [BITTE PRÜFEN: Preisbeispiel]</p>" };
const heroSentence = { id: "hero", heading: null, level: 2 as const, html: "<p><strong>Ihr Umzug ohne Stress.</strong></p>" };
const beforeRephrase = [h1, heroSentence, questionBlock, { ...body, html: "<p>So läuft es. [LINK: Seniorenumzug]</p>" }];
const rephraseContext = context({}, { blocks: beforeRephrase, title: "Privatumzug Köln | Steiner", metaDescription: "Meta." });
const spec8 = contentStepSpec(CONTENT_STEP_WATERMARK, rephraseContext);
const sentToGrok = `${spec8.system}\n${spec8.user}\n${JSON.stringify(spec8.tool)}`;
assert.doesNotMatch(sentToGrok, /watermark|wasserzeichen|detector|detektor|EU AI Act|undetectable|hide AI/i, "the model never sees the step's name or purpose");
assert.match(spec8.system, /Schreibe jeden Satz neu/);
assert.match(spec8.system, /Kopiere keinen Satz wörtlich/);
assert.match(spec8.system, /\[LINK: …\]/);
assert.match(spec8.system, /\[BITTE PRÜFEN: …\]/);
assert.match(spec8.system, /\[DATUM\]/);
assert.match(spec8.system, /Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten weiter/);
assert.equal(spec8.tool.name, "submit_text");
assert.match(spec8.user, /Aktueller Text/);
assert.match(spec8.user, /Verbotene Wörter.*„billig“/);
assert.match(spec8.user, /Anmerkungen der Redaktion/);
assert.doesNotMatch(spec8.user, /Anbieterfakten aus Fragebogen/, "the facts are not sent; they must not change anyway");
assert.equal(contentStepDefinition(CONTENT_STEP_WATERMARK)?.provider, "xai", "step 8 runs on Grok");
assert.ok(CONTENT_STEPS.filter((s) => s.provider === "xai").length === 1, "no other step runs on Grok");

const merged = mergeRewrittenBlocks(beforeRephrase, [
  { id: "intro", heading: "Umzug Köln neu", level: 2, html: "" },
  { id: "hero", heading: "", level: 2, html: "<p><strong>Entspannt umziehen.</strong></p>" },
  { id: "kosten-neu", heading: "Was kostet ein Privatumzug", level: 3, html: "<p>Das hängt vom Umfang ab. [BITTE PRÜFEN: Preisbeispiel]</p>" },
  { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>So geht es. [LINK: Seniorenumzug]</p>" },
]);
assert.deepEqual(
  merged.map((b) => [b.id, b.heading, b.level, b.html]),
  [
    ["intro", "Privatumzug Köln", 1, ""],
    ["hero", null, 2, "<p><strong>Entspannt umziehen.</strong></p>"],
    ["kosten", "Was kostet ein Privatumzug?", 2, "<p>Das hängt vom Umfang ab. [BITTE PRÜFEN: Preisbeispiel]</p>"],
    ["ablauf", "Wie läuft der Umzug ab?", 2, "<p>So geht es. [LINK: Seniorenumzug]</p>"],
  ],
  "ids, headings and levels stay, a question stays a question, only the body is new",
);
assert.equal(mergeRewrittenBlocks(beforeRephrase, [{ id: "hero", heading: "", level: 2, html: "<p>Nur der Hero.</p>" }]).length, 4, "a dropped block comes back unchanged");
assert.equal(mergeRewrittenBlocks(beforeRephrase, [{ id: "kosten", heading: "", level: 2, html: "   " }])[2]?.html, questionBlock.html, "an empty body keeps the previous text");
const out8 = spec8.normalize(
  { blocks: [{ id: "ablauf", heading: "", level: 2, html: "<p>Neu.</p>" }, { id: "kosten", heading: "", level: 2, html: "<p>Neu 2.</p>" }] },
  rephraseContext,
) as TextOutput;
assert.deepEqual(out8.blocks.map((b) => [b.id, b.html]), [["intro", ""], ["hero", heroSentence.html], ["kosten", "<p>Neu 2.</p>"], ["ablauf", "<p>Neu.</p>"]], "the answer is matched by id, the order is the page's");
assert.deepEqual([out8.title, out8.meta_description], ["Privatumzug Köln | Steiner", "Meta."], "title and meta are not the step's to change");
assert.throws(() => spec8.normalize({ blocks: [] }, rephraseContext), /keinen Text/);
const patch8 = stepPatchFor(contentStepDefinition(CONTENT_STEP_WATERMARK)!, out8);
assert.match(String(patch8.pagePatch.html), /Was kostet ein Privatumzug\?/);
assert.equal(patch8.halted, false);
assert.deepEqual([priceForModel("grok-4.7").inputUsd, priceForModel("grok-4.7").outputUsd, priceForModel("grok-4").inputUsd, priceForModel("grok-4").outputUsd], [2, 6, 3, 15]);
assert.equal(estimateCostEur("grok-4.7", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 1), 8);
assert.deepEqual(resolveXaiModels({}), ["grok-4.7", "grok-4"]);
assert.deepEqual(resolveXaiModels({ XAI_DT_CONTENT_MODEL: " grok-4 " }), ["grok-4"]);
assert.deepEqual(resolveXaiModels({ XAI_DT_CONTENT_MODEL: "grok-5" }), ["grok-5", "grok-4"]);
console.log("step 8 spec: ok");

async function runXai() {
  const neverFetch = async (): Promise<Response> => {
    throw new Error("fetch must not be called without a key");
  };
  for (const env of [{}, { ANTHROPIC_DT_CONTENT_API_KEY: "claude-key" }, { XAI_API_KEY: "   " }]) {
    await assert.rejects(
      callXaiTool({ system: "s", user: "u", tool: spec8.tool, maxTokens: 10, env, fetchImpl: neverFetch }),
      (error: unknown) =>
        error instanceof Error && error.message === XAI_MISSING_KEY_MESSAGE && (error as { retryable?: boolean }).retryable === false,
      "no key → the German error, no network call, no Claude fallback",
    );
  }
  assert.equal(XAI_MISSING_KEY_MESSAGE, "Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt). Bitte die Technik informieren.");

  const seen: Array<{ model: string; auth: string | null; forced: string }> = [];
  const stubFetch = async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as { model: string; tool_choice: { function: { name: string } }; messages: Array<{ role: string; content: string }> };
    seen.push({ model: body.model, auth: (init.headers as Record<string, string>).Authorization ?? null, forced: body.tool_choice.function.name });
    assert.doesNotMatch(body.messages.map((m) => m.content).join("\n"), /watermark|wasserzeichen|detector/i);
    if (body.model === "grok-4.7") return new Response(JSON.stringify({ error: { message: "The model grok-4.7 does not exist" } }), { status: 404 });
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { tool_calls: [{ function: { name: "submit_text", arguments: JSON.stringify({ blocks: [{ id: "ablauf", heading: "", level: 2, html: "<p>Neu.</p>" }] }) } }] } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
      { status: 200 },
    );
  };
  const answer = await callXaiTool({ system: spec8.system, user: spec8.user, tool: spec8.tool, maxTokens: 100, env: { XAI_API_KEY: "k" }, fetchImpl: stubFetch });
  assert.deepEqual(seen.map((s) => s.model), ["grok-4.7", "grok-4"], "404 on the configured model → the fallback");
  assert.ok(seen.every((s) => s.auth === "Bearer k" && s.forced === "submit_text"));
  assert.equal(answer.model, "grok-4");
  assert.deepEqual(answer.usage, { inputTokens: 120, outputTokens: 30 });
  assert.equal((answer.json as { blocks: Array<{ html: string }> }).blocks[0]?.html, "<p>Neu.</p>");

  const rejected = async (): Promise<Response> => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
  await assert.rejects(
    callXaiTool({ system: "s", user: "u", tool: spec8.tool, maxTokens: 10, env: { XAI_API_KEY: "bad" }, fetchImpl: rejected }),
    (error: unknown) => error instanceof Error && /abgelehnt/.test(error.message) && (error as { retryable?: boolean }).retryable === false,
  );
  const busy = async (): Promise<Response> => new Response("overloaded", { status: 503 });
  await assert.rejects(
    callXaiTool({ system: "s", user: "u", tool: spec8.tool, maxTokens: 10, env: { XAI_API_KEY: "k" }, fetchImpl: busy }),
    (error: unknown) => error instanceof Error && /ausgelastet/.test(error.message) && (error as { retryable?: boolean }).retryable === true,
  );
  console.log("grok caller: ok");
}

runXai()
  .then(() => console.log("OK: content excel structure tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
