/**
 * Texte step 5 „Aktualitätsprüfung“: the rules the code enforces on the model's answer, the
 * web research it may cite, the one send-back to GEO, the ten-step order, the migration's
 * renumbering and the editable prompt. No network: the research call runs on a stub client.
 * Run: npm run test:content-aktualitaet
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type Anthropic from "@anthropic-ai/sdk";

import {
  EMPTY_CONTENT_FRESHNESS,
  aktualitaetProgressLabel,
  emptyAktualitaetProgress,
  freshnessSectionFindings,
  freshnessSendBackLine,
  readAktualitaetProgress,
  readContentFreshness,
  reviewFreshness,
} from "../lib/dt/content/freshness";
import { freshnessForRerun } from "../lib/dt/content/pipeline/actions";
import {
  AKTUALITAET_RULES,
  AKTUALITAET_TOOL,
  aktualitaetNeedsNoResult,
  aktualitaetResearchPrompt,
  aktualitaetSystemPrompt,
  aktualitaetTextKey,
  aktualitaetWriteSpec,
  customerFactContext,
  customerFactReason,
  inspectResearchBlocks,
  normalizeAktualitaetOutput,
  normalizeSourceUrl,
  parseClaimCount,
  researchFromCall,
  researchProblem,
  unchangedAktualitaetOutput,
  type AktualitaetOutput,
  type ResearchInspection,
} from "../lib/dt/content/pipeline/aktualitaet";
import { callContentResearch, ContentLlmError, researchErrorMessage } from "../lib/dt/content/pipeline/llm";
import {
  BASE_RULES,
  CONTENT_HERO_PLACEHOLDER,
  CONTENT_HERO_PLACEHOLDER_LEGACY,
  brancheRules,
  contentStepSpec,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import { GAP_CHECKED_TEXT_STEPS, planFreshness, stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_COUNT,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_WATERMARK,
  CONTENT_STEPS,
  contentStepDefinition,
  contentStepName,
  hasLegacyContentSteps,
  nextContentStep,
} from "../lib/dt/content/pipeline/steps";
import { estimateWebSearchCostEur } from "../lib/dt/content/pricing";
import { parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { CONTENT_AKTUALITAET_MIGRATION_FILE, contentDbErrorMessage } from "../lib/dt/content/store";
import {
  CONTENT_STEP_PROMPT_KEYS,
  CONTENT_STEP_PROMPT_META,
  DEFAULT_CONTENT_STEP_PROMPTS,
  isContentStepPromptKey,
  normalizeStoredContentStepPrompts,
  resolveContentStepPrompt,
  resolveContentStepPrompts,
} from "../lib/dt/content/step-prompts";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentFreshness, ContentFreshnessSection } from "../lib/dt/content/types";
import { DT_WEB_RESEARCH_INSTRUCTIONS, DT_WEB_SEARCH_MAX_USES, DT_WEB_FETCH_MAX_USES } from "../lib/dt/seo/web-research";

// --- a page after GEO ---------------------------------------------------------------------------

const blocks: ContentTextBlock[] = [
  { id: "intro", heading: "Heizungstausch Köln", level: 1, html: "" },
  { id: "hero", heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" },
  {
    id: "zusammenfassung",
    heading: "Das Wichtigste in Kürze",
    level: 2,
    html: "<p>Seit 2024 gilt das neue Gebäudeenergiegesetz. Die Förderung beträgt bis zu 70 % der Kosten.</p>",
  },
  {
    id: "foerderung",
    heading: "Welche Förderung gibt es für den Heizungstausch?",
    level: 2,
    html: "<p>Die KfW zahlt aktuell <strong>bis zu 21.000 €</strong> Zuschuss. Mehr unter [LINK: Förderung].</p>",
  },
  { id: "preise", heading: "Was kostet der Heizungstausch bei uns?", level: 2, html: "<p>Wir berechnen eine Pauschale von 490 € für die Beratung.</p>" },
  { id: "team", heading: "Unser Team", level: 2, html: "<p>Seit 1998 arbeiten 12 Meister für Steiner Haustechnik. Öffnungszeiten: Mo–Fr 8–17 Uhr.</p>" },
  { id: "stand", heading: null, level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
];

const context = (extra: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Steiner Haustechnik",
  page: {
    name: "Heizungstausch",
    path: "/heizungstausch",
    level: 1,
    url: null,
    source: "structure",
    page_role: "pillar",
    page_type: "hauptsilo",
    pillar_name: null,
    estimated_traffic: null,
    keywords: { main: { text: "Heizungstausch Köln" }, secondary: [{ text: "Gebäudeenergiegesetz" }] },
    h1_options: [],
    user_questions: [],
    ki_prompt: null,
    internal_link_targets: ["Förderung"],
  },
  structureOutline: "",
  existingText: null,
  sections: [
    { key: "unternehmen", label: "Unternehmen", current: "Steiner Haustechnik, gegründet 1998, Beratungspauschale 490 €, Kundenberater Herr Kühn." },
  ],
  settings: { anrede: "Sie", branche: "Sanitär und Heizung", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: { name: "Familie Berg", role: "Eigentümer", beschreibung: "Will die alte Ölheizung loswerden." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: ["Intern: Herr Kühn ist bis Dezember im Urlaub."],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks,
  title: "Heizungstausch Köln 2024 | Steiner",
  metaDescription: "Heizungstausch in Köln mit Förderung.",
  ...extra,
});

const KFW = "https://www.kfw.de/foerderung/heizung/";
const GEG = "https://www.gesetze-im-internet.de/geg/";
const research = {
  sources: [
    { url: KFW, title: "KfW Heizungsförderung" },
    { url: GEG, title: "GEG" },
  ],
  searches: 3,
  fetches: 1,
  claims: 4,
  search_limit_hit: false,
};

const byId = (out: { blocks: readonly ContentTextBlock[] }, id: string) => out.blocks.find((b) => b.id === id)!;
const original = (id: string) => blocks.find((b) => b.id === id)!;

// --- normalisation: the rules in code ----------------------------------------------------------

{
  // The model rewrote several Abschnitte; only one change has a source from the research.
  const modelBlocks = blocks.map((b) => {
    if (b.id === "foerderung") return { ...b, html: "<p>Die KfW zahlt aktuell <strong>bis zu 23.500 €</strong> Zuschuss. Mehr unter [LINK: Förderung].</p>" };
    if (b.id === "zusammenfassung") return { ...b, html: "<p>Ein ganz neuer Text, den niemand bestellt hat.</p>" };
    if (b.id === "intro") return { ...b, heading: "Heizungstausch Köln 2026" };
    if (b.id === "hero") return { ...b, heading: "Ihr Heizungstausch ohne Stress.", html: "" };
    return b;
  });
  const out = normalizeAktualitaetOutput(
    {
      title: "Heizungstausch Köln 2024 | Steiner",
      meta_description: "",
      blocks: modelBlocks,
      checked: [
        { block_id: "foerderung", claim: "bis zu 21.000 €", status: "aktualisiert", source_url: "https://kfw.de/foerderung/heizung" },
        { block_id: "zusammenfassung", claim: "70 %", status: "aktuell", source_url: "https://forum.example/thread/1" },
        { block_id: "nirgends", claim: "x", status: "unsinn", source_url: "" },
      ],
      updates: [
        // Valid: source in the research (spelled without www and trailing slash).
        { block_id: "foerderung", old_text: "bis zu 21.000 €", new_text: "bis zu 23.500 €", reason: "Höchstbetrag 2026", source_url: "https://kfw.de/foerderung/heizung", source_title: "" },
        // No source from the research: rejected, the text stays.
        { block_id: "zusammenfassung", old_text: "bis zu 70 %", new_text: "bis zu 50 %", reason: "neue Sätze", source_url: "https://forum.example/thread/1", source_title: "Forum" },
        // The H1 and the hero are never changed.
        { block_id: "intro", old_text: "Heizungstausch Köln", new_text: "Heizungstausch Köln 2026", reason: "Jahr", source_url: KFW, source_title: "KfW" },
        { block_id: "hero", old_text: "[HERO", new_text: "Ihr Heizungstausch", reason: "x", source_url: KFW, source_title: "KfW" },
      ],
      questions: [],
      outdated_sections: [],
    },
    context(),
    research,
  );

  assert.equal(byId(out, "foerderung").html, "<p>Die KfW zahlt aktuell <strong>bis zu 23.500 €</strong> Zuschuss. Mehr unter [LINK: Förderung].</p>", "a valid update lands in the text");
  assert.deepEqual(
    out.updates.map((u) => [u.block_id, u.old_text, u.new_text, u.source_url, u.source_title, u.section]),
    [["foerderung", "bis zu 21.000 €", "bis zu 23.500 €", KFW, "KfW Heizungsförderung", "Welche Förderung gibt es für den Heizungstausch?"]],
    "the stored source is the research's URL and title",
  );
  assert.deepEqual(byId(out, "zusammenfassung"), original("zusammenfassung"), "an update without an allowed source is undone, and so is the silent rewrite");
  assert.deepEqual(byId(out, "intro"), original("intro"), "the H1 stays");
  assert.deepEqual(byId(out, "hero"), original("hero"), "the hero and its placeholder stay");
  assert.deepEqual(out.blocks.map((b) => b.id), blocks.map((b) => b.id), "ids and order stay");
  for (const id of ["preise", "team", "stand"]) assert.deepEqual(byId(out, id), original(id), `${id}: unlisted Abschnitte come back exactly`);
  const quelle = out.findings.find((f) => f.title === "Quelle fehlt");
  assert.ok(quelle, "the rejected update becomes the open point „Quelle fehlt“");
  assert.equal(quelle?.block_id, "zusammenfassung");
  assert.match(quelle?.problem ?? "", /forum\.example/);
  assert.match(quelle?.proposal ?? "", /bis zu 50 %/);
  assert.equal(out.findings.filter((f) => f.title === "H1 und Hero bleiben unverändert").length, 2);
  assert.equal(out.title, "Heizungstausch Köln 2024 | Steiner", "title unchanged without an update for it");
  assert.equal(out.meta_description, "Heizungstausch in Köln mit Förderung.", "an empty meta description from the model keeps the stored one");
  assert.deepEqual(
    out.checked.map((c) => [c.block_id, c.status, c.source_url]),
    [["foerderung", "aktualisiert", KFW], ["zusammenfassung", "aktuell", null]],
    "only allowed sources survive in checked; unknown statuses are dropped",
  );
  assert.deepEqual(out.questions, []);
}

{
  // Customer facts: price, founding year, team size, opening hours, the company itself.
  const out = normalizeAktualitaetOutput(
    {
      blocks,
      updates: [
        { block_id: "preise", old_text: "490 €", new_text: "590 €", reason: "Preise gestiegen", source_url: KFW, source_title: "KfW" },
        { block_id: "team", old_text: "Seit 1998", new_text: "Seit 1999", reason: "Handelsregister", source_url: GEG, source_title: "GEG" },
        { block_id: "team", old_text: "Mo–Fr 8–17 Uhr", new_text: "Mo–Fr 8–18 Uhr", reason: "Google-Profil", source_url: GEG, source_title: "GEG" },
        { block_id: "zusammenfassung", old_text: "Seit 2024 gilt das neue Gebäudeenergiegesetz", new_text: "Seit 2024 gilt das Gebäudeenergiegesetz, zuletzt geändert 2026", reason: "Novelle", source_url: GEG, source_title: "GEG" },
      ],
      questions: [{ kind: "outdated", question: "Gibt es die Beratungspauschale noch?", block_id: "preise", excerpt: "Wir berechnen eine Pauschale von 490 € für die Beratung.", placeholder: "" }],
    },
    context(),
    research,
  );
  assert.deepEqual(byId(out, "preise"), original("preise"), "a customer price is never changed");
  assert.deepEqual(byId(out, "team"), original("team"), "founding year and opening hours are never changed");
  assert.match(byId(out, "zusammenfassung").html, /zuletzt geändert 2026/, "the public fact next to them is updated");
  assert.deepEqual(out.updates.map((u) => u.block_id), ["zusammenfassung"]);
  assert.deepEqual(
    out.questions.map((q) => [q.kind, q.block_id, q.blocking]),
    [["outdated", "preise", true], ["outdated", "team", true], ["outdated", "team", true]],
    "each blocked change becomes a question for the customer (the model's own question and the code's for the same sentence count once)",
  );
  assert.match(out.questions[1]!.question, /„Seit 1998“.*„Seit 1999“/);
  assert.equal(out.questions[1]!.section, "Unser Team");
  assert.match(out.questions[1]!.excerpt ?? "", /Seit 1998 arbeiten 12 Meister/);

  const facts = customerFactContext(context());
  assert.equal(customerFactReason({ old_text: "21.000 €", new_text: "23.500 €" }, "Die KfW zahlt aktuell bis zu 21.000 € Zuschuss.", facts), null, "a public amount is no customer price");
  assert.equal(customerFactReason({ old_text: "490 €", new_text: "590 €" }, "Wir berechnen eine Pauschale von 490 €.", facts), "Preis des Kunden");
  assert.equal(customerFactReason({ old_text: "Öffnungszeiten: Mo–Fr", new_text: "x" }, "", facts), "Öffnungs- oder Sprechzeiten");
  assert.equal(customerFactReason({ old_text: "unser Meisterbetrieb", new_text: "x" }, "", facts), "Angabe über das Unternehmen");
  assert.equal(customerFactReason({ old_text: "Steiner Haustechnik bietet", new_text: "x" }, "", facts), "Angabe über das Unternehmen");
  assert.equal(customerFactReason({ old_text: "gegründet 1998", new_text: "gegründet 1999" }, "", facts), "Zahl aus den Anbieterfakten");
  assert.equal(customerFactReason({ old_text: "Kundenberater Herr Kühn", new_text: "Frau Lang" }, "", facts), "Text aus den Anbieterfakten");
  assert.equal(customerFactReason({ old_text: "Seit 2024 gilt", new_text: "Seit 2026 gilt" }, "Seit 2024 gilt das GEG.", facts), null);
}

{
  // Fixed markers, keywords and question headings survive; sources never go into the text.
  const out = normalizeAktualitaetOutput(
    {
      blocks,
      updates: [
        { block_id: "foerderung", old_text: "Mehr unter [LINK: Förderung].", new_text: "Mehr bei der KfW.", reason: "x", source_url: KFW, source_title: "KfW" },
        { block_id: "zusammenfassung", old_text: "das neue Gebäudeenergiegesetz", new_text: "das GEG", reason: "Kurzform", source_url: GEG, source_title: "GEG" },
        { block_id: "foerderung", old_text: "Welche Förderung gibt es für den Heizungstausch?", new_text: "Förderung 2026", reason: "x", source_url: KFW, source_title: "KfW" },
        { block_id: "stand", old_text: "[DATUM]", new_text: "27.10.2026", reason: "heute", source_url: KFW, source_title: "KfW" },
      ],
    },
    context(),
    research,
  );
  assert.deepEqual(out.blocks, blocks, "nothing of it reaches the text");
  assert.equal(out.updates.length, 0);
  assert.equal(out.findings.filter((f) => f.title === "Änderung verletzt feste Regeln").length, 4, "link marker, keyword, question heading, [DATUM]");
  assert.ok(out.findings.some((f) => /Keyword „gebäudeenergiegesetz“/.test(f.problem)));

  const withUrl = normalizeAktualitaetOutput(
    { blocks, updates: [{ block_id: "foerderung", old_text: "bis zu 21.000 €", new_text: "bis zu 23.500 € (www.kfw.de)", reason: "x", source_url: KFW, source_title: "KfW" }] },
    context(),
    research,
  );
  assert.deepEqual(withUrl.blocks, blocks);
  assert.equal(withUrl.findings[0]?.title, "Quelle gehört nicht in den Text");

  const notThere = normalizeAktualitaetOutput(
    { blocks, updates: [{ block_id: "foerderung", old_text: "bis zu 25.000 €", new_text: "bis zu 23.500 €", reason: "x", source_url: KFW, source_title: "KfW" }] },
    context(),
    research,
  );
  assert.deepEqual([notThere.blocks, notThere.findings[0]?.title], [blocks, "Textstelle nicht gefunden"], "a passage that is not in the text changes nothing");

  const tooLong = normalizeAktualitaetOutput(
    { blocks, updates: [{ block_id: "zusammenfassung", old_text: "Seit 2024", new_text: "x".repeat(700), reason: "x", source_url: GEG, source_title: "GEG" }] },
    context(),
    research,
  );
  assert.equal(tooLong.findings[0]?.title, "Änderung zu umfangreich");
}

{
  // The passage spans emphasis in the HTML: the model's own block counts, but only when its
  // declared change is its only change.
  const spanning = { block_id: "foerderung", old_text: "zahlt aktuell bis zu 21.000 € Zuschuss", new_text: "zahlt aktuell bis zu 23.500 € Zuschuss", reason: "x", source_url: KFW, source_title: "KfW" };
  const honest = normalizeAktualitaetOutput(
    { blocks: blocks.map((b) => (b.id === "foerderung" ? { ...b, html: "<p>Die KfW zahlt aktuell <strong>bis zu 23.500 €</strong> Zuschuss. Mehr unter [LINK: Förderung].</p>" } : b)), updates: [spanning] },
    context(),
    research,
  );
  assert.match(byId(honest, "foerderung").html, /23\.500 €/, "the model's block is taken when undoing the change gives the stored text back");
  const sneaky = normalizeAktualitaetOutput(
    { blocks: blocks.map((b) => (b.id === "foerderung" ? { ...b, html: "<p>Die KfW zahlt aktuell <strong>bis zu 23.500 €</strong> Zuschuss. Rufen Sie uns sofort an!</p>" } : b)), updates: [spanning] },
    context(),
    research,
  );
  assert.deepEqual(byId(sneaky, "foerderung"), original("foerderung"), "an extra rewrite in the same block undoes the whole block");
  assert.equal(sneaky.findings[0]?.title, "Textstelle nicht gefunden");
}

{
  // Title and meta description change only through an update with a source.
  const out = normalizeAktualitaetOutput(
    { blocks, title: "Ganz anderer Titel", updates: [{ block_id: "title", old_text: "2024", new_text: "2026", reason: "Jahr", source_url: GEG, source_title: "GEG" }] },
    context(),
    research,
  );
  assert.equal(out.title, "Heizungstausch Köln 2026 | Steiner");
  assert.equal(out.updates[0]?.section, "Title-Tag");
}

{
  // Outdated Abschnitte: kept only with a source from the research; the limit is reported.
  const out = normalizeAktualitaetOutput(
    {
      blocks,
      outdated_sections: [
        { block_id: "foerderung", problem: "Das Förderprogramm wurde 2026 umgebaut.", suggestion: "Abschnitt auf die neue Heizungsförderung umstellen.", sources: [{ url: "kfw.de/foerderung/heizung", title: "" }, { url: "https://blog.example/x", title: "Blog" }] },
        { block_id: "zusammenfassung", problem: "Gesetz geändert.", suggestion: "Neu schreiben.", sources: [{ url: "https://blog.example/x", title: "Blog" }] },
      ],
    },
    { ...context() },
    { ...research, search_limit_hit: true },
  );
  assert.deepEqual(
    out.outdated_sections,
    [{ block_id: "foerderung", section: "Welche Förderung gibt es für den Heizungstausch?", problem: "Das Förderprogramm wurde 2026 umgebaut.", suggestion: "Abschnitt auf die neue Heizungsförderung umstellen.", sources: [{ url: KFW, title: "KfW Heizungsförderung" }] }],
    "only allowed sources; a section without one is no send-back",
  );
  assert.deepEqual(out.findings.map((f) => [f.title, f.block_id]), [["Quelle fehlt", "zusammenfassung"], ["Websuche-Limit erreicht", null]]);
  assert.deepEqual(out.blocks, blocks, "outdated sections change nothing in this step");
}

{
  assert.equal(normalizeSourceUrl("https://www.KfW.de/foerderung/heizung/#a"), normalizeSourceUrl("http://kfw.de/foerderung/heizung"));
  assert.notEqual(normalizeSourceUrl("https://kfw.de/a?x=1"), normalizeSourceUrl("https://kfw.de/a?x=2"));
  assert.equal(normalizeSourceUrl("javascript:alert(1)"), null);
  assert.equal(normalizeSourceUrl("kein link"), null);
  assert.equal(normalizeSourceUrl("kfw.de/foerderung/heizung"), normalizeSourceUrl(KFW), "a URL written without its scheme still matches");
}
console.log("normalize: ok");

// --- the research: what may be cited, when it cannot stand ---------------------------------------

{
  const inspection = inspectResearchBlocks([
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Heizungsförderung 2026" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "s1",
      content: [
        { type: "web_search_result", url: KFW, title: "KfW Heizungsförderung", encrypted_content: "x" },
        { type: "web_search_result", url: "https://www.kfw.de/foerderung/heizung", title: null, encrypted_content: "y" },
      ],
    },
    { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: GEG, content: { type: "document", title: "GEG – Gesetz" } } },
    { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    { type: "text", text: "Laut BAFA …", citations: [{ type: "web_search_result_location", url: "https://www.bafa.de/heizung", title: "BAFA", cited_text: "…", encrypted_index: "e" }] },
  ]);
  assert.deepEqual(inspection.sources, [
    { url: KFW, title: "KfW Heizungsförderung" },
    { url: GEG, title: "GEG – Gesetz" },
    { url: "https://www.bafa.de/heizung", title: "BAFA" },
  ], "search results, fetched pages and citations, each URL once");
  assert.deepEqual([inspection.searchResults, inspection.fetchResults, inspection.searchErrors, inspection.searchLimitHit], [2, 1, ["max_uses_exceeded"], true]);

  assert.equal(parseClaimCount("…\nZeitkritische Aussagen: 4"), 4);
  assert.equal(parseClaimCount("**Zeitkritische Aussagen:** 0"), 0);
  assert.equal(parseClaimCount("kein Protokoll"), null);

  const usable = researchFromCall("Zeitkritische Aussagen: 3", inspection, { searches: 2, fetches: 1 });
  assert.equal(researchProblem(usable, inspection), null);
  assert.equal(usable.claims, 3);

  const inspected = (patch: Partial<ResearchInspection>): ResearchInspection => ({
    sources: [],
    searchResults: 0,
    fetchResults: 0,
    searchErrors: [],
    fetchErrors: [],
    searchLimitHit: false,
    ...patch,
  });
  const none = inspected({});
  const nothingFound = researchProblem(researchFromCall("Zeitkritische Aussagen: 3", none, { searches: 0, fetches: 0 }), none);
  assert.ok(nothingFound && nothingFound.retryable, "claims but no source: never „aktuell“, try again");
  assert.match(nothingFound!.message, /als „aktuell“ durchgelassen/);
  assert.ok(researchProblem(researchFromCall("ohne Zählzeile", none, { searches: 0, fetches: 0 }), none), "no claim line and no source: not usable either");
  const failing = inspected({ searchErrors: ["unavailable", "unavailable"] });
  const failed = researchProblem(researchFromCall("Zeitkritische Aussagen: 0", failing, { searches: 2, fetches: 0 }), failing);
  assert.ok(failed?.retryable);
  assert.match(failed!.message, /nur Fehler geliefert \(unavailable\)/);
  const invalid = inspected({ searchErrors: ["invalid_input"] });
  assert.equal(researchProblem(researchFromCall("", invalid, { searches: 1, fetches: 0 }), invalid)?.retryable, false);
  const noClaims = researchFromCall("Der Text enthält keine zeitkritische Aussage.\nZeitkritische Aussagen: 0", none, { searches: 0, fetches: 0 });
  assert.equal(researchProblem(noClaims, none), null, "a text without time-sensitive statements may pass without a search");
  assert.equal(aktualitaetNeedsNoResult(noClaims), true, "… and needs no result call");
  assert.equal(aktualitaetNeedsNoResult(usable), false);
  const unchanged = unchangedAktualitaetOutput(context(), noClaims);
  assert.deepEqual([unchanged.blocks, unchanged.updates, unchanged.research.claims], [blocks, [], 0]);
}
console.log("research: ok");

// --- prompts: research without internals, result with the allowed sources -----------------------

{
  const now = new Date("2026-10-27T10:00:00Z");
  const prompt = aktualitaetResearchPrompt(context(), now);
  assert.match(prompt.user, /## Heute\n27\.10\.2026/);
  assert.match(prompt.user, /\[Abschnitt foerderung\]/);
  assert.match(prompt.user, /Zeitkritische Aussagen: N/);
  assert.doesNotMatch(prompt.user, /Anbieterfakten|Herr Kühn|Urlaub|Familie Berg/, "nothing internal reaches the research call");
  assert.ok(prompt.system.startsWith(DEFAULT_CONTENT_STEP_PROMPTS.aktualitaet.slice(0, 60)), "the editable instruction first");
  for (const part of [BASE_RULES, AKTUALITAET_RULES, DT_WEB_RESEARCH_INSTRUCTIONS]) assert.ok(prompt.system.includes(part));
  assert.ok(prompt.system.endsWith(brancheRules(context().settings)));
  assert.ok(prompt.system.indexOf(AKTUALITAET_RULES) > prompt.system.indexOf(BASE_RULES), "the fixed rules after BASE_RULES, so they can narrow it");
  assert.match(AKTUALITAET_RULES, /Foren, unbekannte Blogs/);
  assert.match(AKTUALITAET_RULES, /Behörden/);

  const spec = aktualitaetWriteSpec(context(), { text: "- [foerderung] „21.000 €“ → veraltet\nZeitkritische Aussagen: 1", ...research }, now);
  assert.equal(spec.tool.name, "submit_aktualitaet");
  assert.equal(spec.tool, AKTUALITAET_TOOL);
  assert.equal(spec.system, prompt.system, "both calls share the system prompt");
  assert.match(spec.user, /## Prüfprotokoll der Websuche[\s\S]*21\.000 €/);
  assert.match(spec.user, /## Erlaubte Quellen[\s\S]*KfW Heizungsförderung – https:\/\/www\.kfw\.de\/foerderung\/heizung\//);
  assert.match(spec.user, /Anbieterfakten/, "the result call knows the customer facts to leave them alone");
  assert.match(spec.user, /keine Websuche/);
  const required = (AKTUALITAET_TOOL.input_schema as { required: string[] }).required;
  assert.deepEqual(required, ["title", "meta_description", "blocks", "checked", "updates", "questions", "outdated_sections"]);
  assert.equal((spec.normalize({ blocks }, context()) as AktualitaetOutput).research.sources, 2, "the spec normalises with its own research");

  assert.notEqual(aktualitaetTextKey(context()), aktualitaetTextKey(context({ blocks: blocks.slice(1) })), "another text, another key");
  assert.equal(aktualitaetTextKey(context()), aktualitaetTextKey(context({ notes: ["anders"] })), "notes do not change the text key");
}
console.log("prompts: ok");

// --- the send-back: once to GEO, then open points ------------------------------------------------

const section: ContentFreshnessSection = {
  block_id: "foerderung",
  section: "Welche Förderung gibt es für den Heizungstausch?",
  problem: "Das Förderprogramm wurde 2026 umgebaut.",
  suggestion: "Abschnitt auf die neue Heizungsförderung umstellen.",
  sources: [{ url: KFW, title: "KfW Heizungsförderung" }],
};
const outputWith = (patch: Partial<AktualitaetOutput>): AktualitaetOutput => ({
  ...unchangedAktualitaetOutput(context(), research),
  ...patch,
});
const def = contentStepDefinition(CONTENT_STEP_AKTUALITAET)!;
const at = new Date("2026-10-27T10:00:00Z");
const update = { block_id: "zusammenfassung", section: "Das Wichtigste in Kürze", old_text: "Seit 2024", new_text: "Seit 2026", reason: "Novelle", source_url: GEG, source_title: "GEG" };
const customerQuestion = { kind: "outdated", question: "Stimmt die Pauschale noch?", block_id: "preise", excerpt: "Wir berechnen eine Pauschale von 490 €.", blocking: true };

{
  assert.ok(GAP_CHECKED_TEXT_STEPS.has(CONTENT_STEP_AKTUALITAET), "the placeholder check runs after the Aktualitätsprüfung");

  // First check: an outdated Abschnitt goes back to GEO; the job goes on, nobody is asked yet.
  const first = stepPatchFor(def, outputWith({ outdated_sections: [section], updates: [update], questions: [customerQuestion] }), { html: renderBlocksHtml(blocks), freshness: {} }, at);
  assert.deepEqual([first.halted, first.stepStatus, first.resetFrom], [false, "done", CONTENT_STEP_GEO], "back to GEO (steps 4 and 5 reset), no halt");
  const fresh1 = first.pagePatch.freshness as ContentFreshness;
  assert.equal(fresh1.sendbacks, 1);
  assert.deepEqual(fresh1.pending_sections, [section]);
  assert.deepEqual(fresh1.sent_back_sections, [section]);
  assert.deepEqual(fresh1.carried_questions.map((q) => q.question), ["Stimmt die Pauschale noch?"], "the customer question waits for the second check");
  assert.deepEqual(fresh1.updates, [{ ...update, at: at.toISOString() }], "valid updates are kept with the time of the check");
  assert.equal(first.pagePatch.state, undefined, "the page keeps running");
  assert.equal(first.pagePatch.questions, undefined);
  assert.equal(first.pagePatch.notes, undefined, "the suggestions never go into the editor's notes");
  assert.ok(String(first.pagePatch.html).includes("data-block-id=\"foerderung\""), "the checked text is saved");

  // GEO gets the block in its user message, not in the notes, and clears it when done.
  const geoSpec = contentStepSpec(CONTENT_STEP_GEO, context({ freshness: fresh1 }));
  assert.match(geoSpec.user, /## Aktualitätsprüfung – bitte umsetzen[\s\S]*Abschnitt „Welche Förderung gibt es für den Heizungstausch\?“ \(id foerderung\)\nProblem: Das Förderprogramm wurde 2026 umgebaut\.\nVorschlag: Abschnitt auf die neue Heizungsförderung umstellen\.\nQuellen: KfW Heizungsförderung – https:\/\/www\.kfw\.de/);
  assert.doesNotMatch(geoSpec.user.split("## Aktualitätsprüfung")[1] ?? "", /## Anmerkungen der Redaktion[\s\S]*Förderprogramm/, "not part of the notes");
  assert.doesNotMatch(contentStepSpec(CONTENT_STEP_GEO, context()).user, /bitte umsetzen/, "nothing waits: no block");
  const geoPatch = stepPatchFor(contentStepDefinition(CONTENT_STEP_GEO)!, { blocks, title: "T", meta_description: "M" }, { html: "", freshness: fresh1 });
  assert.deepEqual((geoPatch.pagePatch.freshness as ContentFreshness).pending_sections, [], "GEO finished: nothing waits");
  assert.equal((geoPatch.pagePatch.freshness as ContentFreshness).sendbacks, 1, "the send-back is used up");
  assert.equal(stepPatchFor(contentStepDefinition(CONTENT_STEP_GEO)!, { blocks, title: "T", meta_description: "M" }, { html: "", freshness: {} }).pagePatch.freshness, undefined);
  const afterGeo = { ...fresh1, pending_sections: [] };

  // Second check, still outdated: open points with proposal and source, the page goes on to the customer question.
  const second = stepPatchFor(def, outputWith({ outdated_sections: [section] }), { html: "", freshness: afterGeo }, at);
  assert.equal(second.resetFrom, undefined, "no second send-back");
  const findings = second.pagePatch.findings as Array<{ title: string; proposal: string; block_id: string | null; severity: string }>;
  assert.deepEqual(findings.map((f) => [f.title, f.block_id, f.severity]), [["Abschnitt veraltet: Welche Förderung gibt es für den Heizungstausch?", "foerderung", "high"]]);
  assert.match(findings[0]!.proposal, /Abschnitt auf die neue Heizungsförderung umstellen\. Quelle: KfW Heizungsförderung \(kfw\.de\): https:\/\/www\.kfw\.de/);
  const fresh2 = second.pagePatch.freshness as ContentFreshness;
  assert.deepEqual([fresh2.sendbacks, fresh2.converted_sections, fresh2.carried_questions], [1, [section], []]);
  assert.deepEqual([second.halted, second.stepStatus, second.pagePatch.state], [true, "waiting", "braucht_sie"], "the carried question stops the page as „Braucht Sie“");
  assert.deepEqual((second.pagePatch.questions as Array<{ block_id: string; section: string }>).map((q) => [q.block_id, q.section]), [["preise", "Was kostet der Heizungstausch bei uns?"]]);

  // Second check, all fine: the page simply goes on.
  const clean = stepPatchFor(def, outputWith({}), { html: "", freshness: { ...afterGeo, carried_questions: [] } }, at);
  assert.deepEqual([clean.halted, clean.resetFrom, clean.pagePatch.findings, clean.pagePatch.questions], [false, undefined, [], []]);

  // Questions on the first check without an outdated Abschnitt stop the page at once.
  const asks = stepPatchFor(def, outputWith({ questions: [customerQuestion] }), { html: "", freshness: {} }, at);
  assert.deepEqual([asks.halted, asks.pagePatch.state, asks.resetFrom], [true, "braucht_sie", undefined]);

  // planFreshness on its own: a carried question whose Abschnitt GEO removed keeps its name, loses its id.
  const plan = planFreshness({ ...afterGeo, carried_questions: [{ ...customerQuestion, section: "Preise" }] }, { ...outputWith({}), blocks: blocks.filter((b) => b.id !== "preise") }, at.toISOString());
  assert.deepEqual(plan.questions.map((q) => [q.block_id, q.section]), [[null, "Preise"]]);
  const dedup = planFreshness(afterGeo, outputWith({ updates: [update] }), at.toISOString());
  assert.equal(dedup.freshness.updates.length, 1, "the same change twice is listed once");

  // Hormozi and later text steps leave the open points of the check on the page.
  for (const step of [CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_WATERMARK]) {
    assert.equal(stepPatchFor(contentStepDefinition(step)!, { blocks, title: "T", meta_description: "M" }).pagePatch.findings, undefined, `step ${step} keeps the open points`);
  }
  // The Endabnahme sees them.
  const endUser = contentStepSpec(CONTENT_STEP_ENDABNAHME, context({ openFindings: freshnessSectionFindings([section]) })).user;
  assert.match(endUser, /## Offene Punkte aus früheren Schritten[\s\S]*Abschnitt veraltet/);

  // „Zurücksetzen“ and „Mit Anmerkung wiederholen“ from GEO or earlier start over; later only a waiting send-back goes.
  assert.deepEqual(freshnessForRerun({ freshness: fresh1 }, CONTENT_STEP_GEO), EMPTY_CONTENT_FRESHNESS);
  assert.deepEqual(freshnessForRerun({ freshness: fresh1 }, 2), EMPTY_CONTENT_FRESHNESS);
  const later = freshnessForRerun({ freshness: fresh1 }, CONTENT_STEP_AKTUALITAET);
  assert.deepEqual([later.sendbacks, later.pending_sections, later.updates.length], [1, [], 1], "a rerun of the check itself gets no second send-back");

  // The drawer line.
  assert.equal(freshnessSendBackLine(reviewFreshness(EMPTY_CONTENT_FRESHNESS)), "Nicht an GEO zurückgegeben.");
  assert.match(freshnessSendBackLine(reviewFreshness(fresh1)), /^An GEO zurückgegeben: 1 Abschnitt wird überarbeitet/);
  assert.equal(freshnessSendBackLine(reviewFreshness(afterGeo)), "Einmal an GEO zurückgegeben (1 veralteter Abschnitt) und danach erneut geprüft.");
  assert.match(freshnessSendBackLine(reviewFreshness(fresh2)), /1 Abschnitt ist weiter veraltet und steht unter „Offene Punkte“\.$/);
  assert.equal("carried_questions" in reviewFreshness(fresh1), false, "the review leaves out the internal question queue");
}
console.log("send-back: ok");

// --- stored state ---------------------------------------------------------------------------------

{
  assert.deepEqual(readContentFreshness(null), EMPTY_CONTENT_FRESHNESS);
  assert.deepEqual(readContentFreshness({}), EMPTY_CONTENT_FRESHNESS, "the column default");
  const odd = readContentFreshness({
    sendbacks: 3,
    updates: [{ block_id: "a", old_text: "x", new_text: "y", source_url: "javascript:alert(1)" }, { block_id: "a", old_text: "x", new_text: "y", source_url: KFW }],
    pending_sections: [{ problem: "p", suggestion: "s", sources: [{ url: "ftp://x" }, { url: GEG, title: "GEG" }] }],
  });
  assert.equal(odd.sendbacks, 1);
  assert.deepEqual(odd.updates.map((u) => u.source_url), [KFW], "only web links survive (they become an href)");
  assert.deepEqual(odd.pending_sections[0]?.sources, [{ url: GEG, title: "GEG" }]);

  const key = aktualitaetTextKey(context());
  const stored = { ...emptyAktualitaetProgress(key), research: { text: "p", ...research }, calls: 2, cost_eur: 0.05, web_search_requests: 3 };
  assert.deepEqual(readAktualitaetProgress(stored, key).research?.sources, research.sources, "same text: the paid research is reused");
  const stale = readAktualitaetProgress(stored, "anderer-text");
  assert.deepEqual([stale.research, stale.cost_eur, stale.calls], [null, 0.05, 2], "another text: research again, the cost stays counted");
  assert.deepEqual(readAktualitaetProgress({ blocks: [] }, key), emptyAktualitaetProgress(key), "a finished output is no progress");
  assert.equal(aktualitaetProgressLabel(stored), "Websuche fertig, 2 Quellen – Ergebnis folgt");
  assert.equal(aktualitaetProgressLabel(emptyAktualitaetProgress(key)), null);

  assert.equal(estimateWebSearchCostEur(10, 1), 0.1, "10 $ per 1,000 searches");
  assert.equal(estimateWebSearchCostEur(DT_WEB_SEARCH_MAX_USES, 0.92), 0.092);
  assert.equal(estimateWebSearchCostEur(-2, 1), 0);

  const missingColumn = contentDbErrorMessage({ code: "42703", message: "column dt_content_pages.freshness does not exist" }, "x");
  assert.ok(missingColumn.includes(CONTENT_AKTUALITAET_MIGRATION_FILE), "a missing column names the migration");
  const range = contentDbErrorMessage({ code: "23514", message: 'new row violates check constraint "dt_content_steps_step_check"' }, "x");
  assert.ok(range.includes(CONTENT_AKTUALITAET_MIGRATION_FILE) && range.includes("10 Schritte"));
}
console.log("stored state: ok");

// --- ten steps ------------------------------------------------------------------------------------

{
  assert.equal(CONTENT_STEP_COUNT, 10);
  assert.equal(contentStepName(CONTENT_STEP_AKTUALITAET), "Aktualitätsprüfung");
  const done = (n: number) => Array.from({ length: n }, (_, i) => ({ step: i + 1, status: "done" }));
  assert.equal(nextContentStep(done(4)), CONTENT_STEP_AKTUALITAET, "after GEO comes the check");
  assert.equal(nextContentStep([...done(4), { step: 5, status: "skipped" }]), CONTENT_STEP_HORMOZI, "a skipped check is passed");
  assert.equal(nextContentStep([...done(4), { step: 5, status: "pending" }, { step: 6, status: "done" }]), CONTENT_STEP_AKTUALITAET, "after a send-back GEO and the check run again (GEO first)");
  assert.equal(nextContentStep([...done(3), { step: 4, status: "pending" }, { step: 5, status: "pending" }]), CONTENT_STEP_GEO);
  assert.equal(nextContentStep(done(10)), null);
  assert.equal(nextContentStep(done(9)), CONTENT_STEP_ENDABNAHME);
  assert.equal(hasLegacyContentSteps(CONTENT_STEPS.map((s) => ({ step: s.step, name: s.name }))), false);
  assert.equal(hasLegacyContentSteps([{ step: 5, name: "Hormozi" }]), true, "an unmigrated nine-step row is legacy");
  assert.equal(hasLegacyContentSteps([{ step: 10, name: "Endabnahme" }, { step: 9, name: "Watermark Entfernung" }]), false);
  assert.equal(def.writesText && def.provider === "anthropic" && def.tier === "write", true);
}
console.log("ten steps: ok");

// --- the migration: renumbering without a collision, names fitting the code --------------------------

{
  const sql = readFileSync(CONTENT_AKTUALITAET_MIGRATION_FILE, "utf8");
  type Row = { page: string; step: number; name: string; status: string };
  const nine = ["Analyse", "SEO", "Faktencheck", "GEO", "Hormozi", "Vermenschlichung", "Lektorat", "Watermark Entfernung", "Endabnahme"];
  const rows: Row[] = [
    ...nine.map((name, i) => ({ page: "fertig", step: i + 1, name, status: "done" })),
    ...nine.slice(0, 5).map((name, i) => ({ page: "wartet", step: i + 1, name, status: i === 4 ? "waiting" : "done" })),
    ...nine.slice(0, 3).map((name, i) => ({ page: "fakten", step: i + 1, name, status: "done" })),
    ...nine.map((name, i) => ({ page: "neu-ab-seo", step: i + 1, name, status: i === 0 ? "done" : "pending" })),
    ...["Analyse", "SEO", "Faktencheck", "GEO", "Hormozi", "Vermenschlichung", "Lektorat", "Endabnahme"].map((name, i) => ({ page: "acht", step: i + 1, name, status: "done" })),
  ];
  const pages: Record<string, number | null> = { fertig: 9, wartet: 5, fakten: 3, "neu-ab-seo": 2, acht: 8, leer: null };

  const statements = [...sql.matchAll(/UPDATE public\.(dt_content_steps|dt_content_pages) SET step = step ([+-]) (\d+) WHERE step >= (\d+);/g)];
  assert.equal(statements.length, 3, "two moves for the steps, one for the pages");
  for (const [, table, sign, amount, from] of statements) {
    const delta = (sign === "+" ? 1 : -1) * Number(amount);
    if (table === "dt_content_steps") {
      for (const row of rows) if (row.step >= Number(from)) row.step += delta;
      const keys = rows.map((r) => `${r.page}|${r.step}`);
      assert.equal(new Set(keys).size, keys.length, `UNIQUE (page_id, step) holds after „step ${sign} ${amount}“`);
    } else {
      for (const page of Object.keys(pages)) if (pages[page] != null && pages[page]! >= Number(from)) pages[page] = pages[page]! + delta;
    }
  }
  const insert = sql.match(/SELECT DISTINCT s\.page_id, s\.organisation_id, (\d+), '([^']+)', '(\w+)'\s+FROM public\.dt_content_steps s\s+WHERE s\.step >= (\d+) AND s\.status <> 'pending'/);
  assert.ok(insert, "pages that already went past GEO get the check as skipped");
  const [, step, name, status, after] = insert!;
  assert.deepEqual([Number(step), name, Number(after)], [CONTENT_STEP_AKTUALITAET, contentStepName(CONTENT_STEP_AKTUALITAET), CONTENT_STEP_HORMOZI]);
  for (const page of new Set(rows.filter((r) => r.step >= Number(after) && r.status !== "pending").map((r) => r.page))) {
    if (!rows.some((r) => r.page === page && r.step === Number(step))) rows.push({ page, step: Number(step), name, status });
  }
  const of = (page: string) => rows.filter((r) => r.page === page).sort((a, b) => a.step - b.step);

  assert.deepEqual(of("fertig").map((r) => [r.step, r.name, r.status]), CONTENT_STEPS.map((s) => [s.step, s.name, s.step === 5 ? "skipped" : "done"]));
  assert.equal(hasLegacyContentSteps(of("fertig")), false, "no reset needed");
  assert.equal(nextContentStep(of("fertig")), null, "a finished page stays finished");
  assert.equal(pages.fertig, CONTENT_STEP_ENDABNAHME);
  assert.deepEqual([pages.wartet, hasLegacyContentSteps(of("wartet"))], [CONTENT_STEP_HORMOZI, false], "a page waiting at Hormozi waits at 6 now");
  const approved = of("wartet").map((r) => (r.step === CONTENT_STEP_HORMOZI ? { ...r, status: "done" } : r));
  assert.equal(nextContentStep(approved), CONTENT_STEP_VERMENSCHLICHUNG, "after „Freigeben“ it goes on with the Vermenschlichung, not back to the check");
  assert.deepEqual([pages.fakten, nextContentStep(of("fakten").map((r) => ({ ...r, status: "done" })))], [3, CONTENT_STEP_GEO]);
  assert.equal(nextContentStep(of("neu-ab-seo")), 2);
  assert.equal(of("neu-ab-seo").some((r) => r.step === 5), false, "a page reset to SEO runs the check when it gets there");
  assert.equal(hasLegacyContentSteps(of("acht")), true, "the eight-step order stays legacy");
  assert.equal(pages.leer, null);
  assert.match(sql, /CHECK \(step >= 1 AND step <= 10\)/);
  assert.match(sql, /CHECK \(step IS NULL OR \(step >= 1 AND step <= 10\)\)/);
  assert.match(sql, new RegExp(`<= ${CONTENT_STEP_COUNT}`));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS freshness jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /state = 'laeuft'[\s\S]*RAISE EXCEPTION/, "the migration refuses to run while pages run");
  assert.match(sql, /LIKE '%<= 10%'[\s\S]*RETURN;/, "a second run does not shift twice");
  assert.doesNotMatch(sql, /dt_llm_usage_events\s+SET/i, "historical usage rows are not touched");
}
console.log("migration: ok");

// --- the editable prompt ---------------------------------------------------------------------------

{
  assert.ok(isContentStepPromptKey("aktualitaet"));
  assert.ok((CONTENT_STEP_PROMPT_KEYS as readonly string[]).includes("aktualitaet"));
  assert.deepEqual(
    Object.fromEntries(CONTENT_STEP_PROMPT_KEYS.map((key) => [key, CONTENT_STEP_PROMPT_META[key].step])),
    { seo: 2, faktencheck: 3, geo: 4, aktualitaet: 5, hormozi: 6, vermenschlichung: 7, lektorat: 8 },
  );
  assert.equal(CONTENT_STEP_PROMPT_META.aktualitaet.label, "Aktualitätsprüfung");
  for (const key of CONTENT_STEP_PROMPT_KEYS) {
    assert.match(CONTENT_STEP_PROMPT_META[key].description, new RegExp(`^Schritt ${CONTENT_STEP_PROMPT_META[key].step}:`), `${key}: the card names its step`);
    assert.match(DEFAULT_CONTENT_STEP_PROMPTS[key], new RegExp(`^Schritt ${CONTENT_STEP_PROMPT_META[key].step} `), `${key}: the default names its step`);
  }
  const instruction = DEFAULT_CONTENT_STEP_PROMPTS.aktualitaet;
  for (const part of [/Gesetze, Verordnungen, Fristen/, /Förderprogramme/, /Normen und Standards/, /Technikgenerationen/, /Statistiken/, /„2024“, „aktuell“, „neu“/, /Google und KI-Anbietern/, /Plane die Suchen vorab/, /aktuell[\s\S]*aktualisiert[\s\S]*frage[\s\S]*abschnitt_veraltet/, /kleinste mögliche Änderung/, /Angaben über den Kunden/, /Nichts erfinden/]) {
    assert.match(instruction, part, `the default covers ${part}`);
  }
  assert.ok(!instruction.includes(AKTUALITAET_RULES.slice(0, 40)), "the fixed rules stay in code");
  assert.equal(resolveContentStepPrompt("aktualitaet", null), instruction);
  assert.equal(resolveContentStepPrompt("aktualitaet", "  "), instruction);
  assert.equal(resolveContentStepPrompt("aktualitaet", "Nur Förderungen prüfen."), "Nur Förderungen prüfen.");
  assert.deepEqual(normalizeStoredContentStepPrompts({ aktualitaet: instruction }), {}, "the default is never stored as an own text");
  assert.equal(resolveContentStepPrompts({ aktualitaet: "Eigen." }).aktualitaet, "Eigen.");
  const own = aktualitaetSystemPrompt(context({ stepPrompts: { aktualitaet: "Nur Förderungen prüfen." } }));
  assert.ok(own.startsWith("Nur Förderungen prüfen.\n\nDu arbeitest für eine Agentur"), "the saved text replaces the default, BASE_RULES follow");
  assert.ok(own.includes(AKTUALITAET_RULES) && own.includes(DT_WEB_RESEARCH_INSTRUCTIONS), "the fixed rules stay with an own text");
  assert.doesNotMatch(own, /Plane die Suchen vorab/);
  assert.match(DEFAULT_CONTENT_STEP_PROMPTS.faktencheck, new RegExp(CONTENT_HERO_PLACEHOLDER_LEGACY.replace(/[[\]]/g, "\\$&")));
  assert.match(DEFAULT_CONTENT_STEP_PROMPTS.seo, /Schritt 6 \(Hormozi\) füllt ihn/);
  assert.match(DEFAULT_CONTENT_TYPE_PROMPTS.ratgeber, /Hormozi, Schritt 6, nutzt den Ratgeber-Zyklus/);
  assert.equal(DT_WEB_FETCH_MAX_USES, 5);
  assert.equal(CONTENT_STEP_LEKTORAT, 8);
}
console.log("step prompt: ok");

// --- the research call, on a stub client ------------------------------------------------------------

type StubMessage = { content: unknown[]; stop_reason: string; usage: Record<string, unknown> };

function stubClient(answers: Array<StubMessage | Error>, seen: unknown[]): Anthropic {
  let i = 0;
  const create = async (body: unknown) => {
    seen.push(body);
    const answer = answers[i++];
    if (!answer) throw new Error("no more answers");
    if (answer instanceof Error) throw answer;
    async function* events() {
      yield { type: "message_start", message: { id: `m${i}`, type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      for (const [index, block] of (answer as StubMessage).content.entries()) yield { type: "content_block_start", index, content_block: block };
      yield { type: "message_delta", delta: { stop_reason: (answer as StubMessage).stop_reason, stop_sequence: null }, usage: (answer as StubMessage).usage };
    }
    return events();
  };
  return { messages: { create } } as unknown as Anthropic;
}

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { type: "invalid_request_error", error: { message } } });
}

async function runResearchCall() {
  const seen: unknown[] = [];
  const billed: Array<{ model: string; searches: number }> = [];
  const result = await callContentResearch({
    models: ["claude-test"],
    system: "s",
    user: "u",
    maxTokens: 100,
    timeoutMs: 30_000,
    anthropic: stubClient(
      [
        {
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Heizungsförderung 2026" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: KFW, title: "KfW", encrypted_content: "x" }] },
          ],
          stop_reason: "pause_turn",
          usage: { input_tokens: 1_000, output_tokens: 50, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
        },
        {
          content: [{ type: "text", text: "- [foerderung] veraltet\nZeitkritische Aussagen: 1", citations: [{ type: "web_search_result_location", url: GEG, title: "GEG", cited_text: "…", encrypted_index: "e" }] }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1_500, output_tokens: 80, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
        },
      ],
      seen,
    ),
    onCall: (call) => {
      billed.push({ model: call.model, searches: call.web.webSearchRequests });
    },
  });
  assert.equal(seen.length, 2, "a paused turn is continued");
  const firstBody = seen[0] as { tools: Array<{ name: string; max_uses?: number; user_location?: { country: string } }>; tool_choice: { type: string }; stream: boolean };
  assert.deepEqual(firstBody.tools.map((t) => [t.name, t.max_uses]), [["web_search", 10], ["web_fetch", 5]], "the SEO chat's web tools and limits");
  assert.equal(firstBody.tools[0]!.user_location?.country, "DE");
  assert.deepEqual(firstBody.tool_choice, { type: "auto" }, "never a forced tool: it would forbid the searches");
  const secondBody = seen[1] as { messages: Array<{ role: string }> };
  assert.deepEqual(secondBody.messages.map((m) => m.role), ["user", "assistant"], "the paused content goes back as the assistant turn");
  assert.deepEqual(billed, [{ model: "claude-test", searches: 2 }, { model: "claude-test", searches: 1 }], "every round is billed at once");
  assert.equal(result.text, "- [foerderung] veraltet\nZeitkritische Aussagen: 1");
  assert.deepEqual(inspectResearchBlocks(result.blocks).sources.map((s) => s.url), [KFW, GEG], "sources across both rounds");

  // Web search not enabled for the key: a clear German error, no retry, never „aktuell“.
  await assert.rejects(
    callContentResearch({ models: ["claude-test"], system: "s", user: "u", maxTokens: 100, timeoutMs: 30_000, anthropic: stubClient([apiError(400, "web_search is not enabled for this organization")], []) }),
    (error: unknown) =>
      error instanceof ContentLlmError && !error.retryable && /Websuche ist für den Texte-Schlüssel nicht verfügbar \(Fehler 400/.test(error.message) && /Anthropic Console/.test(error.message),
  );
  await assert.rejects(
    callContentResearch({ models: ["claude-test"], system: "s", user: "u", maxTokens: 100, timeoutMs: 30_000, anthropic: stubClient([apiError(403, "Web search is not permitted")], []) }),
    (error: unknown) => error instanceof ContentLlmError && !error.retryable && /Websuche/.test(error.message),
  );
  await assert.rejects(
    callContentResearch({ models: ["claude-test"], system: "s", user: "u", maxTokens: 100, timeoutMs: 30_000, anthropic: stubClient([apiError(429, "rate limited")], []) }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable,
    "a rate limit is tried again later",
  );
  assert.match(researchErrorMessage(apiError(401, "invalid x-api-key")), /Schlüssel ungültig/, "a rejected key says so");
  await assert.rejects(
    callContentResearch({
      models: ["claude-test"],
      system: "s",
      user: "u",
      maxTokens: 100,
      timeoutMs: 30_000,
      anthropic: stubClient([{ content: [{ type: "text", text: "abgeschn" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 100 } }], []),
    }),
    /abgeschnitten/,
  );
  console.log("research call: ok");
}

// The text the drawer and the review show after an update: the same block, the new figure.
{
  const out = normalizeAktualitaetOutput(
    { blocks, updates: [{ block_id: "foerderung", old_text: "bis zu 21.000 €", new_text: "bis zu 23.500 €", reason: "x", source_url: KFW, source_title: "KfW" }] },
    context(),
    research,
  );
  const saved = stepPatchFor(def, out, { html: renderBlocksHtml(blocks), freshness: {} }, at);
  const reread = parseBlocksFromHtml(String(saved.pagePatch.html));
  assert.match(reread.find((b) => b.id === "foerderung")!.html, /23\.500 €/);
  assert.doesNotMatch(String(saved.pagePatch.html), /kfw\.de/, "the source never reaches the stored text (and so no export)");
  assert.equal((saved.pagePatch.freshness as ContentFreshness).updates[0]?.source_url, KFW);
}

runResearchCall()
  .then(() => console.log("OK: Aktualitätsprüfung tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
