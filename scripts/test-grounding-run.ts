/**
 * Grounding agent (Hub + Entitätsseiten in vier Schritten): step order, output normalisers,
 * halting rules, llms.txt.
 * Run: npx tsx scripts/test-grounding-run.ts
 */
import assert from "node:assert/strict";

import {
  buildGroundingLlmsTxt,
  groundingStepSpec,
  normalizeGroundingFacts,
  normalizeGroundingHtml,
  normalizeGroundingQuestions,
  type GroundingRunContext,
} from "../lib/dt/seo/grounding-run/prompts";
import { groundingStepPatchFor } from "../lib/dt/seo/grounding-run/step-patch";
import {
  GROUNDING_STEP_COUNT,
  groundingStepLabel,
  nextGroundingStep,
  runningGroundingDetail,
} from "../lib/dt/seo/grounding-run/steps";

// --- steps --------------------------------------------------------------------------------
assert.equal(GROUNDING_STEP_COUNT, 4);
assert.equal(nextGroundingStep([]), 1);
assert.equal(nextGroundingStep([{ step: 1, status: "done" }]), 2);
assert.equal(nextGroundingStep([{ step: 1, status: "done" }, { step: 2, status: "waiting" }]), 2);
assert.equal(
  nextGroundingStep([1, 2, 3, 4].map((step) => ({ step, status: "done" }))),
  null,
);
assert.equal(groundingStepLabel(3), "Schritt 3 von 4: Seite bauen");
assert.equal(runningGroundingDetail(1, [{ step: 1, status: "done" }]), "Schritt 2 von 4: Faktencheck startet");
assert.equal(runningGroundingDetail(3, [{ step: 3, status: "running" }]), "Schritt 3 von 4: Seite bauen läuft");

// --- normalisers ----------------------------------------------------------------------------
const hubPage = { page: { kind: "hub" as const, entityName: "Existenzstand", slug: null, url: "https://existenzstand.de/grounding/", schemaType: null } };
const facts = normalizeGroundingFacts(
  {
    entity: { name: "", schema_type: "", definition: "Existenzstand ist eine Beratung.", placement: "Hamburg", distinction: ["Kein Steuerberater."] },
    classification: { entity_type: "Beratung" },
    core_facts: [{ label: "Sitz", value: "Hamburg", source: "Impressum", as_of: "" }, { label: "", value: "x" }],
    sections: [{ heading: "Leistungen von Existenzstand", paragraphs: ["AVGS-Beratung."], sources: [] }],
    faq: [],
    sources: [],
    related: [],
    open_questions: [{ question: "Rechtsform?", why: "Nur im Impressum", blocking: true }],
    entity_candidates: [{ name: "AVGS-Beratung", schema_type: "Service", reason: "Nachfrage", url: "https://existenzstand.de/grounding/avgs/", priority: "sehr hoch" }],
  },
  hubPage,
);
assert.equal(facts.entity.name, "Existenzstand");
assert.equal(facts.entity.schema_type, "Organization");
assert.equal(facts.core_facts.length, 1);
assert.equal(facts.core_facts[0]?.as_of, null);
assert.equal(facts.entity_candidates.length, 1);
assert.equal(facts.entity_candidates[0]?.priority, "mittel");
const entityFacts = normalizeGroundingFacts({ entity_candidates: [{ name: "x" }] }, { page: { ...hubPage.page, kind: "entity" } });
assert.equal(entityFacts.entity_candidates.length, 0);

assert.equal(normalizeGroundingHtml("<p>nur ein Fragment</p>"), null);
assert.equal(normalizeGroundingHtml("<!doctype html><html lang=\"de\"><head></head><body></body></html>")?.startsWith("<!doctype"), true);
assert.equal(normalizeGroundingHtml("<html>" + "x".repeat(70_000) + "</html>"), null);

const questions = normalizeGroundingQuestions([{ question: "Gründungsjahr?", why: "", placeholder: "2019", blocking: "yes" }, { question: "" }]);
assert.equal(questions.length, 1);
assert.equal(questions[0]?.blocking, false);

// --- halting rules --------------------------------------------------------------------------
const blocked = groundingStepPatchFor(2, { findings: [], questions: [{ question: "?", why: "", placeholder: "", blocking: true }], summary: "" }, { html: null });
assert.equal(blocked.halted, true);
assert.equal(blocked.pagePatch.run_state, "braucht_sie");
const open = groundingStepPatchFor(2, { findings: [], questions: [{ question: "?", why: "", placeholder: "", blocking: false }], summary: "" }, { html: null });
assert.equal(open.halted, false);
assert.equal(open.pagePatch.run_state, undefined);
assert.throws(() => groundingStepPatchFor(3, { html: "", title: "", meta_description: "", schema_type: "" }, { html: null }));
const finished = groundingStepPatchFor(4, { ok: true, issues: [], corrected_html: null, summary: "ok" }, { html: "<!doctype html><html></html>" });
assert.equal(finished.halted, true);
assert.equal(finished.pagePatch.run_state, "fertig");
assert.equal(finished.pagePatch.standard_version, "1.6");
assert.equal(finished.pagePatch.review_status, "draft");

// --- prompts carry the sources and the rules ----------------------------------------------
const context: GroundingRunContext = {
  organisationName: "Existenzstand",
  websiteUrl: "https://existenzstand.de",
  page: hubPage.page,
  hub: null,
  siblings: [],
  anbieterSections: [{ key: "leistungen", label: "Leistungen", current: "AVGS-Beratung für Gründer." }],
  onboardingText: "",
  wunschkundenText: "",
  sitePages: [{ url: "https://existenzstand.de/", title: "Start", text: "Existenzstand berät Gründer in Hamburg." }],
  livePageText: null,
  notes: ["1. GmbH, gegründet 2019."],
  outputs: { 1: facts },
  html: null,
  today: "2026-10-13",
};
const spec1 = groundingStepSpec(1, context);
assert.ok(spec1.user.includes("AVGS-Beratung für Gründer."));
assert.ok(spec1.user.includes("Antworten und Anmerkungen der Redaktion"));
assert.ok(spec1.system.includes("entity_candidates"));
const spec3 = groundingStepSpec(3, context);
assert.ok(spec3.system.includes("Grounding Page Standard v1.6"));
assert.ok(spec3.system.includes('<link rel="canonical" href="https://existenzstand.de/grounding/">'));
assert.ok(spec3.user.includes("Faktenbasis (Schritt 1)"));
assert.throws(() => groundingStepSpec(9, context));

// --- llms.txt ------------------------------------------------------------------------------
const llms = buildGroundingLlmsTxt({
  organisationName: "Existenzstand",
  websiteUrl: "https://existenzstand.de",
  pages: [
    { kind: "entity", name: "AVGS-Beratung", url: "https://existenzstand.de/grounding/avgs/", description: "Beratung." },
    { kind: "hub", name: "Existenzstand", url: "https://existenzstand.de/grounding/", description: "Gründungsberatung in Hamburg." },
  ],
});
assert.ok(llms.startsWith("# Existenzstand\n\n> Gründungsberatung in Hamburg."));
assert.ok(llms.indexOf("grounding/)") < llms.indexOf("grounding/avgs/"));

console.log("grounding-run tests: ok");
