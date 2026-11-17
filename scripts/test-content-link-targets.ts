/**
 * Internal link targets of a page the Seitenstruktur gave none: derived from the table of pages.
 *
 *   npx tsx scripts/test-content-link-targets.ts
 */
import assert from "node:assert/strict";

import { DERIVED_LINK_TARGETS_MAX, STANDORT_LINK_TARGETS_MAX, deriveInternalLinkTargets, withStandortLinkTargets } from "../lib/dt/content/link-targets";
import { pageBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

type P = Parameters<typeof deriveInternalLinkTargets>[0];
const page = (slug: string, name: string, path: string | null, extra: Partial<P> = {}): P =>
  ({ slug, name, path, level: path === "/" ? 0 : 1, pillar_name: null, page_role: null, page_type: null, main_keyword: null, keywords: null, ...extra }) as P;

const OUTLINE: P[] = [
  page("start", "Home", "/"),
  page("ankauf", "Ankauf", "/ankauf"),
  page("silber", "Silber Ankauf", "/ankauf/silberankauf", { main_keyword: "Silber verkaufen Düsseldorf" }),
  page("besteck", "Besteck Ankauf", "/ankauf/besteck", { main_keyword: "Silberbesteck verkaufen" }),
  page("uhren", "Uhren Ankauf", "/ankauf/uhren"),
  page("ratgeber", "Ratgeber", "/ratgeber"),
  page("impressum", "Impressum", "/impressum"),
  page("datenschutz", "Datenschutz", "/datenschutz"),
  page("kontakt", "Kontakt", "/kontakt"),
];

function testRanking() {
  const targets = deriveInternalLinkTargets(OUTLINE[2]!, OUTLINE);
  assert.equal(targets[0], "Home", "the Startseite first");
  assert.equal(targets[1], "Ankauf", "then the page above it in the path");
  assert.ok(targets.indexOf("Besteck Ankauf") < targets.indexOf("Ratgeber"), "pages in the same path and with the same topic before others");
  assert.ok(!targets.includes("Silber Ankauf"), "never the page itself");
  assert.ok(!targets.includes("Impressum") && !targets.includes("Datenschutz") && !targets.includes("Kontakt"), "pages that get no text (Impressum, Datenschutz, Kontakt …) are no targets, as with the Seitenstruktur");
  assert.equal(new Set(targets).size, targets.length);
  console.log("ranking: Startseite, parent, same path and topic first; no self, no Impressum: ok");
}

function testSilo() {
  const withSilo: P[] = [
    page("start", "Home", "/"),
    page("hs", "Heilverfahren", "/heilverfahren", { page_role: "pillar" as never }),
    page("a", "Darmsanierung", "/darm", { pillar_name: "Heilverfahren" }),
    page("b", "Entgiftung", "/entgiftung", { pillar_name: "Heilverfahren" }),
    page("c", "Allergien", "/allergien", { pillar_name: "Anderes" }),
  ];
  const targets = deriveInternalLinkTargets(withSilo[2]!, withSilo);
  assert.deepEqual(targets.slice(0, 3), ["Home", "Heilverfahren", "Entgiftung"], "Startseite, its Hauptsilo, then siblings of the same Hauptsilo");
  const forSilo = deriveInternalLinkTargets(withSilo[1]!, withSilo);
  assert.ok(forSilo.indexOf("Darmsanierung") < forSilo.indexOf("Allergien"), "a Hauptsilo links its own Unterseiten first");
  console.log("silo: Hauptsilo, siblings and children rank higher: ok");
}

function testLimitsAndEmpty() {
  const many = Array.from({ length: 40 }, (_, i) => page(`p${i}`, `Seite ${i}`, `/s${i}`));
  assert.equal(deriveInternalLinkTargets(many[0]!, many).length, DERIVED_LINK_TARGETS_MAX, "capped, a text links only where it fits");
  assert.deepEqual(deriveInternalLinkTargets(OUTLINE[0]!, [OUTLINE[0]!]), [], "a lone page has none");
  console.log("limits: capped, empty for a lone page: ok");
}

function testPrompt() {
  const context = (derived: boolean, targets: string[]) =>
    ({
      organisationName: "Praxis",
      page: { name: "Immunsystem", path: "/immunsystem", level: 1, source: "crawl", page_role: null, page_type: "unterseite", pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: targets, internal_link_targets_derived: derived },
      structureOutline: "",
      existingText: null,
      sections: [],
      settings: { anrede: "Sie", branche: "praxis", tonalitaet: "seriös", verbotene_woerter: [] },
      avatar: null,
      typePrompts: DEFAULT_CONTENT_TYPE_PROMPTS,
      notes: [],
      outputs: {},
      blocks: [],
      title: null,
      metaDescription: null,
    }) as unknown as ContentPipelineContext;
  assert.match(pageBlock(context(true, ["Home", "Darmsanierung"])), /Erlaubte interne Linkziele \(aus der Seitenliste der Website abgeleitet, das Beste zuerst; nur diese, als Marker \[LINK: Seitenname\]; setze nur Links, die inhaltlich passen.*\): Home · Darmsanierung/);
  assert.match(pageBlock(context(false, ["Home"])), /Erlaubte interne Linkziele \(nur diese, als Marker \[LINK: Seitenname\]\): Home/, "targets of the Seitenstruktur read as before");
  assert.match(pageBlock(context(false, [])), /Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen/);
  console.log("prompt: derived targets are named as such, the others read as before: ok");
}

/** A „Hauptsilo Standort-Übersicht“ may link every Standortseite of the table. */
function testStandortOverview() {
  const outline: P[] = [
    page("start", "Home", "/"),
    page("standorte", "Standorte", "/standorte", { page_role: "pillar", page_type: "hauptsilo_standort" }),
    page("bonn", "Umzug Bonn", "/standorte/bonn", { level: 2, page_role: "supporting", page_type: "standort", pillar_name: "Standorte" }),
    page("koeln", "Umzug Köln", "/standorte/koeln", { level: 2, page_role: "supporting", page_type: "standort", pillar_name: "Standorte" }),
    // A Standortseite the Seitenstruktur put somewhere else (taken over from the crawl).
    page("neuss", "Entrümpelung Neuss", "/neuss", { page_type: "standort" }),
    page("privat", "Privatumzug", "/privatumzug", { page_role: "pillar", page_type: "hauptsilo" }),
    page("kontakt", "Kontakt", "/kontakt", { page_type: "nicht_bearbeiten" }),
  ];
  const overview = { slug: "standorte", name: "Standorte", page_type: "hauptsilo_standort" as const };
  assert.deepEqual(
    withStandortLinkTargets(overview, ["Umzug Bonn", "Umzug Köln"], outline),
    ["Umzug Bonn", "Umzug Köln", "Entrümpelung Neuss"],
    "every Standortseite of the table, also one outside the silo; none twice",
  );
  assert.deepEqual(withStandortLinkTargets(overview, ["Home", "Privatumzug"], outline), ["Umzug Bonn", "Umzug Köln", "Entrümpelung Neuss", "Home", "Privatumzug"], "the Standortseiten first, the other targets stay");
  assert.deepEqual(withStandortLinkTargets(overview, [], []), [], "no Standortseite in the table: nothing is invented");
  for (const type of ["hauptsilo", "standort", "unterseite", "startseite", null] as const) {
    assert.deepEqual(withStandortLinkTargets({ slug: "privat", name: "Privatumzug", page_type: type }, ["Home"], outline), ["Home"], `${type}: targets unchanged`);
  }
  const many = Array.from({ length: STANDORT_LINK_TARGETS_MAX + 20 }, (_, i) => page(`ort-${i}`, `Ort ${i}`, `/standorte/ort-${i}`, { page_type: "standort" }));
  assert.equal(withStandortLinkTargets(overview, [], many).length, STANDORT_LINK_TARGETS_MAX, "capped");
  console.log("standort overview: every Standortseite is a link target: ok");
}

testRanking();
testStandortOverview();
testSilo();
testLimitsAndEmpty();
testPrompt();
console.log("OK: content link targets tests passed");
