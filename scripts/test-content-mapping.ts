/**
 * Tests for the content pipeline's pure parts: mapping, rendering, presentation,
 * state → actions, model config and pricing. Run: npm run test:content-mapping
 */
import assert from "node:assert/strict";

import {
  anbieterFromWorkshop,
  avatarFromAgent,
  CONTENT_TONALITAETEN,
  cleanTextSettings,
  contentTonalitaetText,
  filledWorkshopSections,
  fragebogenSections,
  mergeAnbieterSections,
  mergeContentAnbieter,
  parseWordList,
  sectionsForSuggestion,
  suggestTextSettings,
  type ContentFragebogenFact,
  type WorkshopAnbieterSection,
} from "../lib/dt/content/mapping";
import { describeAnbieterSources, readinessFromLocal } from "../lib/dt/content/route-helpers";
import {
  CONTENT_API_KEY_ENV,
  CONTENT_MODEL_ENV,
  DEFAULT_CONTENT_MODEL,
  resolveContentApiKey,
  resolveContentModels,
} from "../lib/dt/content/model-config";
import { normalizeFindings, normalizeQuestions } from "../lib/dt/content/pipeline/prompts";
import { CONTENT_STEPS } from "../lib/dt/content/pipeline/steps";
import {
  anyContentPageRunning,
  contentActionLabel,
  contentStateMeta,
  extractContentBlocks,
} from "../lib/dt/content/presentation";
import { estimateCostEur, priceForModel } from "../lib/dt/content/pricing";
import {
  htmlToMarkdown,
  normalizeBlocks,
  parseBlocksFromHtml,
  renderBlocksHtml,
  replaceBlockText,
  sanitizeBlockHtml,
  slugify,
} from "../lib/dt/content/render";
import {
  buildOverview,
  buildReview,
  flattenStructure,
  pageActions,
  pageSummary,
  rerunStepFor,
  type ContentPageRow,
  type ContentStepRow,
} from "../lib/dt/content/store";
import { normalizeAnbieterItems } from "../lib/dt/transcripts/workshop-model";

/** Workshop sections as `dt_workshop_corpus.anbieter` holds them (11 of 13 filled). */
const DEMO_WORKSHOP_ANBIETER: WorkshopAnbieterSection[] = [
  {
    key: "unternehmen",
    label: "Unternehmen & Kern",
    current:
      "Einfach Entrümpelung ist ein Familienbetrieb aus Düsseldorf mit 14 Mitarbeitenden. Kern ist die Räumung von Wohnungen, Häusern und Kellern zum Festpreis.",
  },
  { key: "gruendung", label: "Gründungsgeschichte", current: "2012 von Markus Brandt gegründet." },
  { key: "leistungen", label: "Leistungen & Schwerpunkte", current: "Haushaltsauflösung, Kellerentrümpelung, Gewerbe." },
  { key: "ablauf", label: "Ablauf & Mitwirkung", current: "Kostenlose Besichtigung, Festpreis innerhalb von 24 Stunden." },
  { key: "alleinstellung", label: "Alleinstellung", current: "Verbindlicher Festpreis ohne Nachforderungen." },
  { key: "wettbewerb", label: "Wettbewerb", current: "" },
  { key: "team", label: "Team & Partner", current: "Feste Teams, keine Subunternehmer." },
  { key: "werte", label: "Werte & Haltung", current: "Respekt vor der Lebensgeschichte in jeder Wohnung." },
  { key: "beweise", label: "Beweise & Erfolge", current: "Über 1.800 Aufträge laut Inhaber. 4,9 Sterne bei Google." },
  {
    key: "sprache",
    label: "Sprache & Ton",
    current:
      "Kunden werden gesiezt, auch in Social Media. Der Ton soll ruhig, ehrlich und bodenständig klingen, nie flapsig. Wörter wie „Schrott“, „Ramsch“ oder „Messie“ sollen nicht vorkommen.",
  },
  { key: "preis", label: "Preis & Positionierung", current: "Mittleres Preissegment, Festpreis nach Besichtigung." },
  { key: "kanaele", label: "Anfragen & Kanäle", current: "Die meisten Anfragen kommen per Telefon und WhatsApp." },
  { key: "ziele", label: "Ziele & Weiterentwicklung", current: "" },
];

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

// --- render: blocks ⇄ HTML, sanitizing, edits, markdown ------------------------------------
assert.equal(slugify("Über uns & Team!"), "ueber-uns-team");
assert.equal(
  sanitizeBlockHtml('<p onclick="x()">Hi <script>evil()</script><a href="javascript:alert(1)">x</a> <a href="https://a.de">ok</a><div>d</div></p>'),
  '<p>Hi <a>x</a> <a href="https://a.de">ok</a>d</p>',
);
const normalized = normalizeBlocks([
  { id: "Intro", heading: "Entrümpelung Düsseldorf", level: 1, html: "<p>Hallo</p>" },
  { id: "intro", heading: "Ablauf", level: 2, text: "Erst A.\n\nDann B." },
  { id: "", heading: "", level: 2, html: "" },
  { heading: "FAQ", level: 7, html: "<ul><li>Q</li></ul>" },
]);
assert.deepEqual(normalized.map((b) => [b.id, b.level]), [["intro", 1], ["intro-2", 2], ["faq", 2]]);
assert.equal(normalized[1]!.html, "<p>Erst A.</p>\n<p>Dann B.</p>");
const html = renderBlocksHtml(normalized);
assert.match(html, /^<section data-block-id="intro"><h1>Entrümpelung Düsseldorf<\/h1>\n<p>Hallo<\/p><\/section>/);
assert.deepEqual(parseBlocksFromHtml(html), normalized, "render → parse round-trips");
assert.deepEqual(extractContentBlocks(html).map((b) => b.id), ["intro", "intro-2", "faq"], "drawer sees the same blocks");

const edited = replaceBlockText(html, "intro-2", "Ablauf\nNur noch ein Satz.\n\nUnd <b>kein</b> HTML.")!;
assert.match(edited, /<h2>Ablauf<\/h2>\n<p>Nur noch ein Satz.<\/p>\n<p>Und &lt;b&gt;kein&lt;\/b&gt; HTML.<\/p>/, "heading kept once, text escaped");
assert.equal(replaceBlockText(html, "nope", "x"), null);
assert.equal(
  htmlToMarkdown(html),
  "# Entrümpelung Düsseldorf\n\nHallo\n\n## Ablauf\n\nErst A.\n\nDann B.\n\n## FAQ\n\n- Q",
);
assert.equal(htmlToMarkdown("<ol><li>eins</li><li>zwei</li></ol><p><strong>fett</strong> &amp; <em>kursiv</em></p>"), "1. eins\n2. zwei\n\n**fett** & *kursiv*");

// --- prompts: findings and questions from LLM JSON ------------------------------------------
const ids = new Set(["intro", "faq"]);
assert.deepEqual(normalizeFindings([{ title: "Zahl", problem: "unbelegt", proposal: "streichen", severity: "high", block_id: "intro" }, { severity: "low" }, { problem: "x", severity: "weird", block_id: "nope" }], ids), [
  { title: "Zahl", problem: "unbelegt", proposal: "streichen", severity: "high", severity_label: "Wichtig", block_id: "intro" },
  { title: "x", problem: "x", proposal: "", severity: "medium", severity_label: "Mittel", block_id: null },
]);
const questions = normalizeQuestions([{ question: "Stimmt 1.800?", blocking: true, block_id: "faq", kind: "fact" }, { question: "Egal", blocking: false, kind: "other" }, { kind: "fact" }], ids);
assert.equal(questions.length, 2);
assert.deepEqual(questions.map((q) => [q.blocking, q.block_id, q.kind]), [[true, "faq", "fact"], [false, null, "fact"]]);

// --- store: pages from the structure, state → label/actions ---------------------------------
assert.equal(CONTENT_STEPS.length, 8);
const flat = flattenStructure([
  { label: "Startseite", path: "/", children: [{ label: "Leistungen", path: "/leistungen", children: [{ label: "Keller", path: "/leistungen/keller", children: [] }] }] },
  { label: "Über uns", children: [] },
  { label: "Über uns", children: [] },
]);
assert.deepEqual(flat.map((p) => [p.slug, p.level, p.position]), [["startseite", 0, 0], ["leistungen", 1, 1], ["keller", 2, 2], ["ueber-uns", 0, 3], ["ueber-uns-2", 0, 4]]);

const base: ContentPageRow = {
  id: "p1", organisation_id: "o1", slug: "keller", name: "Keller", path: "/keller", level: 1, position: 0, main_keyword: null,
  state: "nicht_begonnen", step: null, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], error: null, job_id: null, cost_eur: "0", started_by: null,
  created_at: "2026-10-06T10:00:00Z", updated_at: "2026-10-06T10:00:00Z",
};
const q = questions[0]!;
const cases: Array<[Partial<ContentPageRow>, string[], string | null]> = [
  [{}, ["run_through"], null],
  [{ state: "laeuft", step: 3 }, [], "Schritt 3 von 8: Rohtext läuft"],
  [{ state: "braucht_sie", step: 4, html, questions: [q] }, ["approve", "edit", "rerun_with_note", "export"], "1 Frage an den Kunden, bevor es weitergeht"],
  [{ state: "in_arbeit", step: 3, error: "Ratenlimit" }, ["run_through", "rerun_with_note"], "Fehler in Schritt 3: Ratenlimit"],
  [{ state: "in_arbeit", step: 5, html }, ["run_through", "edit", "rerun_with_note", "export"], "Pausiert nach Schritt 5: Tonalität & Avatar"],
  [{ state: "fertig", step: 8, html }, ["approve", "edit", "rerun_with_note", "export"], "Wartet auf Freigabe"],
  [{ state: "fertig", step: 8, html, released: true }, ["export"], "Freigegeben"],
];
for (const [patch, kinds, detail] of cases) {
  const page = { ...base, ...patch };
  assert.deepEqual(pageActions(page).map((a) => a.kind), kinds, `${page.state}: actions`);
  assert.equal(pageSummary(page).detail, detail, `${page.state}: detail`);
  for (const action of pageActions(page)) {
    assert.ok(contentActionLabel(action.kind));
    if (["approve", "edit", "rerun_with_note"].includes(action.kind)) assert.equal(typeof action.step, "number");
  }
}
assert.equal(rerunStepFor({ ...base, state: "braucht_sie", step: 4 }), 4);
assert.equal(rerunStepFor({ ...base, state: "fertig", step: 8 }), 7);
assert.equal(rerunStepFor({ ...base, state: "in_arbeit", step: 6 }), 6);
assert.equal(pageSummary({ ...base, cost_eur: "1.2345" }).cost, "1,23\u00a0€");
assert.equal(pageSummary(base).updated_at, null, "not started → no date");

const steps: ContentStepRow[] = [1, 2, 3].map((step) => ({
  id: `s${step}`, page_id: "p1", organisation_id: "o1", step, name: CONTENT_STEPS[step - 1]!.name, status: "done", output: {},
  model: "claude-sonnet-4-6", input_tokens: 1000, output_tokens: 500, cost_eur: "0.01", error: null, started_at: null, finished_at: null, approved_by: null, approved_at: null,
}));
const review = buildReview({ ...base, state: "braucht_sie", step: 4, html, markdown: htmlToMarkdown(html), questions: [q] }, [
  ...steps,
  { ...steps[0]!, id: "s4", step: 4, name: "Faktencheck", status: "waiting" },
]);
assert.equal(review.steps.length, 8);
assert.deepEqual(review.steps.map((s) => s.status), ["done", "done", "done", "waiting", "pending", "pending", "pending", "pending"]);
assert.equal(review.text_step, 3, "the text on screen comes from the Rohtext");
assert.equal(review.questions.length, 1);
assert.equal(review.public.cost, "0,00\u00a0€");

const overview = buildOverview({ ready: true, checks: [] }, [
  base,
  { ...base, id: "p2", slug: "a", state: "braucht_sie", questions: [q], cost_eur: "0.5" },
  { ...base, id: "p3", slug: "b", state: "laeuft", step: 2, cost_eur: 0.25 },
  { ...base, id: "p4", slug: "c", state: "fertig", released: true, cost_eur: "1" },
]);
assert.deepEqual([overview.needs_you, overview.running, overview.finished, overview.cost_eur, overview.cost], [1, 1, 1, 1.75, "1,75\u00a0€"]);
assert.equal(overview.pages[1]!.questions, 1);

// --- Anbieter-Fragebogen as fact source --------------------------------------------------------
const facts: ContentFragebogenFact[] = [
  { label: "Wie heißt Ihr Unternehmen?", stepTitle: "Unternehmen", value: "Kanzlei Berger & Partner" },
  { label: "Wie sprechen Sie Ihre Mandanten an?", stepTitle: "Sprache", value: "Wir siezen immer, seriös und ruhig." },
  { label: "Leer", stepTitle: "x", value: "   " },
  { label: "Preise", stepTitle: "Preise", value: "Erstgespräch 150 €" },
];
const fbSections = fragebogenSections(facts);
assert.deepEqual(
  fbSections.map((s) => [s.key, s.label]),
  [
    ["fragebogen_01", "Unternehmen – Wie heißt Ihr Unternehmen?"],
    ["fragebogen_02", "Sprache – Wie sprechen Sie Ihre Mandanten an?"],
    ["fragebogen_03", "Preise"],
  ],
  "empty answers dropped, step prefixed only when different",
);
const emptyWorkshop = normalizeAnbieterItems([]).map((i) => ({ key: i.key, label: i.label, current: i.current }));
const fbMerged = mergeAnbieterSections(emptyWorkshop, fbSections);
assert.equal(fbMerged.length, 3, "empty workshop sections are not sent");
assert.equal(
  mergeAnbieterSections(DEMO_WORKSHOP_ANBIETER, fbSections).length,
  filledWorkshopSections(DEMO_WORKSHOP_ANBIETER) + 3,
);
const fbAnbieter = anbieterFromWorkshop(fbMerged, { organisationName: "Berger" });
assert.equal(fbAnbieter.fragebogen_02, "Wir siezen immer, seriös und ruhig.", "fragebogen keys pass the section filter");
const fbSuggestion = suggestTextSettings(sectionsForSuggestion(emptyWorkshop, facts));
assert.equal(fbSuggestion.settings.branche, "rechtsanwalt", "branche from Fragebogen answers");
assert.equal(fbSuggestion.settings.anrede, "Sie");
assert.equal(fbSuggestion.settings.tonalitaet, "serioes");
assert.match(fbSuggestion.reasons.branche ?? "", /Anbieter-Fragebogen/);
const workshopWins = sectionsForSuggestion(DEMO_WORKSHOP_ANBIETER, facts);
assert.equal(workshopWins.find((s) => s.key === "unternehmen")?.current, DEMO_WORKSHOP_ANBIETER.find((s) => s.key === "unternehmen")?.current, "filled workshop text is kept");
assert.deepEqual(sectionsForSuggestion(DEMO_WORKSHOP_ANBIETER, []), DEMO_WORKSHOP_ANBIETER);

assert.equal(describeAnbieterSources(null), null);
assert.equal(describeAnbieterSources({ workshop: null, fragebogen: { title: "Anbieter 2026", facts: 1 } }), "1 Antwort aus dem Anbieter-Fragebogen „Anbieter 2026“");
assert.equal(
  describeAnbieterSources({ workshop: { filled: 11, total: 13 }, fragebogen: { title: "A", facts: 24 } }),
  "11 von 13 Abschnitten aus den Gesprächen · 24 Antworten aus dem Anbieter-Fragebogen „A“",
);
const readyFb = readinessFromLocal({ anbieter: { workshop: null, fragebogen: { title: "A", facts: 3 } }, avatarCount: 1, structure: { filename: "s.xlsx" } });
assert.equal(readyFb.ready, true, "Fragebogen alone satisfies the Anbieter check");
assert.equal(readinessFromLocal({ anbieter: null, avatarCount: 1, structure: { filename: null } }).checks[0]!.ok, false);

// --- model config and pricing -----------------------------------------------------------------
const defaults = resolveContentModels({}, {});
assert.equal(defaults.write[0], DEFAULT_CONTENT_MODEL);
assert.deepEqual(defaults.check, defaults.write, "check tier follows write tier unless set");
assert.deepEqual(defaults.source, { write: "default", check: "default" });
const fromEnv = resolveContentModels({}, { [CONTENT_MODEL_ENV.write]: " claude-opus-4-6 ", [CONTENT_MODEL_ENV.check]: "claude-haiku-4-5" });
assert.equal(fromEnv.write[0], "claude-opus-4-6");
assert.equal(fromEnv.check[0], "claude-haiku-4-5");
assert.deepEqual(fromEnv.source, { write: "env", check: "env" });
assert.ok(fromEnv.write.includes(DEFAULT_CONTENT_MODEL), "default stays as fallback");
const fromDb = resolveContentModels({ write: "claude-sonnet-4-6", check: null }, { [CONTENT_MODEL_ENV.write]: "claude-opus-4-6" });
assert.equal(fromDb.write[0], "claude-sonnet-4-6", "app_settings beats env");
assert.equal(fromDb.check[0], "claude-sonnet-4-6");
assert.deepEqual(fromDb.source, { write: "app_settings", check: "app_settings" });
assert.equal(new Set(fromDb.write).size, fromDb.write.length, "no duplicate candidates");

assert.deepEqual([priceForModel("claude-sonnet-4-6").inputUsd, priceForModel("claude-haiku-4-5-20251001").inputUsd, priceForModel("claude-opus-4-1").inputUsd, priceForModel("claude-opus-4-6").inputUsd, priceForModel(null).inputUsd], [3, 1, 15, 5, 3]);
assert.equal(estimateCostEur("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, 1), 3);
assert.equal(estimateCostEur("claude-sonnet-4-6", { inputTokens: 10_000, outputTokens: 2_000 }, 0.92), 0.0552);
assert.equal(estimateCostEur("claude-haiku-4-5", { inputTokens: 0, outputTokens: 0 }), 0);
assert.equal(resolveContentApiKey({}), null, "Texte does not fall back to ANTHROPIC_API_KEY");
assert.equal(resolveContentApiKey({ ANTHROPIC_API_KEY: "shared", [CONTENT_API_KEY_ENV]: "  content-key  " }), "content-key");

console.log("OK: content tests passed");
