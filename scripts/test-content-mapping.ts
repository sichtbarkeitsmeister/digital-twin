/**
 * Tests for the Content-Agent mapping, presentation helpers and demo fixtures.
 * Run: npx tsx scripts/test-content-mapping.ts
 */
import assert from "node:assert/strict";

import {
  demoExport,
  demoOverview,
  demoPutClient,
  demoQuestions,
  demoReadiness,
  demoReview,
  demoRunThrough,
} from "../lib/dt/content/fixtures";
import {
  anbieterFromSurvey,
  avatarFromAgent,
  contentClientKey,
  contentKeyForField,
  surveyAnswerToList,
} from "../lib/dt/content/mapping";
import {
  anyContentPageRunning,
  contentActionLabel,
  contentStateMeta,
  extractContentBlocks,
} from "../lib/dt/content/presentation";

const field = (id: string, type: string, title: string, options?: Array<{ id: string; label: string }>) => ({
  id,
  type,
  title,
  description: "",
  required: false,
  ...(options ? { options } : {}),
});

// --- anbieterFromSurvey: standard core questions -------------------------------------------
const coreDefinition = {
  steps: [
    {
      id: "core_company",
      title: "Das Unternehmen",
      description: "",
      fields: [
        field("core_company_name", "text", "Wie lautet der vollständige Name der Firma …?"),
        field("core_colloquial_name", "text", "Wie wird die Firma im Alltag genannt …?"),
        field("core_portfolio", "checkbox", "Welche Leistungen oder Produkte werden aktuell angeboten?", [
          { id: "portfolio_1", label: "Haushaltsauflösung" },
          { id: "portfolio_2", label: "Kellerentrümpelung" },
        ]),
        field("core_usp", "text", "Was macht das eigene Angebot besonders …?"),
      ],
    },
    {
      id: "core_language",
      title: "Sprache & Wortwahl",
      description: "",
      fields: [
        field("core_speaking_style", "ranking", "Wie wird normalerweise mit dem Kunden gesprochen …", [
          { id: "speak_1", label: "persönlich und herzlich" },
          { id: "speak_2", label: "direkt und auf den Punkt" },
          { id: "speak_3", label: "sachlich und fachlich" },
        ]),
        field("core_address_form", "radio", "Wird auf der Website und in Texten „Du“ oder „Sie“ verwendet?", [
          { id: "du", label: "Du" },
          { id: "sie", label: "Sie" },
        ]),
        field("core_forbidden_terms", "text_list", "Gibt es Wörter …, die auf keinen Fall verwendet werden sollen?", [
          { id: "forbidden_term_1", label: "" },
          { id: "forbidden_term_2", label: "" },
          { id: "forbidden_term_3", label: "" },
        ]),
        field("core_keyword_offer", "text_list", "Unter welchen Wörtern soll die Firma bei Google gefunden werden?", [
          { id: "kw_offer_1", label: "" },
          { id: "kw_offer_2", label: "" },
        ]),
        field("core_philosophy_quotes", "text", "Gibt es einen Satz …?"),
      ],
    },
  ],
};

const anbieter = anbieterFromSurvey({
  definition: coreDefinition,
  organisationName: "einfach-entruempelung",
  answers: {
    core_company_name: "Einfach Entrümpelung GmbH",
    core_colloquial_name: "Einfach Entrümpelung",
    core_portfolio: ["Haushaltsauflösung", "__other__:x|Messie-Wohnungen"],
    core_usp: "Festpreis nach Besichtigung, besenreine Übergabe.",
    core_speaking_style: {
      items: [
        { kind: "preset", label: "direkt und auf den Punkt" },
        { kind: "preset", label: "persönlich und herzlich" },
      ],
      excludedPresets: ["sachlich und fachlich"],
    },
    core_address_form: "Du",
    core_forbidden_terms: {
      entries: [
        { id: "forbidden_term_1", value: "Schrott" },
        { id: "forbidden_term_2", value: "  billig " },
        { id: "forbidden_term_3", value: "—" },
      ],
    },
    core_keyword_offer: {
      entries: [
        { id: "kw_offer_1", value: "Entrümpelung Düsseldorf" },
        { id: "kw_offer_2", value: "" },
      ],
    },
    core_philosophy_quotes: "k.a.",
  },
});

assert.equal(anbieter.name, "Einfach Entrümpelung GmbH");
assert.equal(anbieter.short_name, "Einfach Entrümpelung");
assert.equal(anbieter.anrede, "Du");
assert.equal(anbieter.branche, "Haushaltsauflösung", "branche falls back to first portfolio entry");
assert.deepEqual(anbieter.tonalitaet, ["direkt und auf den Punkt", "persönlich und herzlich"]);
assert.deepEqual(anbieter.verbotene_woerter, ["Schrott", "billig"]);
assert.equal(anbieter.usp, "Festpreis nach Besichtigung, besenreine Übergabe.");
assert.deepEqual(anbieter.keyword_offer, ["Entrümpelung Düsseldorf"]);
assert.deepEqual(anbieter.portfolio, ["Haushaltsauflösung", "Messie-Wohnungen"]);
assert.equal("philosophy_quotes" in anbieter, false, "placeholder answers are dropped");
assert.equal("company_name" in anbieter, false, "mapped questions are not repeated as free keys");
assert.equal("speaking_style" in anbieter, false);

// --- fallbacks: no answers, organisation name, default Sie ---------------------------------
const empty = anbieterFromSurvey({ definition: coreDefinition, answers: {}, organisationName: "Muster GmbH" });
assert.equal(empty.name, "Muster GmbH");
assert.equal(empty.anrede, "Sie");
assert.equal(empty.branche, "");
assert.deepEqual(empty.tonalitaet, []);
assert.deepEqual(empty.verbotene_woerter, []);
assert.equal("short_name" in empty, false);

const broken = anbieterFromSurvey({ definition: null, answers: null as never });
assert.equal(broken.name, "");
assert.equal(broken.anrede, "Sie");

// --- legacy questionnaire: matched by title, explicit Branche question ---------------------
const legacy = anbieterFromSurvey({
  definition: {
    steps: [
      {
        id: "s1",
        title: "Firma",
        description: "",
        fields: [
          field("f1", "text", "Firmenname"),
          field("f2", "text", "In welcher Branche sind Sie tätig?"),
          field("f3", "radio", "Du oder Sie?", [
            { id: "a", label: "Du" },
            { id: "b", label: "Sie" },
          ]),
          field("f4", "text", "Name"),
          field("f5", "rating", "Wie zufrieden sind Sie?"),
        ],
      },
    ],
  },
  answers: { f1: "Praxis Dr. Muster", f2: "Physiotherapie", f3: "Sie", f4: "Anna", f5: 4 },
});
assert.equal(legacy.name, "Praxis Dr. Muster");
assert.equal(legacy.branche, "Physiotherapie");
assert.equal(legacy.anrede, "Sie");
assert.equal(legacy.frage_name, "Anna", "free keys never overwrite reserved fields");
assert.equal(legacy.wie_zufrieden_sind_sie, 4);

assert.equal(contentKeyForField({ id: "core_usp", title: "egal" }), "usp");
assert.equal(contentKeyForField({ id: "x1", title: "Größte Stärke (Ü-Test)?" }), "groesste_staerke_ue_test");
assert.equal(contentKeyForField({ id: "x2", title: "???" }), "x2");

assert.deepEqual(surveyAnswerToList("eins\nzwei; drei"), ["eins", "zwei", "drei"]);
assert.deepEqual(surveyAnswerToList({ a: "x", b: "" }), ["x"]);
assert.deepEqual(surveyAnswerToList(["A", "a", "B"]), ["A", "B"], "case-insensitive dedupe");

// --- avatarFromAgent ------------------------------------------------------------------------
const avatar = avatarFromAgent({
  name: "  Petra ",
  role: "Erbin, 58",
  prompt_template: "Du bist Petra …",
  avatar_data: { emoji: "👩", disg: "S", name: "alter Name" },
});
assert.deepEqual(avatar, {
  emoji: "👩",
  disg: "S",
  name: "Petra",
  role: "Erbin, 58",
  beschreibung: "Du bist Petra …",
});
assert.deepEqual(avatarFromAgent({ name: "X", role: null, prompt_template: null, avatar_data: [] }), {
  name: "X",
  role: "",
  beschreibung: "",
});

assert.equal(contentClientKey(" 3F2A-ABC "), "3f2a-abc");

// --- presentation ---------------------------------------------------------------------------
assert.equal(contentStateMeta("braucht_sie").tone, "orange");
assert.equal(contentStateMeta("laeuft").tone, "blue");
assert.equal(contentStateMeta("unbekannt").label, "Nicht begonnen");
assert.equal(contentActionLabel("approve"), "Freigeben");
assert.equal(contentActionLabel("edit"), "Abschnitt ändern");
assert.equal(contentActionLabel("rerun_with_note"), "Mit Anmerkung wiederholen");
assert.equal(contentActionLabel("run_through"), "Weiterlaufen lassen");
assert.equal(contentActionLabel("export"), "Exportieren");
assert.equal(contentActionLabel("delete"), null);
assert.equal(anyContentPageRunning([{ state: "fertig" }, { state: "laeuft" }]), true);
assert.equal(anyContentPageRunning([{ state: "fertig" }]), false);

const blocks = extractContentBlocks(
  `<section data-block-id="intro"><h1>Titel</h1><p>A &amp; B</p></section>` +
    `<div data-block-id='faq'><p>Frage?</p></div><p>ohne Block</p>` +
    `<section data-block-id="intro"><p>doppelt</p></section>`,
);
assert.deepEqual(blocks, [
  { id: "intro", text: "Titel\nA & B" },
  { id: "faq", text: "Frage?" },
]);

// --- fixtures stay consistent with the contract -------------------------------------------
const overview = demoOverview();
assert.equal(overview.readiness.ready, true);
assert.equal(overview.needs_you, overview.pages.filter((p) => p.state === "braucht_sie").length);
assert.equal(overview.running, 1);
assert.equal(overview.cost, "5,43\u00a0€");
assert.ok(new Set(overview.pages.map((p) => p.slug)).size === overview.pages.length);

const notReady = demoReadiness({ anbieter: null, avatarCount: 0, structure: null });
assert.equal(notReady.ready, false);
assert.deepEqual(notReady.checks.map((c) => c.id), ["anbieter", "avatar", "structure"]);

for (const page of overview.pages) {
  const review = demoReview(page.slug)!;
  assert.equal(review.steps.length, 8, `${page.slug}: 8 steps`);
  assert.equal(review.public.state, page.state);
  for (const action of review.actions) {
    assert.ok(contentActionLabel(action.kind), `${page.slug}: known action ${action.kind}`);
    if (["approve", "edit", "rerun_with_note"].includes(action.kind)) {
      assert.equal(typeof action.step, "number", `${page.slug}: ${action.kind} needs a step`);
    }
  }
  if (page.state === "laeuft") assert.equal(review.actions.length, 0);
  for (const f of review.findings) {
    if (f.block_id) assert.ok(extractContentBlocks(review.html).some((b) => b.id === f.block_id));
  }
}
assert.equal(demoReview("gibt-es-nicht"), null);
assert.equal(demoQuestions().questions.length, 2);

const run = demoRunThrough({ pages: ["startseite", "kellerentruempelung", "messie-wohnung"] });
assert.deepEqual(run.jobs.map((j) => j.slug), ["messie-wohnung"]);
assert.deepEqual(run.skipped.map((s) => s.page), ["Startseite", "Kellerentrümpelung"]);

const put = demoPutClient("org", { anbieter: { name: "X", branche: "" } });
assert.equal(put.complete, false);
assert.deepEqual(put.problems, ["Anbieter: Branche fehlt."]);

assert.match(demoExport("startseite", "html")!.body, /^<!DOCTYPE html>/);
assert.equal(demoExport("startseite", "md")!.filename, "startseite.md");
assert.equal(demoExport("messie-wohnung", "html"), null, "no text yet → no export");

console.log("OK: content-mapping tests passed");
