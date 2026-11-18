/**
 * Texte: hero_kandidaten (SEO) and belegliste (Faktencheck). The SEO step compares six candidates
 * for the Hero-Überschrift before it writes; the Faktencheck lists where each factual statement is
 * backed before it reports findings. GEO and Hormozi get the candidates; the page window shows
 * both for the release. No network, no model.
 * Run: npm run test:content-step-evidence
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { contentStepSpec, type ContentPipelineContext, type FaktencheckOutput, type SeoOutput } from "../lib/dt/content/pipeline/prompts";
import {
  BELEGLISTE_RULES,
  CONTENT_BELEGLISTE_MAX,
  HERO_KANDIDATEN_RULES,
  heroKandidatenBlock,
  normalizeBelegliste,
  normalizeHeroKandidaten,
} from "../lib/dt/content/pipeline/step-evidence";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  contentStepDefinition,
} from "../lib/dt/content/pipeline/steps";
import { reviewEvidence, type ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const KANDIDATEN = [
  { text: "Erschöpft trotz guter Blutwerte?", gewaehlt: false, grund: "Könnte auf jeder Seite der Praxis stehen." },
  { text: "Welche Blutwerte Erschöpfung erklären", gewaehlt: true, grund: "Beantwortet die Hauptfrage dieser Seite." },
  { text: "Ferritin, Schilddrüse, Vitamin D: was ein großes Blutbild nicht zeigt", gewaehlt: false, grund: "Zu lang für eine Überschrift." },
  { text: "Endlich wieder Energie", gewaehlt: false, grund: "Versprechen ohne Beleg." },
  { text: "Blutwerte verstehen", gewaehlt: false, grund: "Zu allgemein." },
  { text: "Das Labor hinter der Müdigkeit", gewaehlt: false, grund: "Unklar, wovon die Seite handelt." },
];

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Lindner",
  page: {
    name: "Blutwerte", path: "/blutwerte", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: "Erschöpfung", estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Labordiagnostik im Haus. Erstgespräch 60 Minuten." }],
  settings: { anrede: "Sie", branche: "Heilpraktiker", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [
    { id: "hero", heading: "Blutwerte bei Erschöpfung", level: 1, html: "" },
    { id: "zusammenfassung", heading: "Welche Blutwerte Erschöpfung erklären", level: 2, html: "<p>Das Erstgespräch dauert 60 Minuten. Das Labor ist im Haus.</p>" },
  ],
  title: null,
  metaDescription: null,
  ...patch,
});

{
  // SEO: the candidates are the first field of the answer and have their fixed rule.
  const spec = contentStepSpec(CONTENT_STEP_SEO, context());
  const schema = spec.tool.input_schema as { properties: Record<string, unknown>; required: string[] };
  assert.equal(Object.keys(schema.properties)[0], "hero_kandidaten", "compared before the text is written");
  assert.ok(schema.required.includes("hero_kandidaten"));
  assert.ok(spec.system.includes(HERO_KANDIDATEN_RULES));

  const json = { hero_kandidaten: KANDIDATEN, title: "T", meta_description: "M", blocks: context().blocks };
  const out = spec.normalize(json, context()) as SeoOutput;
  assert.equal(out.hero_kandidaten.length, 6);
  assert.deepEqual(out.hero_kandidaten.filter((k) => k.gewaehlt).map((k) => k.text), ["Welche Blutwerte Erschöpfung erklären"]);
  // The text decides which one is chosen: the model marked another one than it used.
  const wrong = spec.normalize({ ...json, hero_kandidaten: KANDIDATEN.map((k, i) => ({ ...k, gewaehlt: i === 0 })) }, context()) as SeoOutput;
  assert.deepEqual(wrong.hero_kandidaten.filter((k) => k.gewaehlt).map((k) => k.text), ["Welche Blutwerte Erschöpfung erklären"]);
  assert.deepEqual(normalizeHeroKandidaten([{ text: "A", gewaehlt: true }, { text: "a" }, "B", { text: "C", gewaehlt: true }]).map((k) => [k.text, k.gewaehlt]), [["A", true], ["B", false], ["C", false]], "each once, exactly one chosen");
  assert.deepEqual(normalizeHeroKandidaten(null), []);
  // The step's page patch is the text as before; the candidates stay in the step row.
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_SEO)!, out, { html: "" });
  assert.ok(typeof patch.pagePatch.html === "string" && !String(patch.pagePatch.html).includes("verworfen"));
  console.log("hero_kandidaten in SEO: ok");
}

{
  // GEO and Hormozi get the list; the other steps do not.
  const seoOutput = { hero_kandidaten: normalizeHeroKandidaten(KANDIDATEN), blocks: [] };
  const block = heroKandidatenBlock(seoOutput);
  assert.match(block, /^## Hero-Kandidaten des SEO-Schritts/);
  assert.match(block, /- GEWÄHLT: „Welche Blutwerte Erschöpfung erklären“ – Beantwortet die Hauptfrage dieser Seite\./);
  assert.match(block, /- verworfen: „Endlich wieder Energie“ – Versprechen ohne Beleg\./);
  assert.equal(heroKandidatenBlock({ blocks: [] }), "");
  const ctx = context({ outputs: { [CONTENT_STEP_SEO]: seoOutput } });
  for (const step of [CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI]) {
    assert.ok(contentStepSpec(step, ctx).user.includes("## Hero-Kandidaten des SEO-Schritts"), `step ${step} sees the candidates`);
  }
  assert.ok(!contentStepSpec(CONTENT_STEP_LEKTORAT, ctx).user.includes("Hero-Kandidaten"));
  assert.ok(!contentStepSpec(CONTENT_STEP_GEO, context()).user.includes("Hero-Kandidaten"), "nothing without candidates (older pages)");
  console.log("GEO and Hormozi: ok");
}

{
  // Faktencheck: the evidence list comes first, with its rule; unknown Abschnitte and missing evidence are handled.
  const spec = contentStepSpec(CONTENT_STEP_FAKTENCHECK, context());
  const schema = spec.tool.input_schema as { properties: Record<string, unknown>; required: string[] };
  assert.equal(Object.keys(schema.properties)[0], "belegliste");
  assert.ok(schema.required.includes("belegliste"));
  assert.ok(spec.system.includes(BELEGLISTE_RULES));
  const out = spec.normalize(
    {
      belegliste: [
        { zitat: "Das Erstgespräch dauert 60 Minuten.", block_id: "zusammenfassung", beleg: "Anbieterfakten › Leistungen: Erstgespräch 60 Minuten", belegt: true },
        { zitat: "Ergebnisse liegen nach drei Tagen vor.", block_id: "gibt-es-nicht", beleg: "kein Beleg", belegt: true },
        { zitat: "", block_id: "zusammenfassung", beleg: "x", belegt: true },
      ],
      findings: [],
      questions: [],
    },
    context(),
  ) as FaktencheckOutput;
  assert.deepEqual(out.belegliste, [
    { zitat: "Das Erstgespräch dauert 60 Minuten.", block_id: "zusammenfassung", beleg: "Anbieterfakten › Leistungen: Erstgespräch 60 Minuten", belegt: true },
    { zitat: "Ergebnisse liegen nach drei Tagen vor.", block_id: null, beleg: "kein Beleg", belegt: false },
  ], "„kein Beleg“ is never counted as backed");
  assert.equal(normalizeBelegliste(Array.from({ length: 40 }, (_, i) => ({ zitat: `Satz ${i}`, beleg: "Anbieterfakten" })), new Set()).length, CONTENT_BELEGLISTE_MAX);
  assert.deepEqual((spec.normalize({ findings: [], questions: [] }, context()) as FaktencheckOutput).belegliste, [], "an answer without the list still works");
  console.log("belegliste in the Faktencheck: ok");
}

{
  // The page window gets both from the step rows.
  const row = (step: number, status: string, output: unknown): ContentStepRow =>
    ({ id: `s${step}`, page_id: "p", organisation_id: "o", step, name: "", status, output, model: null, input_tokens: 0, output_tokens: 0, cost_eur: 0, error: null, started_at: null, finished_at: null, approved_by: null, approved_at: null }) as ContentStepRow;
  const evidence = reviewEvidence([
    row(CONTENT_STEP_SEO, "done", { hero_kandidaten: normalizeHeroKandidaten(KANDIDATEN), blocks: [] }),
    row(CONTENT_STEP_FAKTENCHECK, "done", { belegliste: [{ zitat: "Satz.", block_id: "a", beleg: "kein Beleg", belegt: false }], findings: [], questions: [] }),
  ]);
  assert.equal(evidence.hero_kandidaten.length, 6);
  assert.deepEqual(evidence.belegliste, [{ zitat: "Satz.", block_id: "a", beleg: "kein Beleg", belegt: false }]);
  assert.deepEqual(reviewEvidence([row(CONTENT_STEP_SEO, "pending", null)]), { hero_kandidaten: [], belegliste: [] });
  console.log("review: ok");
}

console.log("OK: content step evidence tests passed");
