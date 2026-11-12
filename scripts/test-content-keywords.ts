/**
 * Keywords per page: where they come from (Seitenstruktur first, then the Zwilling's suggestion
 * or the editor's entry), that a missing keyword is recognisable, and that a main keyword exists
 * once on the website. No network, no database.
 *
 *   npx tsx scripts/test-content-keywords.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ContentBriefingPage } from "../lib/dt/content/excel-structure";
import { parseContentPagePatch } from "../lib/dt/content/page-patch";
import {
  KEYWORDS_CLASSIFY_SYSTEM,
  applyKeywordRoles,
  keywordsClassifyPrompt,
  keywordsClassifyTool,
  KEYWORDS_SUGGEST_SYSTEM,
  keywordsSuggestPrompt,
  normalizeKeywordsAnswer,
  suggestContentKeywords,
  takenMainKeywords,
} from "../lib/dt/content/pipeline/keywords-suggest";
import { pageBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import {
  cleanKeywordInput,
  contentKeywordOrigin,
  contentKeywordTodo,
  keywordKey,
  mainKeywordTakenBy,
  normalizeKeywords,
  type ContentOutlinePage,
  type ContentPageRow,
} from "../lib/dt/content/store";
import { briefingPatchFor } from "../lib/dt/content/structure-plan";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const ORG = "11111111-1111-4111-8111-111111111111";

function context(keywords: ContentPipelineContext["page"]["keywords"] = null): ContentPipelineContext {
  return {
    organisationName: "Naturheilpraxis Weber",
    page: {
      name: "Akupunktur",
      path: "/akupunktur",
      level: 1,
      source: "crawl",
      page_role: null,
      page_type: "unterseite",
      pillar_name: null,
      estimated_traffic: null,
      keywords,
      h1_options: [],
      user_questions: [],
      ki_prompt: null,
      internal_link_targets: [],
    },
    structureOutline: "",
    existingText: "Akupunktur in unserer Praxis in Köln.",
    sections: [{ key: "leistungen", label: "Leistungen", current: "Akupunktur, Osteopathie." }],
    settings: { anrede: "Sie", branche: "praxis", tonalitaet: "seriös", verbotene_woerter: [] },
    avatar: null,
    typePrompts: DEFAULT_CONTENT_TYPE_PROMPTS,
    notes: [],
    outputs: {},
    blocks: [],
    title: null,
    metaDescription: null,
  } as unknown as ContentPipelineContext;
}

function pageRow(extra: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    id: "p1",
    organisation_id: ORG,
    slug: "akupunktur",
    name: "Akupunktur",
    source: "crawl",
    source_url: "https://example.org/akupunktur",
    main_keyword: null,
    keywords: null,
    cost_eur: "0",
    ...extra,
  } as unknown as ContentPageRow;
}

const OUTLINE: ContentOutlinePage[] = [
  { slug: "start", name: "Startseite", path: "/", level: 0, source: "crawl", page_role: null, page_type: null, pillar_name: null, main_keyword: null, keywords: { main: { text: "Heilpraktiker Köln", volume: 900 }, secondary: [] } },
  { slug: "osteo", name: "Osteopathie", path: "/osteopathie", level: 1, source: "crawl", page_role: null, page_type: null, pillar_name: null, main_keyword: "Osteopathie Köln", keywords: null },
  { slug: "akupunktur", name: "Akupunktur", path: "/akupunktur", level: 1, source: "crawl", page_role: null, page_type: null, pillar_name: null, main_keyword: null, keywords: null },
];

/** A Supabase stand-in whose every call resolves without an error (usage and cost writes). */
function service(): SupabaseClient {
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return () => new Proxy(chain, handler);
    },
  };
  return new Proxy(chain, handler) as unknown as SupabaseClient;
}

function stubTool(answers: unknown[]) {
  const prompts: string[] = [];
  const callTool = (async (input: { user: string }) => {
    prompts.push(input.user);
    return { json: answers[Math.min(prompts.length - 1, answers.length - 1)], usage: { inputTokens: 100, outputTokens: 20 }, model: "claude-haiku-5-5" };
  }) as unknown as NonNullable<Parameters<typeof suggestContentKeywords>[3]>["callTool"];
  return { callTool, prompts };
}

function testOrigin() {
  assert.equal(contentKeywordOrigin({ keywords: null, main_keyword: null }), null, "no keywords: recognisable");
  assert.equal(contentKeywordOrigin({ keywords: null, main_keyword: "  " }), null);
  assert.equal(contentKeywordOrigin({ keywords: null, main_keyword: "Akupunktur Köln" }), "lauf");
  assert.equal(contentKeywordOrigin({ keywords: normalizeKeywords({ main: { text: "A", volume: 10 }, secondary: [] }), main_keyword: "A" }), "struktur");
  assert.equal(normalizeKeywords({ main: { text: "A" }, secondary: [{ text: "B" }], source: "analyse" })?.source, "analyse");
  assert.equal(normalizeKeywords({ main: { text: "A" }, secondary: [], source: "sonstwas" })?.source, undefined, "an unknown source counts as Seitenstruktur");
  assert.equal(normalizeKeywords({ main: { text: "A" }, secondary: [{ text: "B" }], sorted: true })?.sorted, true);
  assert.equal(normalizeKeywords({ main: { text: "A" }, secondary: [], sorted: "ja" })?.sorted, undefined);
  const todo = (keywords: unknown, main_keyword: string | null = null) => contentKeywordTodo({ keywords: normalizeKeywords(keywords), main_keyword });
  assert.equal(todo(null), "suchen", "none: suggest");
  assert.equal(todo(null, "Akupunktur Köln"), "suchen", "a text run's main keyword has no list");
  assert.equal(todo({ main: { text: "A" }, secondary: [{ text: "B" }] }), "einteilen", "a list of the Seitenstruktur: roles open");
  assert.equal(todo({ main: { text: "A" }, secondary: [] }), null, "one keyword: nothing to assign");
  assert.equal(todo({ main: { text: "A" }, secondary: [{ text: "B" }], sorted: true }), null, "assigned: done");
  assert.equal(todo({ main: { text: "A" }, secondary: [{ text: "B" }], source: "manuell" }), null, "by hand: the editor decided");
  console.log("origin: Seitenstruktur, suggestion, by hand, none: ok");
}

function testCleanAndClash() {
  assert.equal(keywordKey("  Heilpraktiker-Köln "), keywordKey("heilpraktiker köln"));
  assert.deepEqual(cleanKeywordInput(" Akupunktur  Köln ", ["akupunktur köln", "TCM Köln", "tcm  köln", " ", "Nadeltherapie"]), {
    main: "Akupunktur Köln",
    secondary: ["TCM Köln", "Nadeltherapie"],
  });
  assert.deepEqual(mainKeywordTakenBy(OUTLINE, "akupunktur", "heilpraktiker KÖLN"), { slug: "start", name: "Startseite" });
  assert.deepEqual(mainKeywordTakenBy(OUTLINE, "akupunktur", "Osteopathie, Köln"), { slug: "osteo", name: "Osteopathie" }, "a run's main keyword counts too");
  assert.equal(mainKeywordTakenBy(OUTLINE, "start", "Heilpraktiker Köln"), null, "a page does not clash with itself");
  assert.equal(mainKeywordTakenBy(OUTLINE, "akupunktur", "Akupunktur Köln"), null);
  assert.deepEqual(takenMainKeywords(OUTLINE, "akupunktur"), [
    { keyword: "Heilpraktiker Köln", page: "Startseite" },
    { keyword: "Osteopathie Köln", page: "Osteopathie" },
  ]);
  console.log("clean input, one main keyword per website: ok");
}

function testStructureFirst() {
  const excel = { page_role: "unterseite", page_type: "unterseite", pillar_name: null, internal_link_targets: [], estimated_traffic: null, h1_options: [], user_questions: [], ki_prompt: null } as unknown as ContentBriefingPage;
  const withKeywords = briefingPatchFor({ ...excel, keywords: { main: { text: "Akupunktur Köln", volume: 320 }, secondary: [] } });
  assert.deepEqual(withKeywords.keywords, { main: { text: "Akupunktur Köln", volume: 320 }, secondary: [] }, "the Seitenstruktur's keywords replace a suggestion");
  assert.equal(withKeywords.main_keyword, "Akupunktur Köln");
  const without = briefingPatchFor({ ...excel, keywords: null });
  assert.ok(!("keywords" in without) && !("main_keyword" in without), "without keywords in the Excel the row's own stay");
  console.log("Seitenstruktur first, the suggestion stays where it has none: ok");
}

function testPrompts() {
  const taken = takenMainKeywords(OUTLINE, "akupunktur");
  const prompt = keywordsSuggestPrompt(context(), { title: "Akupunktur Köln | Praxis Weber", h1: "Akupunktur", meta_description: null }, taken);
  assert.match(prompt, /## Live-Seite heute \(aus dem Crawl\)\nTitle: Akupunktur Köln \| Praxis Weber\nH1: Akupunktur/);
  assert.match(prompt, /## Bereits vergebene Hauptkeywords \(gesperrt\)\n- Heilpraktiker Köln \(Seite: Startseite\)\n- Osteopathie Köln \(Seite: Osteopathie\)/);
  assert.match(prompt, /## Anbieterfakten/);
  assert.match(keywordsSuggestPrompt(context(), null, taken, "Heilpraktiker Köln"), /letzter Vorschlag „Heilpraktiker Köln“ ist bereits vergeben/);
  assert.match(KEYWORDS_SUGGEST_SYSTEM, /Jedes Hauptkeyword gibt es auf der Website nur einmal/);
  assert.match(KEYWORDS_SUGGEST_SYSTEM, /Kein Suchvolumen nennen oder schätzen/);
  assert.match(KEYWORDS_SUGGEST_SYSTEM, /Ausrichtung des Unternehmens laut Anbieterfakten/);
  // The text steps name where set keywords come from.
  assert.match(pageBlock(context({ main: { text: "Akupunktur Köln" }, secondary: [{ text: "TCM Köln" }], source: "analyse" })), /Hauptkeyword aus der Keyword-Analyse \(gesetzt, nicht ersetzen\): Akupunktur Köln\nNebenkeywords aus der Keyword-Analyse: TCM Köln/);
  assert.match(pageBlock(context({ main: { text: "Akupunktur Köln" }, secondary: [], source: "manuell" })), /Hauptkeyword von der Redaktion \(gesetzt, nicht ersetzen\)/);
  assert.match(pageBlock(context({ main: { text: "Akupunktur Köln" }, secondary: [] })), /Hauptkeyword aus der Excel \(gesetzt, nicht ersetzen\)/);
  console.log("prompts: live signals, locked keywords, origin of set keywords: ok");
}

async function testSuggest() {
  const saved: Array<{ main: string; secondary: readonly string[]; source: string }> = [];
  const save = (async (_s: unknown, _p: unknown, input: { main: string; secondary: readonly string[]; source: "analyse" | "manuell" }) => {
    saved.push(input);
    return { ok: true as const, keywords: { main: { text: input.main }, secondary: input.secondary.map((text) => ({ text })), source: input.source } };
  }) as unknown as NonNullable<Parameters<typeof suggestContentKeywords>[3]>["save"];
  const base = { context: context(), outline: OUTLINE, live: null, models: ["claude-haiku-5-5"], save };

  // One keyword of the Seitenstruktur, or an assigned list: nothing to do, no call.
  const none = stubTool([]);
  const fromExcel = pageRow({ keywords: { main: { text: "Akupunktur Köln", volume: 320 }, secondary: [] }, main_keyword: "Akupunktur Köln" });
  const kept = await suggestContentKeywords(service(), fromExcel, null, { ...base, callTool: none.callTool });
  assert.ok(kept.ok && kept.skipped === "vorhanden" && none.prompts.length === 0);
  const sortedList = pageRow({ keywords: { main: { text: "Akupunktur Köln" }, secondary: [{ text: "TCM Köln" }], sorted: true } });
  const keptSorted = await suggestContentKeywords(service(), sortedList, null, { ...base, callTool: none.callTool });
  assert.ok(keptSorted.ok && keptSorted.skipped === "vorhanden" && none.prompts.length === 0);

  // A list of the Seitenstruktur: the Zwilling decides main and secondary, from exactly that list.
  const list = pageRow({
    keywords: { main: { text: "Praxis für Naturheilkunde", volume: 1900 }, secondary: [{ text: "Akupunktur Köln", volume: 320 }, { text: "TCM Köln" }, { text: "Nadeltherapie" }] },
    main_keyword: "Praxis für Naturheilkunde",
  });
  const roles = stubTool([{ main_keyword: "Akupunktur Köln", secondary_keywords: ["TCM Köln", "erfundenes Keyword"], reason: "Die Seite handelt von Akupunktur." }]);
  const sorted = await suggestContentKeywords(service(), list, null, { ...base, callTool: roles.callTool });
  assert.ok(sorted.ok && !sorted.skipped && sorted.reason === "Die Seite handelt von Akupunktur.");
  assert.deepEqual(saved.at(-1), { main: "Akupunktur Köln", secondary: ["TCM Köln", "Praxis für Naturheilkunde", "Nadeltherapie"], source: "struktur" }, "nothing invented, nothing lost, the Excel's first keyword is no placeholder any more");
  assert.match(roles.prompts[0]!, /## Keywords der Seitenstruktur \(zu dieser Seite, Rollen offen\)\n- Praxis für Naturheilkunde \(1900\/Monat\)\n- Akupunktur Köln \(320\/Monat\)/);
  assert.doesNotMatch(roles.prompts[0]!, /gesetzt, nicht ersetzen/, "the placeholder main keyword is not presented as set");
  const forced = await suggestContentKeywords(service(), sortedList, null, { ...base, callTool: roles.callTool, force: true });
  assert.ok(forced.ok && !forced.skipped, "„Neu einteilen“ assigns the roles again from the same list");
  // Every keyword of the list is another page's main keyword: nothing is saved.
  const savedBefore = saved.length;
  const allTaken = pageRow({ keywords: { main: { text: "Heilpraktiker Köln" }, secondary: [{ text: "Osteopathie Köln" }] } });
  const blocked = await suggestContentKeywords(service(), allTaken, null, { ...base, callTool: stubTool([{ main_keyword: "Heilpraktiker Köln", secondary_keywords: ["Osteopathie Köln"], reason: "" }]).callTool });
  assert.ok(!blocked.ok && blocked.status === 422 && /schon Hauptkeyword einer anderen Seite/.test(blocked.message));
  assert.equal(saved.length, savedBefore);
  const byHand = pageRow({ keywords: { main: { text: "Akupunktur Köln" }, secondary: [], source: "manuell" } });
  const keptHand = await suggestContentKeywords(service(), byHand, null, { ...base, callTool: none.callTool });
  assert.ok(keptHand.ok && keptHand.skipped === "vorhanden" && none.prompts.length === 0, "an entry by hand stays unless forced");

  // A page without keywords gets them; a Nebenkeyword that is another page's main keyword is dropped.
  const good = stubTool([{ main_keyword: "Akupunktur Köln", secondary_keywords: ["TCM Köln", "Osteopathie Köln", "Akupunktur Behandlung"], reason: "Passt zur Seite." }]);
  const ok = await suggestContentKeywords(service(), pageRow(), null, { ...base, callTool: good.callTool });
  assert.ok(ok.ok && !ok.skipped && ok.keywords?.source === "analyse" && ok.cost_eur > 0);
  assert.deepEqual(saved.at(-1), { main: "Akupunktur Köln", secondary: ["TCM Köln", "Akupunktur Behandlung"], source: "analyse" });

  // A main keyword another page has: one retry that names it, then the second answer is taken.
  const retry = stubTool([
    { main_keyword: "heilpraktiker köln", secondary_keywords: [], reason: "x" },
    { main_keyword: "Akupunktur Köln", secondary_keywords: [], reason: "y" },
  ]);
  const second = await suggestContentKeywords(service(), pageRow(), null, { ...base, callTool: retry.callTool });
  assert.ok(second.ok && second.keywords?.main.text === "Akupunktur Köln" && retry.prompts.length === 2);
  assert.match(retry.prompts[1]!, /„heilpraktiker köln“ ist bereits vergeben/);

  // Twice the same taken keyword: nothing is saved, the editor decides.
  const before = saved.length;
  const stubborn = stubTool([{ main_keyword: "Heilpraktiker Köln", secondary_keywords: [], reason: "x" }]);
  const clash = await suggestContentKeywords(service(), pageRow(), null, { ...base, callTool: stubborn.callTool });
  assert.ok(!clash.ok && clash.status === 422 && /schon das Hauptkeyword der Seite „Startseite“/.test(clash.message));
  assert.equal(saved.length, before);

  // A page without a search goal gets none.
  const legal = stubTool([{ no_keyword: true, main_keyword: "", secondary_keywords: [], reason: "Impressum ohne Suchziel." }]);
  const noKeyword = await suggestContentKeywords(service(), pageRow({ slug: "impressum", name: "Impressum" }), null, { ...base, callTool: legal.callTool });
  assert.ok(!noKeyword.ok && noKeyword.status === 422 && /Kein Keyword vorgeschlagen: Impressum ohne Suchziel\./.test(noKeyword.message));
  assert.equal(normalizeKeywordsAnswer({ main_keyword: 5 }).no_keyword, true);
  console.log("suggestion: keeps what is set, retries a taken keyword, never saves a duplicate: ok");
}

function testRoles() {
  const list = [{ text: "Praxis für Naturheilkunde", volume: 1900 }, { text: "Akupunktur Köln", volume: 320 }, { text: "TCM Köln" }];
  const taken = [{ keyword: "Praxis für Naturheilkunde", page: "Startseite" }];
  assert.deepEqual(applyKeywordRoles(list, { main_keyword: "akupunktur köln", secondary_keywords: [], reason: "r" }, []), {
    main: "Akupunktur Köln",
    secondary: ["Praxis für Naturheilkunde", "TCM Köln"],
    reason: "r",
  }, "the Excel's spelling, what the model left out stays secondary");
  assert.equal(applyKeywordRoles(list, { main_keyword: "Praxis für Naturheilkunde", secondary_keywords: ["Akupunktur Köln"] }, taken)?.main, "Akupunktur Köln", "a taken main keyword gives way to the next one");
  assert.equal(applyKeywordRoles(list, "kaputt", [])?.main, "Praxis für Naturheilkunde", "an unusable answer keeps the list as it is");
  assert.equal(applyKeywordRoles(list, {}, list.map((k) => ({ keyword: k.text, page: "x" }))), null, "all taken");
  const tool = keywordsClassifyTool(list.map((k) => k.text));
  assert.deepEqual((tool.input_schema.properties as Record<string, { enum?: string[] }>).main_keyword!.enum, list.map((k) => k.text), "only the list is allowed");
  assert.match(KEYWORDS_CLASSIFY_SYSTEM, /Du erfindest kein Keyword und lässt keines weg/);
  assert.match(KEYWORDS_CLASSIFY_SYSTEM, /Die Reihenfolge in der Liste ist keine Vorgabe/);
  assert.match(KEYWORDS_CLASSIFY_SYSTEM, /nicht allein ausschlaggebend/);
  assert.match(keywordsClassifyPrompt(context({ main: { text: "X" }, secondary: [] }), list, null, taken), /Bereits vergebene Hauptkeywords \(gesperrt\)\n- Praxis für Naturheilkunde \(Seite: Startseite\)/);
  console.log("roles: only the list, nothing lost, taken keywords give way: ok");
}

function testPatch() {
  const ok = parseContentPagePatch({ organisationId: ORG, keywords: { main: "Akupunktur Köln", secondary: ["TCM Köln"] } });
  assert.ok(ok.ok && ok.data.keywords?.main === "Akupunktur Köln");
  const clear = parseContentPagePatch({ organisationId: ORG, keywords: { main: "", secondary: [] } });
  assert.ok(clear.ok, "an empty main keyword clears the keywords");
  const bad = parseContentPagePatch({ organisationId: ORG, keywords: { main: "x".repeat(300), secondary: [] } });
  assert.ok(!bad.ok && /Ungültige Keywords/.test(bad.message));
  console.log("page patch: keywords by hand: ok");
}

async function main() {
  testOrigin();
  testCleanAndClash();
  testStructureFirst();
  testPrompts();
  testRoles();
  await testSuggest();
  testPatch();
  console.log("OK: content keywords tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
