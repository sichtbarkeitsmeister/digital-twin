/**
 * Tests for the Content-Agent mapping, presentation helpers and demo fixtures.
 * Run: npx tsx scripts/test-content-mapping.ts
 */
import assert from "node:assert/strict";

import {
  DEMO_WORKSHOP_ANBIETER,
  demoExport,
  demoOverview,
  demoPutClient,
  demoQuestions,
  demoReadiness,
  demoReview,
  demoRunThrough,
} from "../lib/dt/content/fixtures";
import {
  anbieterFromWorkshop,
  avatarFromAgent,
  CONTENT_TONALITAETEN,
  cleanTextSettings,
  contentClientKey,
  contentTonalitaetText,
  filledWorkshopSections,
  mergeContentAnbieter,
  parseWordList,
  suggestTextSettings,
  type WorkshopAnbieterSection,
} from "../lib/dt/content/mapping";
import {
  anyContentPageRunning,
  contentActionLabel,
  contentStateMeta,
  extractContentBlocks,
} from "../lib/dt/content/presentation";
import { normalizeAnbieterItems } from "../lib/dt/transcripts/workshop-model";

const sections = (texts: Record<string, string>): WorkshopAnbieterSection[] =>
  normalizeAnbieterItems([]).map((item) => ({
    key: item.key,
    label: item.label,
    current: texts[item.key] ?? "",
  }));

// --- anbieterFromWorkshop -------------------------------------------------------------------
assert.equal(DEMO_WORKSHOP_ANBIETER.length, normalizeAnbieterItems([]).length, "fixture has all 13 sections");
assert.deepEqual(
  DEMO_WORKSHOP_ANBIETER.map((s) => s.key),
  normalizeAnbieterItems([]).map((s) => s.key),
  "fixture keys follow ANBIETER_POINTS",
);
assert.equal(filledWorkshopSections(DEMO_WORKSHOP_ANBIETER), 11);

const anbieter = anbieterFromWorkshop(DEMO_WORKSHOP_ANBIETER, { organisationName: "  Einfach Entrümpelung " });
assert.equal(anbieter.name, "Einfach Entrümpelung");
assert.match(anbieter.unternehmen!, /^Einfach Entrümpelung ist ein Familienbetrieb/);
assert.match(anbieter.leistungen!, /Haushaltsauflösung/);
assert.match(anbieter.sprache!, /gesiezt/);
assert.equal("wettbewerb" in anbieter, false, "empty sections are left out");
assert.equal("ziele" in anbieter, false);
assert.equal(Object.keys(anbieter).length, 12, "name + 11 filled sections");

const guarded = anbieterFromWorkshop(
  [
    { key: "name", label: "x", current: "überschreibt nicht" },
    { key: "branche", label: "x", current: "auch nicht" },
    { key: "Böse Taste", label: "x", current: "ungültiger Schlüssel" },
    { key: "werte", label: "Werte", current: "  Ehrlich. " },
    { key: "werte", label: "Werte", current: "Pünktlich." },
  ],
  { organisationName: "Muster GmbH" },
);
assert.deepEqual(guarded, { name: "Muster GmbH", werte: "Ehrlich.\n\nPünktlich." });
assert.deepEqual(anbieterFromWorkshop([], { organisationName: "" }), { name: "" });

// --- suggestTextSettings: heuristics over "sprache" and "unternehmen" ------------------------
const demo = suggestTextSettings(DEMO_WORKSHOP_ANBIETER);
assert.equal(demo.settings.anrede, "Sie");
assert.equal(demo.reasons.anrede, "„gesiezt“ in „Sprache & Ton“");
assert.equal(demo.settings.branche, "handwerk");
assert.equal(demo.reasons.branche, undefined, "handwerk is the default, not a finding");
assert.equal(demo.settings.tonalitaet, "herzlich", "ehrlich + bodenständig beat the single ruhig");
assert.equal(demo.reasons.tonalitaet, "„ehrlich“, „bodenständig“ in „Sprache & Ton“");
assert.deepEqual(demo.settings.verbotene_woerter, ["Schrott", "Ramsch", "Messie"]);

// --- tone options: distinct, complete, and the heuristic lands on each of them --------------
assert.equal(new Set(CONTENT_TONALITAETEN.map((t) => t.key)).size, CONTENT_TONALITAETEN.length);
assert.equal(new Set(CONTENT_TONALITAETEN.map((t) => t.label)).size, CONTENT_TONALITAETEN.length);
for (const tone of CONTENT_TONALITAETEN) {
  assert.ok(tone.text.length > 40 && tone.short.length > 10, `${tone.key}: has texts`);
  assert.match(contentTonalitaetText(tone.key), new RegExp(`^${tone.label.replace(/[&]/g, "&")}: `));
}
const toneCases: Array<[string, string]> = [
  ["Bitte nüchtern und fachlich, keine Werbesprache.", "sachlich"],
  ["Seriös, kompetent, Vertrauen aufbauen.", "serioes"],
  ["Warm und nahbar, wie der Betrieb nebenan.", "herzlich"],
  ["Kurz, klar, auf den Punkt. Keine Floskeln.", "direkt"],
  ["Gern locker und mit Humor, ein Augenzwinkern darf sein.", "locker"],
  ["Behutsam und respektvoll, die Kunden sind in einer schweren Lage.", "einfuehlsam"],
  ["Hochwertig und exklusiv, wir sprechen anspruchsvolle Kunden an.", "premium"],
  ["Lebendig, motivierend, mit Begeisterung für den Sport.", "energisch"],
];
for (const [text, expected] of toneCases) {
  assert.equal(suggestTextSettings(sections({ sprache: text })).settings.tonalitaet, expected, text);
}
assert.equal(
  suggestTextSettings(sections({ sprache: "Bitte nicht locker und ohne Humor. Lieber sachlich." })).settings.tonalitaet,
  "sachlich",
  "negated words do not score",
);
assert.equal(
  suggestTextSettings(sections({ sprache: "Kunden mögen das Wort „locker“ nicht. Ruhig und respektvoll." })).settings.tonalitaet,
  "einfuehlsam",
  "quoted words do not score",
);

const du = suggestTextSettings(
  sections({ sprache: "Wir duzen unsere Kunden. Locker und witzig, wie unter Nachbarn. Bitte nie „Sie“ oder „Kunde“ schreiben." }),
);
assert.equal(du.settings.anrede, "Du");
assert.equal(du.settings.tonalitaet, "locker");
assert.deepEqual(du.settings.verbotene_woerter, ["Kunde"], "Du/Sie are never forbidden words");

const looseDu = suggestTextSettings(sections({ sprache: "Anrede immer mit du, auch in E-Mails." }));
assert.equal(looseDu.settings.anrede, "Du");

const both = suggestTextSettings(sections({ sprache: "Früher wurde geduzt, inzwischen wird gesiezt." }));
assert.equal(both.settings.anrede, "Sie", "conflicting hints fall back to Sie");
assert.equal(both.reasons.anrede, undefined);

const law = suggestTextSettings(sections({ unternehmen: "Kanzlei Weber & Partner, Fachanwälte für Arbeitsrecht in Köln." }));
assert.equal(law.settings.branche, "rechtsanwalt");
assert.equal(law.reasons.branche, "„Kanzlei“ in „Unternehmen & Kern“");
assert.equal(suggestTextSettings(sections({ unternehmen: "Rechtsanwältin Dr. Kaya" })).settings.branche, "rechtsanwalt");

const doctor = suggestTextSettings(sections({ unternehmen: "Zahnarztpraxis Dr. Lenz in Essen, 3 Behandlungsräume." }));
assert.equal(doctor.settings.branche, "arzt");
assert.equal(suggestTextSettings(sections({ unternehmen: "Physiotherapie-Praxis am Markt" })).settings.branche, "arzt");
assert.equal(suggestTextSettings(sections({ unternehmen: "Hausärztin mit eigener Praxis" })).settings.branche, "arzt");
assert.equal(
  suggestTextSettings(sections({ unternehmen: "Malerbetrieb. In der Praxis zeigt sich: Kunden wollen Festpreise." })).settings.branche,
  "handwerk",
  "the idiom „in der Praxis“ is not a medical practice",
);
assert.equal(suggestTextSettings(sections({ unternehmen: "Notarztdienst-Zulieferer" })).settings.branche, "arzt");

const empty = suggestTextSettings(sections({}));
assert.deepEqual(empty.settings, { anrede: "Sie", branche: "handwerk", tonalitaet: "herzlich", verbotene_woerter: [] });
assert.deepEqual(empty.reasons, {});
assert.equal(suggestTextSettings(sections({ unternehmen: "Kanzlei Weber" })).settings.tonalitaet, "serioes", "branch default");
assert.equal(suggestTextSettings(sections({ unternehmen: "Zahnarztpraxis" })).settings.tonalitaet, "einfuehlsam", "branch default");
assert.deepEqual(suggestTextSettings([]).settings, empty.settings);

// --- settings input and merge -----------------------------------------------------------------
assert.deepEqual(parseWordList(" Schrott, „Ramsch“;\n billig ,schrott,, "), ["Schrott", "Ramsch", "billig"]);
assert.deepEqual(
  cleanTextSettings({ anrede: "Du", branche: "zahnarzt" as never, tonalitaet: "egal" as never, verbotene_woerter: [" a ", "A", ""] }),
  { anrede: "Du", branche: "handwerk", tonalitaet: "herzlich", verbotene_woerter: ["a"] },
  "unknown tone falls back to the branch default",
);

const merged = mergeContentAnbieter(
  { ...anbieter, anrede: "aus Text", tonalitaet: "aus Text" } as typeof anbieter,
  { anrede: "Sie", branche: "handwerk", tonalitaet: "direkt", verbotene_woerter: ["Schrott"] },
);
assert.equal(merged.name, "Einfach Entrümpelung");
assert.equal(merged.unternehmen, anbieter.unternehmen);
assert.equal(merged.anrede, "Sie", "confirmed settings win");
assert.equal(merged.tonalitaet, contentTonalitaetText("direkt"));
assert.match(merged.tonalitaet, /^Direkt & unkompliziert: Kurz und klar\./, "the service receives the full tone text");
assert.deepEqual(merged.verbotene_woerter, ["Schrott"]);

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

const put = demoPutClient("org", { anbieter: { name: "X", anrede: "Ihr", branche: "" } });
assert.equal(put.complete, false);
assert.deepEqual(put.problems, ["Anbieter: Anrede muss „Sie“ oder „Du“ sein.", "Anbieter: Branche fehlt."]);
const putOk = demoPutClient("org", { anbieter: merged, avatar });
assert.equal(putOk.complete, true);
assert.deepEqual(putOk.problems, []);

assert.match(demoExport("startseite", "html")!.body, /^<!DOCTYPE html>/);
assert.equal(demoExport("startseite", "md")!.filename, "startseite.md");
assert.equal(demoExport("messie-wohnung", "html"), null, "no text yet → no export");

console.log("OK: content-mapping tests passed");
