/**
 * Texte: the Excel briefing parser, page types, the steps and their halting rules.
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
  CONTENT_PAGE_ROLES,
  CONTENT_PAGE_TYPE_LABELS,
  CONTENT_PAGE_TYPE_OPTIONS,
  CONTENT_PAGE_TYPES,
  contentPageTypeLabel,
  derivePageType,
  effectiveContentPageType,
  extractCityCandidates,
  guessCrawlPageType,
  isContentPageType,
  isExcludedContentPageName,
  isHomeContentName,
} from "../lib/dt/content/page-types";
import {
  CONTENT_HERO_PLACEHOLDER,
  CONTENT_HERO_PLACEHOLDER_LEGACY,
  brancheRules,
  contentStepSpec,
  ensureHeroPlaceholder,
  keepHeroBlock,
  normalizeAnalyse,
  rephraseChunkPrompt,
  settleHeroSentence,
  type ContentPipelineContext,
  type FaktencheckOutput,
  type TextOutput,
  type VermenschlichungOutput,
} from "../lib/dt/content/pipeline/prompts";
import { describeRunningPage } from "../lib/dt/content/job-state";
import {
  emptyRephraseProgress,
  mergeRewrittenBlocks,
  parseRephrasedChunk,
  planRephraseChunks,
  readRephraseProgress,
  rephraseChunkMaxTokens,
  rephraseModelOrder,
  rephraseProgressLabel,
  rephrasedBlocks,
} from "../lib/dt/content/pipeline/rephrase";
import { contentGapQuestions, findContentGapsInHtml, gapQuestion, hasContentGap } from "../lib/dt/content/pipeline/gaps";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import { aktualitaetSystemPrompt } from "../lib/dt/content/pipeline/aktualitaet";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_WATERMARK,
  CONTENT_STEPS,
  contentStepDefinition,
  hasLegacyContentSteps,
  runningPageDetail,
} from "../lib/dt/content/pipeline/steps";
import { callXaiText, DEFAULT_XAI_MODEL, resolveXaiModels, XAI_MISSING_KEY_MESSAGE, XAI_MODEL_FALLBACKS, XaiTimeoutError } from "../lib/dt/content/pipeline/xai";
import { estimateCostEur, priceForModel } from "../lib/dt/content/pricing";
import { approveNeedsConfirm } from "../lib/dt/content/presentation";
import { parseBlocksFromHtml, renderBlocksHtml } from "../lib/dt/content/render";
import {
  canEditContentPageType,
  contentPageTypeChangeBlocker,
  contentStructureOutline,
  pageActions,
  pageBriefing,
  pageDetail,
  pageSummary,
  questionsDetail,
  rerunStepFor,
  type ContentPageRow,
} from "../lib/dt/content/store";
import {
  CONTENT_STEP_PROMPT_KEYS,
  CONTENT_STEP_PROMPT_MAX_CHARS,
  DEFAULT_CONTENT_STEP_PROMPTS,
  fillContentStepPrompt,
  normalizeStoredContentStepPrompts,
  resolveContentStepPrompt,
  resolveContentStepPrompts,
} from "../lib/dt/content/step-prompts";
import { briefingPatchFor, planImprovementStructure } from "../lib/dt/content/structure-plan";
import { DEFAULT_TEXTER_PROMPT } from "../lib/dt/content/texter-prompt";
import {
  CONTENT_TYPE_PROMPT_HELP,
  CONTENT_TYPE_PROMPT_KEYS,
  CONTENT_TYPE_PROMPT_LABELS,
  CONTENT_TYPE_PROMPT_MAX_CHARS,
  DEFAULT_CONTENT_TYPE_PROMPTS,
  contentTypePromptKeyFor,
  hasCustomContentTypePrompts,
  normalizeContentTypePrompts,
  renderContentTypePrompt,
} from "../lib/dt/content/type-prompts";
import { loadContentTypePrompts, saveContentTypePrompts } from "../lib/dt/content/type-prompts-db";
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
    ["startseite", "startseite", "startseite", 0, null],
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
    ["startseite", "startseite", "startseite", 0, null],
    ["leistungen", "pillar", "hauptsilo", 1, null],
    ["dachsanierung", "supporting", "unterseite", 2, "Leistungen"],
    ["flachdach", "supporting", "unterseite", 3, "Leistungen"],
    ["ueber-uns", "pillar", "ueber_uns", 1, null],
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
assert.equal(derivePageType({ name: "Über uns", role: "pillar" }), "ueber_uns");
assert.equal(derivePageType({ name: "Ueber uns", role: "pillar" }), "ueber_uns");
assert.equal(derivePageType({ name: "Über uns – das Team", role: "pillar" }), "nicht_bearbeiten", "only the page named exactly Über uns");
assert.equal(derivePageType({ name: "Team", role: "supporting", path: "/ueber-uns" }), "nicht_bearbeiten", "the path segment counts too");
assert.equal(derivePageType({ name: "Umzugsratgeber", role: "pillar" }), "ratgeber");
assert.equal(derivePageType({ name: "Checkliste", role: "supporting", pillarName: "Ratgeber" }), "ratgeber");
assert.equal(derivePageType({ name: "Umzug Bonn", role: "supporting", pillarName: "Regionen" }), "standort");
assert.equal(derivePageType({ name: "Umzug Bonn", role: "supporting", pillarName: "Leistungen", cities: ["Bonn"] }), "standort");
assert.equal(derivePageType({ name: "Gewissenhafte Planung", role: "supporting", pillarName: "Leistungen" }), "unterseite", "„wissen“ inside a word is no Ratgeber");
assert.equal(derivePageType({ name: "Privatumzug", role: "pillar" }), "hauptsilo");
assert.equal(derivePageType({ name: "Startseite", role: "startseite" }), "startseite");
assert.equal(derivePageType({ name: "Hauptseite", role: "startseite" }), "startseite");
assert.equal(derivePageType({ name: "Seniorenumzug", role: "supporting", pillarName: "Privatumzug" }), "unterseite");
assert.equal(isExcludedContentPageName("Datenschutzerklärung"), true);
assert.equal(isExcludedContentPageName("Referenzen"), true);
assert.equal(isExcludedContentPageName("Kontaktlinsen"), false, "only whole words");
assert.equal(isExcludedContentPageName("Leistungen", "/kontakt/leistungen"), false, "only the last segment counts");
assert.equal(guessCrawlPageType({ name: "Startseite", path: "/", level: 0 }), "startseite");
assert.equal(guessCrawlPageType({ name: "Start | Firma", path: "/", level: 0 }), "startseite", "the site root is the homepage whatever the title");
assert.equal(guessCrawlPageType({ name: "Über uns", path: "/ueber-uns", level: 1 }), "ueber_uns");
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

// „Hauptseite“: its own type, chosen by hand only.
assert.ok(isContentPageType("hauptseite"));
assert.equal(CONTENT_PAGE_TYPE_LABELS.hauptseite, "Hauptseite");
assert.equal(contentPageTypeLabel("hauptseite"), "Hauptseite");
assert.equal(contentPageTypeLabel(null), "Noch nicht bestimmt");
assert.deepEqual(
  CONTENT_PAGE_TYPE_OPTIONS.map((o) => o.value),
  [...CONTENT_PAGE_TYPES],
  "the select offers every type, „Nicht bearbeiten“ included",
);
assert.ok(CONTENT_PAGE_TYPES.includes("nicht_bearbeiten") && CONTENT_PAGE_TYPES.includes("startseite") && CONTENT_PAGE_TYPES.includes("hauptsilo"), "Startseite and Hauptsilo-Seite stay");
assert.equal(isHomeContentName("Hauptseite"), true, "the name check is unchanged");
assert.equal(guessCrawlPageType({ name: "Hauptseite", path: "/hauptseite", level: 1 }), "startseite", "a page titled „Hauptseite“ is still guessed as Startseite");
const names = ["Hauptseite", "Startseite", "Home", "Privatumzug", "Hauptseite Dachsanierung", "Leistungen", "Umzug Bonn", "Ratgeber", "Über uns", "Impressum", "Fassadenreinigung"];
const paths = [null, "/", "/hauptseite", "/leistungen", "/leistungen/fassade", "/regionen/bonn"];
for (const name of names) {
  for (const path of paths) {
    for (const role of [...CONTENT_PAGE_ROLES, null]) {
      for (const pillarName of [null, "Leistungen", "Regionen", "Hauptseite"]) {
        assert.notEqual(derivePageType({ name, role, path, pillarName, cities: ["Bonn"] }), "hauptseite", `derivePageType(${name}, ${role}, ${path}) never returns hauptseite`);
      }
    }
    for (const level of [0, 1, 2, 3]) {
      assert.notEqual(guessCrawlPageType({ name, path, level, cities: ["Bonn"] }), "hauptseite", `guessCrawlPageType(${name}, ${path}, ${level}) never returns hauptseite`);
    }
  }
}
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
    ["startseite", "startseite", null, "https://x.de/"],
    ["kontakt", "nicht_bearbeiten", null, "https://x.de/kontakt/"],
    ["leistungen", "hauptsilo", null, "https://x.de/leistungen"],
    ["dach", "unterseite", "Leistungen", "https://x.de/leistungen/dach"],
    ["tipps", "ratgeber", null, "https://x.de/ratgeber/tipps"],
  ],
  "crawl pages get a guessed type and their top-level page as Hauptsilo; no Excel needed",
);
assert.ok(crawlPlan.inserts.every((p) => !("keywords" in p)), "the crawl invents no keywords or questions");
console.log("crawl without excel: ok");

// --- „Verbesserung“: the Seitenstruktur next to the table and the crawl ---------------------------

{
  const rows = [
    { slug: "startseite", path: "/", source_url: "https://steiner-umzuege.de/", position: 0 },
    { slug: "privatumzug", path: "/privatumzug", source_url: "https://steiner-umzuege.de/Privatumzug/", position: 1 },
    { slug: "kontakt", path: "/kontakt", source_url: "https://steiner-umzuege.de/kontakt", position: 2 },
    { slug: "firmenumzug", path: "/firmenumzug", source_url: "https://steiner-umzuege.de/firmenumzug", position: 3 },
    { slug: "ratgeber", path: "/blog/ratgeber", source_url: "https://steiner-umzuege.de/blog/ratgeber", position: 4 },
  ];
  const crawled = [
    site({ url: "https://steiner-umzuege.de/", title: "Steiner" }),
    site({ url: "https://steiner-umzuege.de/Privatumzug/", title: "Privatumzug" }),
    site({ url: "https://steiner-umzuege.de/kontakt", title: "Kontakt" }),
    site({ url: "https://steiner-umzuege.de/firmenumzug", title: "Firmenumzug" }),
    site({ url: "https://steiner-umzuege.de/blog/ratgeber", title: "Blog" }),
    site({ url: "https://steiner-umzuege.de/ratgeber/umzugscheckliste/", h1: "Checkliste" }),
    site({ url: "https://steiner-umzuege.de/regionen/bonn", title: "Bonn", final_url: "https://steiner-umzuege.de/" }),
  ];
  const plan = planImprovementStructure(steiner.pages, rows, crawled);
  assert.equal(plan.crawled, true);
  assert.deepEqual(
    plan.updates.map((u) => [u.slug, u.page.slug]),
    [["startseite", "startseite"], ["privatumzug", "privatumzug"], ["kontakt", "kontakt"]],
    "Excel rows that match a table row by path (any spelling) brief that row, no new row",
  );
  assert.deepEqual(plan.onSite.map((p) => p.slug), ["umzugscheckliste"], "on the crawled site but not taken over yet: nothing to create");
  assert.deepEqual(
    plan.missing.map((p) => [p.slug, p.name, p.path, p.page_type, p.position, p.source_url]),
    [
      ["seniorenumzug", "Seniorenumzug", "/privatumzug/seniorenumzug", "unterseite", 5, null],
      ["ratgeber-2", "Ratgeber", "/ratgeber", "ratgeber", 6, null],
      ["regionen", "Regionen", "/regionen", "hauptsilo", 7, null],
      ["bonn", "Umzug Bonn", "/regionen/bonn", "standort", 8, null],
    ],
    "missing: not in the table, not on the site (a redirect is no page); a slug of the table is never reused; no live URL",
  );
  assert.ok(!plan.missing.some((p) => p.page_type === "nicht_bearbeiten"), "Impressum and Co. are never listed");
  assert.ok(!plan.updates.some((u) => u.slug === "firmenumzug"), "a crawled page the Excel does not name is left alone");

  const bySlugOnly = planImprovementStructure(
    briefingFromStructureTree([{ label: "Firmenumzug", children: [] }]),
    rows,
    crawled,
  );
  assert.deepEqual(bySlugOnly.updates.map((u) => u.slug), ["firmenumzug"], "without a path the slug matches");

  const noCrawl = planImprovementStructure(steiner.pages, [], []);
  assert.equal(noCrawl.crawled, false);
  assert.deepEqual(
    noCrawl.missing.map((p) => p.slug),
    ["startseite", "privatumzug", "seniorenumzug", "ratgeber", "umzugscheckliste", "regionen", "bonn"],
    "before a crawl: every Excel page with a text to write that is not in the table",
  );

  const patch = briefingPatchFor(privat);
  assert.deepEqual(
    Object.keys(patch).sort(),
    ["estimated_traffic", "h1_options", "internal_link_targets", "keywords", "ki_prompt", "main_keyword", "page_role", "page_type", "pillar_name", "user_questions"],
    "the briefing only: no slug, name, path, source, live URL, text, state, steps or cost",
  );
  assert.deepEqual(Object.keys(briefingPatchFor(privat, "structure")).sort(), ["internal_link_targets", "page_role", "page_type", "pillar_name"], "a text structure keeps the keywords");
}
console.log("verbesserung plan: ok");

// --- the ten steps ------------------------------------------------------------------------------

assert.deepEqual(
  CONTENT_STEPS.map((s) => [s.step, s.name, s.tier, s.writesText, s.provider]),
  [
    [1, "Analyse", "write", false, "anthropic"],
    [2, "SEO", "write", true, "anthropic"],
    [3, "Faktencheck", "check", false, "anthropic"],
    [4, "GEO", "write", true, "anthropic"],
    [5, "Aktualitätsprüfung", "write", true, "anthropic"],
    [6, "Hormozi", "write", true, "anthropic"],
    [7, "Vermenschlichung", "write", true, "anthropic"],
    [8, "Lektorat", "check", true, "anthropic"],
    [9, "Watermark Entfernung", "write", true, "xai"],
    [10, "Endabnahme", "check", false, "anthropic"],
  ],
);
assert.deepEqual(
  [CONTENT_STEP_ANALYSE, CONTENT_STEP_SEO, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_GEO, CONTENT_STEP_AKTUALITAET, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT, CONTENT_STEP_WATERMARK, CONTENT_STEP_ENDABNAHME],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
);
assert.ok(CONTENT_STEPS.every((s, i) => s.step === i + 1), "the step numbers have no gap");
assert.equal(hasLegacyContentSteps([{ step: 8, name: "Endabnahme" }]), true, "the eight-step order is legacy");
assert.equal(hasLegacyContentSteps([{ step: 8, name: "Watermark Entfernung" }, { step: 9, name: "Endabnahme" }]), true, "the nine-step order without migration is legacy too");
assert.equal(hasLegacyContentSteps([{ step: 9, name: "Watermark Entfernung" }, { step: 10, name: "Endabnahme" }]), false);
assert.equal(runningPageDetail(2, [{ step: 1, status: "done" }, { step: 2, status: "done" }]), "Schritt 3 von 10 startet: Faktencheck");
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
  freshness: EMPTY_CONTENT_FRESHNESS,
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
assert.match(seo.system, /Entscheidungshilfe/);
assert.match(seo.system, /Bei Widerspruch gewinnt die Seitentyp-Vorlage/);
assert.match(seo.system, new RegExp(CONTENT_HERO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")));
assert.match(seo.system, /Mindestens 3 Frage-Überschriften/);
assert.match(seo.system, /\[BITTE PRÜFEN/);
assert.match(seo.system, /Wir von Steiner Umzüge/);
const seoRatgeber = contentStepSpec(2, context({ page_type: "ratgeber", pillar_name: "Ratgeber" }));
assert.match(seoRatgeber.system, /Ratgeberartikel/);
assert.match(seoRatgeber.system, /Mindestens 5 Frage-Überschriften/);
assert.match(seoRatgeber.system, /Kein erfundener Autor/);
const seoUnterseite = contentStepSpec(2, context({ page_type: "unterseite", page_role: "supporting", pillar_name: "Privatumzug", name: "Seniorenumzug" }));
assert.match(seoUnterseite.system, /innerhalb des Hauptsilos „Privatumzug“/, "[Hauptsilo] becomes the pillar name");
assert.match(seoUnterseite.system, /Marker \[LINK: Privatumzug\]/);
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
assert.deepEqual([...CONTENT_TYPE_PROMPT_KEYS], ["hauptsilo", "hauptseite", "unterseite", "ratgeber", "standort", "startseite", "ueber_uns"], "nicht_bearbeiten has no recipe");
assert.match(DEFAULT_CONTENT_TYPE_PROMPTS.startseite, /Seitentyp Startseite/);
assert.match(DEFAULT_CONTENT_TYPE_PROMPTS.ueber_uns, /Seitentyp Über-uns-Seite/);
assert.match(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "startseite", null), /Visitenkarte/);
assert.match(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "ueber_uns", null), /Vertrauensfrage/);
assert.equal(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "nicht_bearbeiten", null), renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "unterseite", null));
assert.match(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "unterseite", null), /Silo-Seite „Hauptsilo“/, "without a pillar the word stays");

const customContext = context({ page_type: "hauptsilo" }, { typePrompts: saved });
const seoCustom = contentStepSpec(2, customContext);
assert.match(seoCustom.system, /Hauptsilo nach Hausrezept: nur drei Abschnitte\./, "the saved Hauptsilo recipe is in the SEO system prompt");
assert.doesNotMatch(seoCustom.system, /Entscheidungshilfe/, "the default Hauptsilo rule is replaced, not appended");
assert.match(seoCustom.system, /Bei Widerspruch gewinnt die Seitentyp-Vorlage/, "the general Texter prompt stays");
assert.match(seoCustom.system, /Tatsachen \(Leistungen, Zahlen, Namen, Preise/, "the locked rules stay");
assert.match(seoCustom.system, new RegExp(CONTENT_HERO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")), "the hero placeholder stays");
assert.match(contentStepSpec(2, context({ page_type: "unterseite", pillar_name: "Privatumzug" }, { typePrompts: saved })).system, /Marker \[LINK: Privatumzug\]/, "each page still writes with its own type");
for (const step of [CONTENT_STEP_ANALYSE, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT, CONTENT_STEP_ENDABNAHME]) {
  assert.doesNotMatch(contentStepSpec(step, customContext).system, /Hausrezept/, `step ${step} does not read the recipes`);
}
assert.doesNotMatch(aktualitaetSystemPrompt(customContext), /Hausrezept/, "the Aktualitätsprüfung does not read the recipes");

// Hauptseite: its own recipe, used by the SEO step for that type (and by nothing else).
assert.equal(CONTENT_TYPE_PROMPT_LABELS.hauptseite, "Hauptseite");
assert.equal(CONTENT_TYPE_PROMPT_HELP.hauptseite, "Eine Leistung als eigene Hauptseite, ohne Unterseiten.");
assert.equal(contentTypePromptKeyFor("hauptseite"), "hauptseite");
assert.equal(contentTypePromptKeyFor("nicht_bearbeiten"), "unterseite", "unchanged");
const hauptseiteRecipe = DEFAULT_CONTENT_TYPE_PROMPTS.hauptseite;
for (const part of [/^Seitentyp Hauptseite\./, /Pflicht-Inputs:/, /Struktur:\n1\. /, /Besondere Regeln:/, /Keine Unterseiten erfinden/, /Zur Startseite/, /Kein Silo-Überblick/]) {
  assert.match(hauptseiteRecipe, part, `the default Hauptseite recipe has ${part}`);
}
assert.ok(hauptseiteRecipe.length <= CONTENT_TYPE_PROMPT_MAX_CHARS);
assert.equal(normalizeContentTypePrompts({}).hauptseite, hauptseiteRecipe, "an empty column means the default");
assert.equal(renderContentTypePrompt(DEFAULT_CONTENT_TYPE_PROMPTS, "hauptseite", null), hauptseiteRecipe);
const hauptseiteSeo = contentStepSpec(2, context({ page_type: "hauptseite", page_role: null, pillar_name: null }));
assert.ok(hauptseiteSeo.system.includes(hauptseiteRecipe), "a Hauptseite writes with the Hauptseite recipe");
assert.doesNotMatch(hauptseiteSeo.system, /Entscheidungshilfe/, "not with the Hauptsilo recipe");
assert.match(hauptseiteSeo.user, /Seitentyp: Hauptseite/);
const ownHauptseite = contentStepSpec(2, context({ page_type: "hauptseite" }, { typePrompts: normalizeContentTypePrompts({ hauptseite: "Hauptseite nach Hausrezept." }) }));
assert.match(ownHauptseite.system, /Hauptseite nach Hausrezept\./, "a saved Hauptseite recipe reaches the SEO step");
assert.doesNotMatch(contentStepSpec(2, context({ page_type: "startseite" })).system, /Seitentyp Hauptseite\./, "the Startseite keeps its own recipe");
console.log("textvorlagen: ok");

// --- editable step prompts (Globale Prompts) ------------------------------------------------------

{
  assert.deepEqual([...CONTENT_STEP_PROMPT_KEYS], ["seo", "faktencheck", "geo", "aktualitaet", "hormozi", "vermenschlichung", "lektorat"]);
  for (const key of CONTENT_STEP_PROMPT_KEYS) {
    const text = DEFAULT_CONTENT_STEP_PROMPTS[key];
    assert.ok(text.length > 200 && text.length <= CONTENT_STEP_PROMPT_MAX_CHARS, `${key}: a real default within the limit`);
    assert.ok(!text.includes(DEFAULT_TEXTER_PROMPT.slice(0, 80)), `${key}: the Texter prompt is not pasted into the default`);
    assert.ok(!text.includes(DEFAULT_CONTENT_TYPE_PROMPTS.hauptsilo.slice(0, 80)), `${key}: no Textvorlage in the default`);
    assert.ok(!text.includes("Du arbeitest für eine Agentur"), `${key}: BASE_RULES stay in code`);
  }

  // Storage: NULL, empty and the default itself mean „default“; own texts are capped.
  assert.deepEqual(resolveContentStepPrompts(null), DEFAULT_CONTENT_STEP_PROMPTS);
  assert.deepEqual(normalizeStoredContentStepPrompts({ seo: "   ", geo: DEFAULT_CONTENT_STEP_PROMPTS.geo, unknown: "x" }), {});
  assert.deepEqual(normalizeStoredContentStepPrompts('{"lektorat":"  Nur Kommas prüfen.  "}'), { lektorat: "Nur Kommas prüfen." }, "a JSON string is read too");
  assert.equal(normalizeStoredContentStepPrompts({ hormozi: "x".repeat(CONTENT_STEP_PROMPT_MAX_CHARS + 10) }).hormozi?.length, CONTENT_STEP_PROMPT_MAX_CHARS);
  assert.equal(resolveContentStepPrompt("geo", ""), DEFAULT_CONTENT_STEP_PROMPTS.geo);
  assert.equal(fillContentStepPrompt("{{firmenname}} / {{unbekannt}}", { firmenname: "Steiner" }), "Steiner / {{unbekannt}}", "unknown names stay visible");

  // Saved SEO instruction: it replaces the default, the code still adds BASE_RULES, the Texter
  // prompt, the Textvorlage (in that order, after the instruction), the Branchenregel, the user
  // message and the tool schema.
  const own = "Eigene SEO-Anweisung für {{firmenname}}: drei Abschnitte, mindestens {{mindest_fragen}} Fragen.";
  const ownSeo = contentStepSpec(2, context({}, { stepPrompts: { seo: own } }));
  assert.ok(ownSeo.system.startsWith("Eigene SEO-Anweisung für Steiner Umzüge: drei Abschnitte, mindestens 3 Fragen."), "the saved text comes first, variables filled");
  assert.doesNotMatch(ownSeo.system, /Festes Gerüst/, "the default instruction is replaced, not appended");
  const at = (text: string) => ownSeo.system.indexOf(text);
  assert.ok(at("Tatsachen (Leistungen, Zahlen, Namen") > 0, "BASE_RULES after the instruction");
  assert.ok(at("Allgemeine Regeln (jeder Seitentyp):") > at("Tatsachen (Leistungen"), "Texter prompt after BASE_RULES");
  assert.match(ownSeo.system, /Bei Widerspruch gewinnt die Seitentyp-Vorlage/, "the Texter prompt is still injected");
  assert.ok(at("Seitentyp-Vorlage (gilt bei Widerspruch vor den allgemeinen Regeln):") > at("Allgemeine Regeln"), "the Textvorlage after the Texter prompt, so it wins");
  assert.match(ownSeo.system, /Entscheidungshilfe/, "the Hauptsilo Textvorlage is still injected");
  assert.ok(ownSeo.system.endsWith(brancheRules(context().settings)), "the Branchenregel closes the system prompt");
  assert.equal(ownSeo.user, contentStepSpec(2, context()).user, "the user message does not change");
  assert.deepEqual(ownSeo.tool, contentStepSpec(2, context()).tool, "the tool schema does not change");
  const customTexter = contentStepSpec(2, context({}, { stepPrompts: { seo: own }, texterPrompt: "Hausregel: kurze Sätze.", typePrompts: saved }));
  assert.match(customTexter.system, /Hausregel: kurze Sätze\./);
  assert.match(customTexter.system, /Hauptsilo nach Hausrezept/, "a saved Textvorlage still reaches the SEO step");

  // Empty saved text falls back to the default, byte for byte.
  assert.equal(contentStepSpec(2, context({}, { stepPrompts: { seo: "  \n " } })).system, contentStepSpec(2, context()).system);
  assert.match(contentStepSpec(2, context()).system, /^Schritt 2 SEO: /, "the default instruction leads the system prompt");

  // Each of the seven reads its own text, the others keep their default; Analyse and Endabnahme are not editable.
  const allOwn = Object.fromEntries(CONTENT_STEP_PROMPT_KEYS.map((key) => [key, `EIGEN-${key}`]));
  const steps: Record<string, number> = {
    seo: CONTENT_STEP_SEO,
    faktencheck: CONTENT_STEP_FAKTENCHECK,
    geo: CONTENT_STEP_GEO,
    aktualitaet: CONTENT_STEP_AKTUALITAET,
    hormozi: CONTENT_STEP_HORMOZI,
    vermenschlichung: CONTENT_STEP_VERMENSCHLICHUNG,
    lektorat: CONTENT_STEP_LEKTORAT,
  };
  // The Aktualitätsprüfung has no single tool spec (two calls); both calls share this system prompt.
  const systemOf = (key: string, ctx: ContentPipelineContext) =>
    key === "aktualitaet" ? aktualitaetSystemPrompt(ctx) : contentStepSpec(steps[key]!, ctx).system;
  for (const key of CONTENT_STEP_PROMPT_KEYS) {
    const system = systemOf(key, context({}, { stepPrompts: { [key]: `EIGEN-${key}` } }));
    assert.ok(system.startsWith(`EIGEN-${key}\n\nDu arbeitest für eine Agentur`), `${key}: the saved text, then BASE_RULES`);
    assert.ok(system.endsWith(brancheRules(context().settings)), `${key}: the Branchenregel stays`);
    for (const other of CONTENT_STEP_PROMPT_KEYS.filter((k) => k !== key)) {
      assert.doesNotMatch(systemOf(other, context({}, { stepPrompts: { [key]: `EIGEN-${key}` } })), new RegExp(`EIGEN-${key}`), `${other} does not read ${key}`);
    }
  }
  assert.equal(contentStepSpec(CONTENT_STEP_FAKTENCHECK, context({}, { stepPrompts: allOwn })).tool.name, "submit_faktencheck", "the parser keeps its schema");
  assert.doesNotMatch(contentStepSpec(CONTENT_STEP_ANALYSE, context({}, { stepPrompts: allOwn })).system, /EIGEN-/, "Analyse is not editable");
  assert.equal(contentStepSpec(CONTENT_STEP_ENDABNAHME, context({}, { stepPrompts: allOwn })).system, contentStepSpec(CONTENT_STEP_ENDABNAHME, context()).system, "Endabnahme is not editable");
  assert.throws(() => contentStepSpec(CONTENT_STEP_WATERMARK, context({}, { stepPrompts: allOwn })), /Grok/, "Watermark Entfernung stays on the Grok rephrase prompt");
  assert.throws(() => contentStepSpec(CONTENT_STEP_AKTUALITAET, context()), /zwei Aufrufen mit Websuche/, "the Aktualitätsprüfung has no single tool spec");
}
console.log("step prompts: ok");

// --- who may change the Seitentyp ---------------------------------------------------------------

const excelPage: ContentPageRow = {
  id: "p1", organisation_id: "o1", slug: "privatumzug", name: "Privatumzug", path: "/privatumzug", level: 1, position: 1, source: "structure", source_url: null, crawled_at: null,
  main_keyword: null, page_role: "pillar", page_type: "hauptsilo", pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "nicht_begonnen", step: null, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, error: null, job_id: null, cost_eur: 0, started_by: null, created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:00:00Z",
};
const crawlPage: ContentPageRow = { ...excelPage, id: "p2", slug: "dach", source: "crawl", source_url: "https://x.de/dach", page_role: null, page_type: "unterseite" };
assert.equal(contentPageTypeChangeBlocker(excelPage), null, "an Excel page may be changed by hand");
assert.equal(contentPageTypeChangeBlocker({ ...excelPage, page_type: "nicht_bearbeiten" }), null, "nicht_bearbeiten from the Excel can be corrected");
assert.equal(contentPageTypeChangeBlocker({ ...excelPage, state: "fertig" }), null, "also after a run");
assert.equal(contentPageTypeChangeBlocker(crawlPage), null, "a crawl page may be changed");
assert.equal(contentPageTypeChangeBlocker({ ...crawlPage, page_type: "nicht_bearbeiten" }), null, "a wrongly guessed Kontakt can be corrected");
assert.equal(contentPageTypeChangeBlocker({ ...crawlPage, state: "fertig" }), null, "also after a run");
assert.match(contentPageTypeChangeBlocker({ ...excelPage, state: "laeuft" })?.message ?? "", /läuft gerade/, "not while an Excel page runs");
assert.match(contentPageTypeChangeBlocker({ ...crawlPage, state: "laeuft" })?.message ?? "", /läuft gerade/, "not while it runs");
assert.equal(canEditContentPageType(excelPage), true);
assert.equal(canEditContentPageType(crawlPage), true);
assert.equal(pageBriefing(excelPage).type_editable, true, "the drawer shows the select for Excel pages");
assert.equal(pageBriefing(crawlPage).type_editable, true, "the drawer shows the select for crawl pages");
assert.equal(pageSummary(crawlPage).type_editable, true, "a crawl page: select in the table");
assert.equal(pageSummary(excelPage).type_editable, true, "a page from the Seitenstruktur: select in the table");
assert.equal(pageSummary({ ...crawlPage, page_role: "supporting" }).type_editable, true, "a crawl page matched to an Excel row stays editable");
assert.equal(pageSummary({ ...crawlPage, page_type: null }).type_editable, true, "also before a type is set");
console.log("seitentyp editable: ok");

const geo = contentStepSpec(4, context());
assert.match(geo.system, /GEO/);
assert.match(geo.system, /Zuletzt aktualisiert: \[DATUM\]/);
assert.match(geo.system, /QUELLE BITTE ERGÄNZEN/);
assert.match(geo.system, /120–180 Wörter/);
const hormozi = contentStepSpec(CONTENT_STEP_HORMOZI, context());
assert.match(hormozi.system, /Hero/);
assert.match(hormozi.system, /Value Equation/);
assert.match(hormozi.system, /H1 bleibt unverändert/);
assert.match(contentStepSpec(CONTENT_STEP_HORMOZI, context({ page_type: "ratgeber" })).system, /Kein harter Verkauf/);
assert.match(hormozi.system, /^Schritt 6 Hormozi/);
const vermenschlichung = contentStepSpec(CONTENT_STEP_VERMENSCHLICHUNG, context());
assert.match(vermenschlichung.system, /Floskeln/);
assert.match(vermenschlichung.system, /In der heutigen schnelllebigen Zeit/);
assert.match(vermenschlichung.system, /höchstens 3 im ganzen Text/);
assert.match(vermenschlichung.system, /self_score/);
assert.ok(vermenschlichung.retryHint && vermenschlichung.score, "the Vermenschlichung may try once more");
assert.match(contentStepSpec(CONTENT_STEP_LEKTORAT, context()).system, /^Schritt 8 Lektorat/);
assert.throws(() => contentStepSpec(CONTENT_STEP_WATERMARK, context()), /Grok/, "Watermark Entfernung has no tool spec");
assert.match(contentStepSpec(CONTENT_STEP_ENDABNAHME, context()).system, /Endabnahme/);
for (const step of [CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_LEKTORAT, CONTENT_STEP_ENDABNAHME]) {
  assert.match(contentStepSpec(step, context()).user, /Avatar \(Wunschkunde/, `step ${step} still gets the avatar`);
  assert.match(contentStepSpec(step, context()).user, /Anbieterfakten/, `step ${step} still gets the facts`);
}
assert.match(contentStepSpec(CONTENT_STEP_ENDABNAHME, context()).system, /Schritt 10 Endabnahme/);
assert.match(contentStepSpec(CONTENT_STEP_ENDABNAHME, context()).system, new RegExp(CONTENT_HERO_PLACEHOLDER_LEGACY.replace(/[[\]]/g, "\\$&")), "the Endabnahme still knows the old hero placeholder");
assert.match(contentStepSpec(CONTENT_STEP_SEO, context()).system, /Schritt 6 \(Hormozi\) füllt ihn/, "the SEO default names Hormozi's new number");
assert.match(contentStepSpec(CONTENT_STEP_FAKTENCHECK, context()).system, new RegExp(CONTENT_HERO_PLACEHOLDER_LEGACY.replace(/[[\]]/g, "\\$&")), "the Faktencheck accepts both hero placeholders");
assert.throws(() => contentStepSpec(11, context()), /Unbekannter Schritt/);
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
assert.match(String(seoPatch.pagePatch.html), /data-block-id="hero"><h2>\[HERO – wird von Hormozi gefuellt\]<\/h2>/, "the new placeholder names the step, not its number");
assert.doesNotMatch(CONTENT_HERO_PLACEHOLDER, /\d/);
assert.equal(seoPatch.halted, false);

const kept = keepHeroBlock([h1, body], seoBlocks);
assert.equal(kept[1]?.id, "hero", "a later step that drops the hero gets it back");
assert.equal(kept[1]?.heading, CONTENT_HERO_PLACEHOLDER);
const filled = settleHeroSentence([h1, { id: "hero", heading: "Entspannt umziehen, ohne Chaos.", level: 2, html: "" }, body]);
assert.deepEqual([filled[1]?.heading, filled[1]?.html], [null, "<p><strong>Entspannt umziehen, ohne Chaos.</strong></p>"], "Hormozi's hero is a sentence, not an H2");
const hormoziOut = contentStepSpec(CONTENT_STEP_HORMOZI, context({}, { blocks: seoBlocks })).normalize({ title: "", meta_description: "", blocks: [h1, { id: "hero", heading: "", level: 2, html: "<p>Ihr Umzug ohne Stress.</p>" }, body] }, context({}, { blocks: seoBlocks })) as TextOutput;
assert.equal(hormoziOut.blocks[1]?.html, "<p>Ihr Umzug ohne Stress.</p>");
assert.deepEqual(parseBlocksFromHtml(String(stepPatchFor(contentStepDefinition(CONTENT_STEP_HORMOZI)!, hormoziOut).pagePatch.html)).map((b) => b.id), ["intro", "hero", "ablauf"]);
// A page written before the renumbering still carries the old placeholder: Hormozi fills it all the same.
const legacyHero = [h1, { id: "hero", heading: CONTENT_HERO_PLACEHOLDER_LEGACY, level: 2 as const, html: "" }, body];
const fromLegacy = contentStepSpec(CONTENT_STEP_HORMOZI, context({}, { blocks: legacyHero })).normalize({ title: "", meta_description: "", blocks: [h1, { id: "hero", heading: "Entspannt umziehen.", level: 2, html: "" }, body] }, context({}, { blocks: legacyHero })) as TextOutput;
assert.deepEqual([fromLegacy.blocks[1]?.heading, fromLegacy.blocks[1]?.html], [null, "<p><strong>Entspannt umziehen.</strong></p>"]);
assert.equal(keepHeroBlock([h1, body], legacyHero)[1]?.heading, CONTENT_HERO_PLACEHOLDER_LEGACY, "a dropped legacy hero comes back unchanged");
console.log("hero: ok");

// --- halting rules ------------------------------------------------------------------------------

const blocking: FaktencheckOutput = {
  findings: [],
  questions: [{ kind: "fact", question: "Stimmt der Festpreis?", blocking: true }],
};
const halt = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, blocking);
assert.deepEqual([halt.halted, halt.stepStatus, halt.pagePatch.state, halt.pagePatch.job_id], [true, "waiting", "braucht_sie", null], "blocking questions stop the page for the customer");
const soft = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [{ kind: "fact", question: "Egal", blocking: false }] });
assert.deepEqual([soft.halted, soft.stepStatus, soft.pagePatch.state], [true, "waiting", "braucht_sie"], "a non-blocking question stops the page too");
const clean = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [] }, { html: renderBlocksHtml(seoBlocks) });
assert.deepEqual([clean.halted, clean.stepStatus, clean.pagePatch.state, clean.pagePatch.questions], [false, "done", undefined, []], "no question, no placeholder: the page goes on");
const release = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, { unresolved: [], summary: "ok" });
assert.deepEqual([release.halted, release.pagePatch.state, release.pagePatch.released], [true, "fertig", false]);
const geoPatch = stepPatchFor(contentStepDefinition(4)!, { blocks: seoBlocks, title: "T", meta_description: "M" });
assert.deepEqual(geoPatch.pagePatch.findings, [], "the rewrite after the Faktencheck settles its findings");
assert.throws(() => stepPatchFor(contentStepDefinition(4)!, { blocks: [], title: null, meta_description: null }), /keinen Text/);
const vermenschlichungSpec = contentStepSpec(CONTENT_STEP_VERMENSCHLICHUNG, context({}, { blocks: seoBlocks }));
const weak = vermenschlichungSpec.normalize({ title: "", meta_description: "", blocks: seoBlocks, self_score: { direktheit: 5, rhythmus: 6, vertrauen: 7, natuerlichkeit: 6, dichte: 6 } }, context({}, { blocks: seoBlocks })) as VermenschlichungOutput;
assert.match(vermenschlichungSpec.retryHint!(weak) ?? "", /30 von 50/, "a weak self-score asks for one more attempt");
const strong = vermenschlichungSpec.normalize({ title: "", meta_description: "", blocks: seoBlocks, self_score: { direktheit: 8, rhythmus: 8, vertrauen: 7, natuerlichkeit: 8, dichte: 7 } }, context({}, { blocks: seoBlocks })) as VermenschlichungOutput;
assert.equal(vermenschlichungSpec.retryHint!(strong), null);
assert.ok(vermenschlichungSpec.score!(strong) > vermenschlichungSpec.score!(weak));
console.log("halting rules: ok");

// --- missing data stops the page as „Braucht Sie“ ------------------------------------------------

{
  const gapHtml = renderBlocksHtml([
    { id: "intro", heading: "Privatumzug Köln", level: 1, html: "" },
    { id: "hero", heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" },
    { id: "kosten", heading: "Was kostet ein Privatumzug?", level: 2, html: "<p>Steiner Umzüge arbeitet mit Festpreisen. Eine 3-Zimmer-Wohnung kostet [BITTE PRÜFEN: Festpreis für 3 Zimmer]. Die Besichtigung ist kostenlos.</p>" },
    { id: "ablauf", heading: "Wie läuft der Umzug ab?", level: 2, html: "<p>Mehr dazu unter [LINK: Seniorenumzug].</p>" },
    { id: "stand", heading: null, level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
  ]);
  const gaps = findContentGapsInHtml(gapHtml);
  assert.deepEqual(
    gaps.map((g) => [g.block_id, g.section, g.placeholder, g.question, g.excerpt]),
    [[
      "kosten",
      "Was kostet ein Privatumzug?",
      "[BITTE PRÜFEN: Festpreis für 3 Zimmer]",
      "Festpreis für 3 Zimmer – was soll hier stehen?",
      "Eine 3-Zimmer-Wohnung kostet [BITTE PRÜFEN: Festpreis für 3 Zimmer].",
    ]],
    "a [BITTE PRÜFEN: …] is a gap, named by its Abschnitt, with its sentence",
  );
  assert.equal(hasContentGap("[LINK: Seniorenumzug] [DATUM] [FOTO: Team] " + CONTENT_HERO_PLACEHOLDER), false, "wanted markers are no gap");
  assert.equal(hasContentGap(CONTENT_HERO_PLACEHOLDER_LEGACY), false, "the old hero placeholder is no gap either");
  assert.equal(hasContentGap("Quelle: [QUELLE BITTE ERGÄNZEN]"), true);
  assert.equal(hasContentGap("Preis: [PREIS BITTE PRÜFEN UND ANPASSEN: ab 99 €]"), true);
  assert.equal(hasContentGap("[bitte prüfen: Gründungsjahr]"), true, "spelling does not matter");
  assert.equal(gapQuestion("[QUELLE BITTE ERGÄNZEN]"), "Welche Quelle belegt diese Aussage?");
  assert.equal(gapQuestion("[PREIS BITTE PRÜFEN UND ANPASSEN…]"), "Welcher Preis gilt hier?");
  assert.equal(gapQuestion("[BITTE PRÜFEN: Stimmt die Zahl 1.800?]"), "Stimmt die Zahl 1.800?");

  // After a text step: a placeholder stops the page and names the block.
  const seoWithGap = { blocks: parseBlocksFromHtml(gapHtml), title: "T", meta_description: "M" };
  const halted = stepPatchFor(contentStepDefinition(2)!, seoWithGap);
  assert.deepEqual([halted.halted, halted.stepStatus, halted.pagePatch.state, halted.pagePatch.job_id], [true, "waiting", "braucht_sie", null]);
  assert.deepEqual(
    halted.pagePatch.questions,
    [{
      kind: "missing",
      question: "Festpreis für 3 Zimmer – was soll hier stehen?",
      field: null,
      placeholder: "[BITTE PRÜFEN: Festpreis für 3 Zimmer]",
      block_id: "kosten",
      section: "Was kostet ein Privatumzug?",
      excerpt: "Eine 3-Zimmer-Wohnung kostet [BITTE PRÜFEN: Festpreis für 3 Zimmer].",
      blocking: true,
    }],
  );
  assert.equal(halted.pagePatch.html, gapHtml, "the text is saved as it is: the placeholder stays");
  for (const step of [CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT]) {
    const out = step === CONTENT_STEP_LEKTORAT ? { ...seoWithGap, final_findings: [] } : seoWithGap;
    assert.equal(stepPatchFor(contentStepDefinition(step)!, out).halted, true, `step ${step} stops for the placeholder`);
  }
  const aktualitaetWithGap = { ...seoWithGap, checked: [], updates: [], questions: [], outdated_sections: [], findings: [], research: { searches: 1, fetches: 0, sources: 1, claims: 1, search_limit_hit: false } };
  assert.equal(stepPatchFor(contentStepDefinition(CONTENT_STEP_AKTUALITAET)!, aktualitaetWithGap).halted, true, "the Aktualitätsprüfung is gap-checked too");
  assert.equal(stepPatchFor(contentStepDefinition(CONTENT_STEP_WATERMARK)!, seoWithGap).halted, false, "Watermark Entfernung goes on; the Endabnahme right after it checks");

  // [LINK: …], [DATUM] and the hero placeholder do not stop anything.
  const markersOnly = parseBlocksFromHtml(gapHtml).filter((b) => b.id !== "kosten");
  const goesOn = stepPatchFor(contentStepDefinition(2)!, { blocks: markersOnly, title: "T", meta_description: "M" });
  assert.deepEqual([goesOn.halted, goesOn.stepStatus, goesOn.pagePatch.state, goesOn.pagePatch.questions], [false, "done", undefined, []]);

  // Faktencheck: every question stops the page, also a non-blocking one, each with its Abschnitt;
  // its own question for a placeholder is not listed twice.
  const fakten = stepPatchFor(
    contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!,
    {
      findings: [],
      questions: [
        { kind: "fact", question: "Bieten Sie Einlagerung an?", block_id: "ablauf", excerpt: "Mehr dazu", blocking: false },
        { kind: "missing", question: "Wie hoch ist der Festpreis für 3 Zimmer?", placeholder: "[BITTE PRÜFEN: Festpreis für 3 Zimmer]", block_id: "kosten", blocking: true },
      ],
    },
    { html: gapHtml },
  );
  assert.equal(fakten.halted, true);
  assert.deepEqual(
    (fakten.pagePatch.questions as Array<{ block_id: string; section: string; blocking: boolean }>).map((q) => [q.block_id, q.section, q.blocking]),
    [["ablauf", "Wie läuft der Umzug ab?", true], ["kosten", "Was kostet ein Privatumzug?", true]],
  );
  const placeholderOnly = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [] }, { html: gapHtml });
  assert.equal(placeholderOnly.halted, true, "a placeholder the Faktencheck did not ask about still stops the page");
  const unlocated = contentGapQuestions(parseBlocksFromHtml(gapHtml), [{ kind: "missing", question: "Festpreis für 3 Zimmer?", blocking: true }]);
  assert.deepEqual(unlocated.map((q) => [q.block_id, q.section]), [["kosten", "Was kostet ein Privatumzug?"]], "a question without block gets the placeholder's Abschnitt");

  // Endabnahme: never „fertig“ while a placeholder is left.
  const endGap = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, { unresolved: [], summary: "ok" }, { html: gapHtml });
  assert.deepEqual([endGap.halted, endGap.pagePatch.state, endGap.pagePatch.released, (endGap.pagePatch.questions as unknown[]).length], [true, "braucht_sie", false, 1]);
  const endClean = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, { unresolved: [], summary: "ok" }, { html: renderBlocksHtml(markersOnly) });
  assert.deepEqual([endClean.pagePatch.state, endClean.pagePatch.questions], ["fertig", []]);

  // Table detail and actions name the Abschnitt and the step the page waits at.
  const q = (section: string) => ({ kind: "missing", question: "?", block_id: section.toLowerCase(), section, blocking: true });
  assert.equal(questionsDetail([q("Kosten")]), "Abschnitt „Kosten“ braucht eine Angabe");
  assert.equal(questionsDetail([q("Kosten"), q("Kosten"), q("Ablauf"), q("Garantie")]), "3 Abschnitte brauchen eine Angabe: Kosten, Ablauf, Garantie");
  assert.equal(questionsDetail([q("Kosten"), q("Ablauf"), q("Garantie"), q("Team"), q("Kontakt")]), "5 Abschnitte brauchen eine Angabe: Kosten, Ablauf, Garantie +2 weitere");
  assert.equal(questionsDetail([{ kind: "missing", question: "?", block_id: "kosten", blocking: true }]), "Abschnitt „kosten“ braucht eine Angabe", "without a heading: the block id");
  const waitingPage: ContentPageRow = { ...excelPage, state: "braucht_sie", step: 5, html: gapHtml, questions: halted.pagePatch.questions as ContentPageRow["questions"] };
  assert.equal(pageDetail(waitingPage), "Abschnitt „Was kostet ein Privatumzug?“ braucht eine Angabe");
  assert.deepEqual(pageActions(waitingPage).filter((a) => a.step != null).map((a) => [a.kind, a.step]), [["approve", 5], ["edit", 5], ["rerun_with_note", 5]]);
  assert.equal(rerunStepFor({ ...waitingPage, step: CONTENT_STEP_ENDABNAHME }), CONTENT_STEP_LEKTORAT, "after the Endabnahme a rerun starts at the Lektorat");
  assert.deepEqual(pageActions({ ...waitingPage, step: CONTENT_STEP_ENDABNAHME }).find((a) => a.kind === "approve")?.step, CONTENT_STEP_ENDABNAHME);

  // „Freigeben“ asks first while questions or open points are listed.
  assert.equal(approveNeedsConfirm({ questions: [q("Kosten")], findings: [] }), true);
  assert.equal(approveNeedsConfirm({ questions: [], findings: [{ title: "x" }] }), true);
  assert.equal(approveNeedsConfirm({ questions: [], findings: [] }), false);
}
console.log("gaps stop the page: ok");

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

// --- Watermark Entfernung: every sentence rephrased on Grok, in chunks, nothing else -------------

const questionBlock = { id: "kosten", heading: "Was kostet ein Privatumzug?", level: 2 as const, html: "<p>Der Preis hängt vom Umfang ab und richtet sich nach Volumen und Weg. [BITTE PRÜFEN: Preisbeispiel]</p>" };
const heroSentence = { id: "hero", heading: null, level: 2 as const, html: "<p><strong>Ihr Umzug ohne Stress.</strong></p>" };
const longBody = { ...body, html: `<p>${"So läuft der Umzug ab, Schritt für Schritt und ohne Überraschungen. ".repeat(12)}[LINK: Seniorenumzug]</p>` };
const stand = { id: "stand", heading: null, level: 2 as const, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" };
const beforeRephrase = [h1, heroSentence, questionBlock, longBody, stand];
const rephraseContext = context({}, { blocks: beforeRephrase, title: "Privatumzug Köln | Steiner", metaDescription: "Meta." });

assert.throws(() => contentStepSpec(CONTENT_STEP_WATERMARK, rephraseContext), /Grok/, "the Watermark step is not a tool-forced spec");
assert.equal(contentStepDefinition(CONTENT_STEP_WATERMARK)?.provider, "xai", "the Watermark step runs on Grok");
assert.equal(CONTENT_STEPS.filter((s) => s.provider === "xai").length, 1, "no other step runs on Grok");

const chunks = planRephraseChunks(beforeRephrase);
assert.deepEqual(chunks.map((c) => c.map((b) => b.id)), [["kosten", "ablauf"]], "the H1, the hero sentence and the date line are not worth a call");
assert.deepEqual(planRephraseChunks(beforeRephrase, { kosten: "<p>schon neu</p>" }).map((c) => c.map((b) => b.id)), [["ablauf"]], "a resumed run skips what is done");
const many = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, heading: `Frage ${i}?`, level: 2 as const, html: `<p>${"Text ".repeat(120)}</p>` }));
const manyChunks = planRephraseChunks(many);
assert.ok(manyChunks.length >= 3 && manyChunks.every((c) => c.length <= 4), "long pages are split into several small calls");
assert.deepEqual(manyChunks.flat().map((b) => b.id), many.map((b) => b.id), "every block exactly once, in order");

const prompt8 = rephraseChunkPrompt(rephraseContext, chunks[0]!);
const sentToGrok = `${prompt8.system}\n${prompt8.user}`;
assert.doesNotMatch(sentToGrok, /watermark|wasserzeichen|detector|detektor|EU AI Act|undetectable|hide AI/i, "the model never sees the step's name or purpose");
assert.match(prompt8.system, /Schreibe jeden Satz neu/);
assert.match(prompt8.system, /Kopiere keinen Satz wörtlich/);
assert.match(prompt8.system, /\[LINK: …\]/);
assert.match(prompt8.system, /\[BITTE PRÜFEN: …\]/);
assert.match(prompt8.system, /\[DATUM\]/);
assert.match(prompt8.system, /Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten weiter/);
assert.match(prompt8.user, /<section data-block-id="kosten"><h2>Was kostet ein Privatumzug\?<\/h2>/, "the chunk goes in as the stored section HTML");
assert.match(prompt8.user, /Verbotene Wörter.*„billig“/);
assert.match(prompt8.user, /Anmerkungen der Redaktion/);
assert.doesNotMatch(prompt8.user, /Anbieterfakten aus Fragebogen/, "the facts are not sent; they must not change anyway");
assert.doesNotMatch(prompt8.user, /data-block-id="hero"/, "only the chunk's sections are sent");
assert.ok(rephraseChunkMaxTokens(chunks[0]!) >= 1_000);

const grokAnswer = `Gerne:\n\`\`\`html\n<section data-block-id="kosten"><h2>Was kostet ein Privatumzug</h2>\n<p>Was ein Privatumzug kostet, richtet sich nach Volumen und Weg. [BITTE PRÜFEN: Preisbeispiel]</p><script>alert(1)</script></section>\n<section data-block-id="ablauf"><h3>Anders</h3>\n<p>Schritt für Schritt, ohne Überraschungen. [LINK: Seniorenumzug]</p></section>\n\`\`\``;
const parsed = parseRephrasedChunk(grokAnswer, chunks[0]!);
assert.deepEqual(
  parsed.map((b) => [b.id, b.heading, b.level, b.html]),
  [
    ["kosten", "Was kostet ein Privatumzug?", 2, "<p>Was ein Privatumzug kostet, richtet sich nach Volumen und Weg. [BITTE PRÜFEN: Preisbeispiel]</p>"],
    ["ablauf", "Wie läuft der Umzug ab?", 2, "<p>Schritt für Schritt, ohne Überraschungen. [LINK: Seniorenumzug]</p>"],
  ],
  "ids, headings and levels stay, a question stays a question, scripts and fences go, only the body is new",
);
assert.equal(parseRephrasedChunk('<section data-block-id="ablauf"><p>Nur einer.</p></section>', chunks[0]!)[0]?.html, questionBlock.html, "a section the answer lost keeps its text");
assert.equal(parseRephrasedChunk("<p>Nur der Text, ohne section.</p>", [questionBlock])[0]?.html, "<p>Nur der Text, ohne section.</p>", "a single block may come back as bare paragraphs");
assert.equal(parseRephrasedChunk("Ich kann dabei nicht helfen.", [questionBlock])[0]?.html, questionBlock.html, "prose without HTML changes nothing");

const merged = mergeRewrittenBlocks(beforeRephrase, [
  { id: "intro", heading: "Umzug Köln neu", level: 2, html: "" },
  { id: "hero", heading: "", level: 2, html: "<p><strong>Entspannt umziehen.</strong></p>" },
  { id: "kosten-neu", heading: "Was kostet ein Privatumzug", level: 3, html: "<p>Neu.</p>" },
  { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>Neu 2.</p>" },
  { id: "stand", heading: "", level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
]);
assert.deepEqual(merged.map((b) => [b.id, b.heading, b.level, b.html]), [
  ["intro", "Privatumzug Köln", 1, ""],
  ["hero", null, 2, "<p><strong>Entspannt umziehen.</strong></p>"],
  ["kosten", "Was kostet ein Privatumzug?", 2, "<p>Neu.</p>"],
  ["ablauf", "Wie läuft der Umzug ab?", 2, "<p>Neu 2.</p>"],
  ["stand", null, 2, "<p>Zuletzt aktualisiert: [DATUM]</p>"],
]);

const progress = readRephraseProgress({ version: 1, rewritten: { kosten: "<p>Neu.</p>", leer: "  " }, calls: "2", input_tokens: 300, output_tokens: 120, cost_eur: 0.01, models: ["grok-4.7"] }, 2);
assert.deepEqual(progress, { version: 1, rewritten: { kosten: "<p>Neu.</p>" }, total: 2, calls: 2, input_tokens: 300, output_tokens: 120, cost_eur: 0.01, models: ["grok-4.7"], slow_models: [] });
assert.deepEqual(readRephraseProgress({ something: "else" }, 3), emptyRephraseProgress(3), "an old or odd output counts as nothing done");
assert.equal(rephraseProgressLabel(progress), "1 von 2 Abschnitten");
assert.equal(rephraseProgressLabel({ findings: [] }), null);
const finished = rephrasedBlocks(beforeRephrase, { kosten: "<p>Neu.</p>", ablauf: "<p>Neu 2.</p>" });
assert.deepEqual(finished.map((b) => b.html), ["", heroSentence.html, "<p>Neu.</p>", "<p>Neu 2.</p>", stand.html]);
const patch8 = stepPatchFor(contentStepDefinition(CONTENT_STEP_WATERMARK)!, { blocks: finished, title: "T", meta_description: "M" });
assert.match(String(patch8.pagePatch.html), /Was kostet ein Privatumzug\?/);
assert.deepEqual([patch8.halted, patch8.pagePatch.findings], [false, undefined], "the open points of the Aktualitätsprüfung stay on the page until the Endabnahme");
assert.equal(
  describeRunningPage({ step: CONTENT_STEP_WATERMARK, error: null }, [{ step: CONTENT_STEP_LEKTORAT, status: "done" }, { step: CONTENT_STEP_WATERMARK, status: "running", output: progress }], { kind: "running" }),
  "Schritt 9 von 10: Watermark Entfernung läuft (1 von 2 Abschnitten)",
  "the status line shows the chunk progress",
);
assert.deepEqual([priceForModel("grok-4.7").inputUsd, priceForModel("grok-4.7").outputUsd, priceForModel("grok-4").inputUsd, priceForModel("grok-4").outputUsd], [2, 6, 3, 15]);
assert.deepEqual([priceForModel("grok-4-1-fast-non-reasoning").inputUsd, priceForModel("grok-4-fast-non-reasoning").outputUsd], [0.2, 0.5]);
assert.equal(estimateCostEur("grok-4.7", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 1), 8);
assert.deepEqual(
  resolveXaiModels({}),
  ["grok-4-1-fast-non-reasoning", "grok-4-fast-non-reasoning", "grok-3", "grok-4.7", "grok-4"],
  "the fast model first, the reasoning models last",
);
assert.deepEqual(resolveXaiModels({}), [DEFAULT_XAI_MODEL, ...XAI_MODEL_FALLBACKS]);
assert.deepEqual(
  resolveXaiModels({ XAI_DT_CONTENT_MODEL: " grok-4 " }),
  ["grok-4", "grok-4-1-fast-non-reasoning", "grok-4-fast-non-reasoning", "grok-3", "grok-4.7"],
  "no duplicate, configured first",
);
assert.deepEqual(resolveXaiModels({ XAI_DT_CONTENT_MODEL: "grok-5" })[0], "grok-5");
assert.deepEqual(rephraseModelOrder(["a", "b", "c"], ["a"]), ["b", "c", "a"], "a slow model goes last");
assert.deepEqual(rephraseModelOrder(["a", "b"], ["a", "b"]), ["a", "b"], "never no candidate");
assert.deepEqual(readRephraseProgress({ version: 1, rewritten: {}, slow_models: ["grok-4", 3] }, 1).slow_models, ["grok-4"]);
console.log("watermark step: ok");

async function runXai() {
  const neverFetch = async (): Promise<Response> => {
    throw new Error("fetch must not be called without a key");
  };
  for (const env of [{}, { ANTHROPIC_DT_CONTENT_API_KEY: "claude-key" }, { XAI_API_KEY: "   " }]) {
    await assert.rejects(
      callXaiText({ system: "s", user: "u", maxTokens: 10, env, fetchImpl: neverFetch }),
      (error: unknown) =>
        error instanceof Error && error.message === XAI_MISSING_KEY_MESSAGE && (error as { retryable?: boolean }).retryable === false,
      "no key → the German error, no network call, no Claude fallback",
    );
  }
  assert.equal(XAI_MISSING_KEY_MESSAGE, "Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt). Bitte die Technik informieren.");

  const seen: Array<{ model: string; auth: string | null; tools: unknown }> = [];
  const stubFetch = async (url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as { model: string; tools?: unknown; messages: Array<{ role: string; content: string }> };
    seen.push({ model: body.model, auth: (init.headers as Record<string, string>).Authorization ?? null, tools: body.tools });
    assert.doesNotMatch(body.messages.map((m) => m.content).join("\n"), /watermark|wasserzeichen|detector/i);
    if (body.model === "grok-4.7") return new Response(JSON.stringify({ error: { message: "The model grok-4.7 does not exist" } }), { status: 404 });
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '<section data-block-id="ablauf"><p>Neu.</p></section>' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
      { status: 200 },
    );
  };
  const reply = await callXaiText({
    system: prompt8.system,
    user: prompt8.user,
    maxTokens: 100,
    env: { XAI_API_KEY: "k", XAI_DT_CONTENT_MODEL: "grok-4.7" },
    fetchImpl: stubFetch,
  });
  assert.deepEqual(seen.map((s) => s.model), ["grok-4.7", "grok-4-1-fast-non-reasoning"], "404 on the configured model → the first fallback");
  assert.ok(seen.every((s) => s.auth === "Bearer k" && s.tools === undefined), "plain chat, no function calling");
  assert.equal(reply.model, "grok-4-1-fast-non-reasoning");
  assert.deepEqual(reply.usage, { inputTokens: 120, outputTokens: 30 });
  assert.equal(parseRephrasedChunk(reply.text, [longBody])[0]?.html, "<p>Neu.</p>");
  seen.length = 0;
  const ordered = await callXaiText({ system: "s", user: "u", maxTokens: 10, env: { XAI_API_KEY: "k" }, fetchImpl: stubFetch, models: ["grok-3", "grok-4.7"] });
  assert.deepEqual([ordered.model, seen.map((s) => s.model)], ["grok-3", ["grok-3"]], "the caller may hand in its own order");

  const slow = async (url: string, init: RequestInit): Promise<Response> =>
    new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  await assert.rejects(
    callXaiText({ system: "s", user: "u", maxTokens: 10, timeoutMs: 20, env: { XAI_API_KEY: "k" }, fetchImpl: slow, models: ["grok-4"] }),
    (error: unknown) =>
      error instanceof XaiTimeoutError && error.model === "grok-4" && error.retryable === true && /Zeitlimit/.test(error.message),
    "a model that does not answer in time is reported with its name",
  );

  const empty = async (): Promise<Response> =>
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "", refusal: "Das kann ich nicht." } }] }), { status: 200 });
  await assert.rejects(
    callXaiText({ system: "s", user: "u", maxTokens: 10, env: { XAI_API_KEY: "k" }, fetchImpl: empty }),
    (error: unknown) =>
      error instanceof Error && /keinen Text/.test(error.message) && /Das kann ich nicht/.test(error.message) && (error as { retryable?: boolean }).retryable === true,
    "an empty answer names what Grok said",
  );
  const rejected = async (): Promise<Response> => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
  await assert.rejects(
    callXaiText({ system: "s", user: "u", maxTokens: 10, env: { XAI_API_KEY: "bad" }, fetchImpl: rejected }),
    (error: unknown) => error instanceof Error && /abgelehnt/.test(error.message) && (error as { retryable?: boolean }).retryable === false,
  );
  const busy = async (): Promise<Response> => new Response("overloaded", { status: 503 });
  await assert.rejects(
    callXaiText({ system: "s", user: "u", maxTokens: 10, env: { XAI_API_KEY: "k" }, fetchImpl: busy }),
    (error: unknown) => error instanceof Error && /ausgelastet/.test(error.message) && (error as { retryable?: boolean }).retryable === true,
  );
  console.log("grok caller: ok");
}

/** `dt_content_type_prompts` before migration 20261017: every column but `hauptseite`. */
async function runTypePromptsWithoutHauptseite() {
  const row = { hauptsilo: "Silo eigen", unterseite: "", ratgeber: "", standort: "", startseite: "Start eigen", ueber_uns: "", updated_at: null, updated_by_email: null };
  let upserted: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () =>
            /\bhauptseite\b/.test(columns)
              ? { data: null, error: { code: "42703", message: "column dt_content_type_prompts.hauptseite does not exist" } }
              : { data: row, error: null },
        }),
      }),
      upsert: async (value: Record<string, unknown>) => {
        upserted = value;
        return { error: { code: "PGRST204", message: "Could not find the 'hauptseite' column of 'dt_content_type_prompts' in the schema cache" } };
      },
    }),
  } as unknown as Parameters<typeof loadContentTypePrompts>[0];

  const state = await loadContentTypePrompts(client);
  assert.equal(state.storage, "missing_hauptseite");
  assert.deepEqual([state.prompts.hauptsilo, state.prompts.startseite], ["Silo eigen", "Start eigen"], "saved recipes are not lost while the column is missing");
  assert.equal(state.prompts.hauptseite, DEFAULT_CONTENT_TYPE_PROMPTS.hauptseite, "the Hauptseite writes with the default");
  const saved = await saveContentTypePrompts(client, { prompts: state.prompts, userId: "u1", userEmail: null });
  assert.deepEqual(saved, { ok: false, error: "Die Datenbank kennt den Seitentyp Hauptseite noch nicht: Bitte database/migrations/20261017_dt_content_hauptseite.sql einmal im Supabase SQL Editor ausführen." });
  assert.ok(upserted && "hauptseite" in upserted, "the save sends the Hauptseite recipe");
  console.log("textvorlagen without hauptseite column: ok");
}

runTypePromptsWithoutHauptseite()
  .then(() => runXai())
  .then(() => console.log("OK: content excel structure tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
