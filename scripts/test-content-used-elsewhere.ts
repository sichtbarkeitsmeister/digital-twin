/**
 * Texte: Kontext über Seiten hinweg. The SEO step is told what the other pages of the same
 * organisation already use (Hero-Überschrift, Einstieg, H2/H3, Fallbeispiele), so the pages of
 * one customer do not open alike and do not tell the same case twice. No network, no model.
 * Run: npm run test:content-used-elsewhere
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { contentStepSpec, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { loadUsedElsewhere } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_GEO, CONTENT_STEP_SEO } from "../lib/dt/content/pipeline/steps";
import { USED_ELSEWHERE_RULES, contentPageUsage, usedElsewhere, usedElsewhereBlock } from "../lib/dt/content/pipeline/used-elsewhere";
import { renderBlocksHtml } from "../lib/dt/content/render";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const html = (hero: string, einstieg: string, rest: Array<{ id: string; heading: string; level: 2 | 3; html: string }>) =>
  renderBlocksHtml([
    { id: "hero", heading: "H1 der Seite", level: 1, html: "" },
    { id: "zusammenfassung", heading: hero, level: 2, html: `<p>${einstieg} Zweiter Satz.</p>` },
    ...rest,
  ]);

const PAGES = [
  {
    slug: "erschoepfung",
    name: "Erschöpfung",
    html: html("Erschöpft trotz guter Blutwerte?", "Sie sind seit Monaten erschöpft, Ihre Blutwerte sind unauffällig.", [
      { id: "ursachen", heading: "Welche Ursachen kommen infrage?", level: 2, html: "<p>Oft liegt es am Eisen.</p>" },
      { id: "zeit", heading: "Zeit statt Fließband", level: 3, html: "<p>Das Erstgespräch dauert 60 Minuten.</p>" },
      { id: "fall", heading: "Fallbeispiel: Lehrerin, 42", level: 2, html: "<p>Eine Lehrerin kam nach zwei Jahren Müdigkeit in die Praxis. Ihr Ferritin lag bei 12.</p>" },
    ]),
  },
  {
    slug: "infusionen",
    name: "Infusionen",
    html: html("Infusionen bei nachgewiesenem Mangel", "Eine Infusion gleicht einen nachgewiesenen Mangel schneller aus als Tabletten.", [
      { id: "ablauf", heading: "Wie läuft eine Infusion ab?", level: 2, html: "<p>Sie sitzen 30 Minuten. Ein Patient berichtete nach der dritten Infusion von besserem Schlaf. Danach gehen Sie nach Hause.</p>" },
    ]),
  },
  { slug: "blutwerte", name: "Blutwerte", html: html("Eigene Seite", "Eigener Einstieg.", []) },
  { slug: "leer", name: "Leer", html: "" },
];

{
  const usage = contentPageUsage(PAGES[0]!);
  assert.equal(usage.hero, "Erschöpft trotz guter Blutwerte?");
  assert.equal(usage.einstieg, "Sie sind seit Monaten erschöpft, Ihre Blutwerte sind unauffällig.", "the first sentence only");
  assert.deepEqual(usage.headings, ["Welche Ursachen kommen infrage?", "Zeit statt Fließband", "Fallbeispiel: Lehrerin, 42"], "H2 and H3, without the Hero-Überschrift and the H1");
  assert.deepEqual(usage.fallbeispiele, ["Fallbeispiel: Lehrerin, 42: Eine Lehrerin kam nach zwei Jahren Müdigkeit in die Praxis."]);
  // A case told inside a paragraph is found by its wording.
  assert.deepEqual(contentPageUsage(PAGES[1]!).fallbeispiele, ["Ein Patient berichtete nach der dritten Infusion von besserem Schlaf."]);
  assert.deepEqual(contentPageUsage({ slug: "x", name: "X", html: null }), { slug: "x", name: "X", hero: null, einstieg: null, headings: [], fallbeispiele: [] });
  console.log("what a page uses: ok");
}

{
  // The register: every other page with a text, never the page itself.
  const register = usedElsewhere(PAGES, "blutwerte");
  assert.deepEqual(register.map((u) => u.slug), ["erschoepfung", "infusionen"]);
  const block = usedElsewhereBlock(register);
  assert.match(block, /^## Schon verwendet auf anderen Seiten dieses Anbieters \(nicht wiederholen\)/);
  assert.match(block, /### Seite „Erschöpfung“\nHero-Überschrift: Erschöpft trotz guter Blutwerte\?\nEinstieg \(erster Satz der Kurzzusammenfassung\): Sie sind seit Monaten erschöpft/);
  assert.match(block, /Überschriften \(H2\/H3\): Welche Ursachen kommen infrage\? · Zeit statt Fließband/);
  assert.match(block, /Fallbeispiele: Ein Patient berichtete/);
  assert.equal(usedElsewhereBlock([]), "");
  assert.equal(usedElsewhereBlock(null), "");
  // Many pages: the block stays within its size and says how many are not shown.
  const many = Array.from({ length: 80 }, (_, i) => contentPageUsage({ ...PAGES[0]!, slug: `s${i}`, name: `Seite ${i}` }));
  const capped = usedElsewhereBlock(many, 3_000);
  assert.ok(capped.length <= 3_100);
  assert.match(capped, /\(\d+ weitere Seiten mit Text nicht gezeigt\.\)$/);
  console.log("register: ok");
}

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Lindner",
  page: {
    name: "Blutwerte", path: "/blutwerte", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Labordiagnostik im Haus." }],
  settings: { anrede: "Sie", branche: "Heilpraktiker", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [],
  title: null,
  metaDescription: null,
  ...patch,
});

async function main() {
  // Only the SEO step gets the register and its rule; without other texts nothing changes.
  const withRegister = context({ usedElsewhere: usedElsewhere(PAGES, "blutwerte") });
  const seo = contentStepSpec(CONTENT_STEP_SEO, withRegister);
  assert.ok(seo.user.includes("## Schon verwendet auf anderen Seiten dieses Anbieters") && seo.user.includes("Zeit statt Fließband"));
  assert.ok(seo.system.includes(USED_ELSEWHERE_RULES));
  const first = contentStepSpec(CONTENT_STEP_SEO, context());
  assert.ok(!first.user.includes("Schon verwendet") && !first.system.includes("Kontext über Seiten hinweg"), "the first page of a customer: unchanged");
  assert.ok(!contentStepSpec(CONTENT_STEP_GEO, withRegister).user.includes("Schon verwendet"), "GEO does not get it");

  // The loader reads the organisation's texts; a failing read gives an empty register, never a failed step.
  const service = (result: { data?: unknown; error?: { message: string } | null }) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "order"]) chain[method] = () => chain;
    chain.limit = async () => ({ data: result.data ?? null, error: result.error ?? null });
    return { from: () => chain } as never;
  };
  const loaded = await loadUsedElsewhere(service({ data: PAGES }), { organisation_id: "o", slug: "blutwerte" });
  assert.deepEqual(loaded.map((u) => u.slug), ["erschoepfung", "infusionen"]);
  assert.deepEqual(await loadUsedElsewhere(service({ error: { message: "kaputt" } }), { organisation_id: "o", slug: "blutwerte" }), []);
  console.log("SEO step and loader: ok");
}

main()
  .then(() => console.log("OK: content used elsewhere tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
