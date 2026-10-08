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
import {
  cleanCrawledTitle,
  isRedirectedCrawlPage,
  pageNameFromCrawl,
  planCrawlContentPages,
  sameContentPath,
  type CrawledSitePage,
} from "../lib/dt/content/crawl-pages";
import {
  describeRunningPage,
  interruptedStepMessage,
  judgeContentJob,
  type ContentJobState,
} from "../lib/dt/content/job-state";
import { CONTENT_JOB_GONE_MESSAGE, planContentPageRepairs } from "../lib/dt/content/pipeline/health";
import { describeAnbieterSources, describeSeiten, readinessFromLocal } from "../lib/dt/content/route-helpers";
import {
  CONTENT_API_KEY_ENV,
  CONTENT_MODEL_ENV,
  DEFAULT_CONTENT_MODEL,
  resolveContentApiKey,
  resolveContentModels,
} from "../lib/dt/content/model-config";
import { normalizeFindings, normalizeQuestions } from "../lib/dt/content/pipeline/prompts";
import { CONTENT_STEPS, nextContentStep } from "../lib/dt/content/pipeline/steps";
import { JOB_LOCK_TTL_MS, JOB_WORKER_BUDGET_MS, shouldClaimAnotherJob, stepBudgetMs } from "../lib/jobs/schedule";
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
  syncContentPagesFromCrawl,
  syncContentPagesFromStructure,
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
assert.equal(demo.reasons.branche, "„Entrümpelung“ in „Unternehmen & Kern“", "trade words are a finding, not a silent default");
assert.deepEqual(demo.unclear, []);
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
assert.deepEqual(empty.unclear, ["branche"], "no signal at all → the person has to pick");
assert.match(empty.reasons.branche ?? "", /^Branche unklar – in den Anbieterfakten steht nichts zur Branche/);
assert.deepEqual(Object.keys(empty.reasons), ["branche"]);

// Branche: every client section counts, specific words beat generic trade vocabulary, ties are flagged.
const mixed = suggestTextSettings(sections({ unternehmen: "Kanzlei am Markt. Unser Betrieb versteht sich als Dienstleister." }));
assert.deepEqual(mixed.unclear, ["branche"]);
assert.equal(mixed.settings.branche, "rechtsanwalt", "on a tie the specific branch is the placeholder");
assert.equal(
  mixed.reasons.branche,
  "Branche unklar – „Kanzlei“ (Unternehmen & Kern) spricht für Rechtsanwalt & Kanzlei, „Betrieb“ (Unternehmen & Kern) für Handwerk & Dienstleistung. Bitte manuell wählen.",
);
const clearLaw = suggestTextSettings(sections({ unternehmen: "Kanzlei am Markt für unsere Mandanten.", kanaele: "Kunden rufen meist an." }));
assert.equal(clearLaw.settings.branche, "rechtsanwalt");
assert.deepEqual(clearLaw.unclear, [], "a lead of two points is a finding despite a generic hit elsewhere");
const fromOtherSection = suggestTextSettings(sections({ unternehmen: "Wir sind ein kleines Team in Essen.", leistungen: "Physiotherapie für Patienten nach Sportverletzungen." }));
assert.equal(fromOtherSection.settings.branche, "arzt");
assert.equal(fromOtherSection.reasons.branche, "„Physiotherapie“ in „Leistungen & Schwerpunkte“", "not only „unternehmen“ is read");
const facts2: ContentFragebogenFact[] = [
  { label: "Wen behandeln Sie?", stepTitle: "Leistungen", value: "Patienten mit Rückenschmerzen, Physiotherapie und Reha." },
];
const fromFragebogen = suggestTextSettings(sectionsForSuggestion(sections({ unternehmen: "Wir sind ein kleines Team in Essen." }), facts2));
assert.equal(fromFragebogen.settings.branche, "arzt", "Fragebogen answers count even when the workshop has an unternehmen text");
assert.equal(fromFragebogen.reasons.branche, "„Patienten“ in „Anbieter-Fragebogen“");
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
  id: "p1", organisation_id: "o1", slug: "keller", name: "Keller", path: "/keller", level: 1, position: 0, source: "structure", source_url: null, crawled_at: null, main_keyword: null,
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
const betweenSteps = buildReview({ ...base, state: "laeuft", step: 2 }, [
  { ...steps[0]!, status: "done" },
  { ...steps[1]!, status: "done" },
]);
assert.equal(betweenSteps.public.detail, "Schritt 3 von 8 startet: Rohtext");
assert.equal(nextContentStep([{ step: 1, status: "done" }, { step: 2, status: "done" }]), 3);
assert.equal(nextContentStep([{ step: 1, status: "done" }, { step: 2, status: "running" }]), 2);
const tickStart = 1_000_000;
assert.equal(shouldClaimAnotherJob(tickStart, tickStart + JOB_WORKER_BUDGET_MS, 0, 5), true);
assert.equal(shouldClaimAnotherJob(tickStart + JOB_WORKER_BUDGET_MS - 10_000, tickStart + JOB_WORKER_BUDGET_MS, 1, 5), false, "no second job when the tick is almost over");
assert.equal(stepBudgetMs(tickStart, tickStart + 240_000, 150_000), 225_000);
assert.equal(stepBudgetMs(tickStart, tickStart + 100_000, 150_000), null, "Rohtext waits for a tick that can finish it");

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
const noCrawl = { websiteUrl: null, pageCount: 0, lastCrawledAt: null };
const readyFb = readinessFromLocal({
  anbieter: { workshop: null, fragebogen: { title: "A", facts: 3 } },
  avatarCount: 1,
  structure: { filename: "s.xlsx", uploadedAt: "2026-03-01T00:00:00Z", nodeCount: 4 },
  crawl: noCrawl,
  pages: { total: 4, structure: 4, crawl: 0 },
});
assert.equal(readyFb.ready, true, "Fragebogen alone satisfies the Anbieter check");
assert.equal(readyFb.checks.find((c) => c.id === "structure")?.hint, "4 Seiten aus der Seitenstruktur „s.xlsx“.");
assert.equal(
  readinessFromLocal({ anbieter: null, avatarCount: 1, structure: null, crawl: noCrawl, pages: { total: 0, structure: 0, crawl: 0 } }).checks[0]!.ok,
  false,
);
const crawlLocal = {
  structure: null,
  crawl: { websiteUrl: "https://x.de", pageCount: 40, lastCrawledAt: "2026-10-07T10:00:00Z" },
  pages: { total: 12, structure: 0, crawl: 12 },
};
assert.deepEqual(describeSeiten(crawlLocal), { ok: true, hint: "12 Seiten aus dem Crawl (Stand 7.10.2026)." });
assert.deepEqual(
  describeSeiten({ ...crawlLocal, structure: { filename: "s.xlsx", uploadedAt: null, nodeCount: 3 }, pages: { total: 15, structure: 3, crawl: 12 } }),
  { ok: true, hint: "3 Seiten aus der Seitenstruktur „s.xlsx“ · 12 Seiten aus dem Crawl (Stand 7.10.2026)." },
  "both sources can feed the table at once",
);
const justUploaded = describeSeiten({ structure: { filename: "s.xlsx", uploadedAt: null, nodeCount: 3 }, crawl: noCrawl, pages: { total: 0, structure: 0, crawl: 0 } });
assert.equal(justUploaded.ok, true, "an upload counts before the table synced it");
assert.match(justUploaded.hint, /erscheinen beim nächsten Laden/);
const crawledOnly = describeSeiten({ ...crawlLocal, pages: { total: 0, structure: 0, crawl: 0 } });
assert.equal(crawledOnly.ok, false, "a crawl is not a page list until it is taken over");
assert.equal(crawledOnly.hint, "40 Seiten gecrawlt, aber noch nicht übernommen – unter „Seitenquelle“ auf „Seiten übernehmen“ klicken.");
const nothing = describeSeiten({ structure: null, crawl: noCrawl, pages: { total: 0, structure: 0, crawl: 0 } });
assert.equal(nothing.ok, false);
assert.match(nothing.hint, /Excel-Seitenstruktur hochladen/);
assert.match(nothing.hint, /Website crawlen/);
assert.doesNotMatch(nothing.hint, /eintragen/, "the typed list is gone");
assert.equal(
  describeSeiten({ structure: null, crawl: noCrawl, pages: { total: 2, structure: 2, crawl: 0 } }).hint,
  "2 Seiten in der Tabelle.",
  "rows without a structure file (older manual pages) are still pages",
);

// --- pages from the crawl of the live site ---------------------------------------------------
const crawledAt = "2026-10-07T10:00:00.000Z";
const site = (patch: Partial<CrawledSitePage> & { url: string }): CrawledSitePage => ({
  title: null, h1: null, text_content: "Text", is_excluded: false, crawled_at: crawledAt, final_url: null, ...patch,
});
assert.equal(cleanCrawledTitle("Dachsanierung | Müller Bedachungen"), "Dachsanierung");
assert.equal(cleanCrawledTitle("Kontakt – Müller Bedachungen GmbH"), "Kontakt");
assert.equal(cleanCrawledTitle("Müller Bedachungen"), "Müller Bedachungen");
assert.equal(cleanCrawledTitle("A – B"), "A – B", "a one-letter first part is not a title");
assert.equal(pageNameFromCrawl({ h1: "  Dach  sanieren ", title: "x | y" }, "/dach"), "Dach sanieren", "h1 wins");
assert.equal(pageNameFromCrawl({ h1: null, title: null }, "/leistungen/flach-dach"), "flach dach");
assert.equal(pageNameFromCrawl({ h1: null, title: null }, "/"), "Startseite");
assert.equal(isRedirectedCrawlPage({ url: "http://x.de/a", final_url: "https://www.x.de/a/" }), false, "scheme and www are the same page");
assert.equal(isRedirectedCrawlPage({ url: "https://x.de/alt", final_url: "https://x.de/neu" }), true);
assert.equal(isRedirectedCrawlPage({ url: "https://x.de/alt", final_url: null }), false);

const crawlPlan = planCrawlContentPages([], [
  site({ url: "https://x.de/leistungen/dach", h1: "Dachsanierung", title: "Dachsanierung | Firma" }),
  site({ url: "https://x.de/agb", title: "AGB", is_excluded: true }),
  site({ url: "https://x.de/alt", title: "Alt", final_url: "https://x.de/leistungen/dach" }),
  site({ url: "https://x.de/kaputt", text_content: null }),
  site({ url: "https://x.de/", title: "Start | Firma" }),
  site({ url: "http://www.x.de/", title: "Start (http)" }),
  site({ url: "https://x.de/leistungen", title: "Leistungen – Firma" }),
  site({ url: "https://x.de/kontakt/", title: "Kontakt" }),
  site({ url: "https://x.de/ueber-uns/kontakt", title: "Kontakt im Team" }),
]);
assert.deepEqual(
  crawlPlan.inserts.map((p) => [p.slug, p.name, p.path, p.level, p.position]),
  [
    ["startseite", "Start", "/", 0, 0],
    ["kontakt", "Kontakt", "/kontakt", 1, 1],
    ["leistungen", "Leistungen", "/leistungen", 1, 2],
    ["dach", "Dachsanierung", "/leistungen/dach", 2, 3],
    ["kontakt-2", "Kontakt im Team", "/ueber-uns/kontakt", 2, 4],
  ],
  "shallow first, then by path; brand suffix stripped; slug collisions get -2",
);
assert.equal(crawlPlan.inserts[0]!.source_url, "https://x.de/");
assert.equal(crawlPlan.inserts[0]!.crawled_at, crawledAt);
assert.deepEqual(crawlPlan.skipped, { excluded: 1, empty: 1, redirected: 1, duplicate: 1, over_limit: 0 });
assert.deepEqual(crawlPlan.attach, []);
const crawlPlan2 = planCrawlContentPages(
  [{ slug: "kontakt", position: 7, source_url: null }, { slug: "startseite", position: 0, source_url: "https://x.de/" }],
  [site({ url: "https://x.de/kontakt", title: "Kontakt" }), site({ url: "https://x.de/", title: "Start" }), site({ url: "https://x.de/neu", title: "Neu" })],
);
assert.deepEqual(crawlPlan2.attach, [{ slug: "kontakt", source_url: "https://x.de/kontakt", crawled_at: crawledAt }], "existing rows only get the URL, once");
assert.deepEqual(crawlPlan2.inserts.map((p) => [p.slug, p.position]), [["neu", 8]], "positions continue after the table");
const capped = planCrawlContentPages([{ slug: "a", position: 0 }], [site({ url: "https://x.de/b", title: "B" }), site({ url: "https://x.de/c", title: "C" })], { limit: 2 });
assert.deepEqual([capped.inserts.length, capped.skipped.over_limit], [1, 1]);
assert.equal(sameContentPath("/Kontakt/", "/kontakt"), true);
assert.equal(sameContentPath("https://x.de/kontakt", "/kontakt"), true);
assert.equal(sameContentPath(null, "/kontakt"), true, "a structure page without a path is matched by slug");
assert.equal(sameContentPath("/kontakt", "/ueber-uns/kontakt"), false);
const sameSlugOtherPath = planCrawlContentPages(
  [{ slug: "kontakt", path: "/kontakt", position: 0, source_url: null }],
  [site({ url: "https://x.de/ueber-uns/kontakt", title: "Kontakt im Team" })],
);
assert.deepEqual(sameSlugOtherPath.attach, [], "a different page with the same last segment is not linked");
assert.deepEqual(sameSlugOtherPath.inserts.map((p) => p.slug), ["kontakt-2"]);

// --- what a running page's job means ----------------------------------------------------------
const now = Date.parse("2026-10-08T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const jobRow = (patch: Partial<ContentJobState>): ContentJobState => ({
  id: "j1", status: "pending", run_after: iso(0), locked_at: null, last_error: null, attempts: 0, max_attempts: 3, ...patch,
});
assert.deepEqual(judgeContentJob(jobRow({ status: "running", locked_at: iso(-60_000) }), now), { kind: "running" });
assert.deepEqual(judgeContentJob(jobRow({ status: "running", locked_at: iso(-JOB_LOCK_TTL_MS - 1_000) }), now), { kind: "stale_lock", sinceMs: JOB_LOCK_TTL_MS + 1_000 });
assert.deepEqual(judgeContentJob(jobRow({ run_after: iso(90_000), attempts: 1, last_error: "Ratenlimit" }), now), { kind: "retry", inMs: 90_000, error: "Ratenlimit" });
assert.deepEqual(judgeContentJob(jobRow({ run_after: iso(-5_000) }), now), { kind: "queued", waitMs: 5_000, error: null });
assert.deepEqual(judgeContentJob(jobRow({ status: "dead", last_error: "Schlüssel" }), now), { kind: "gone", status: "dead", error: "Schlüssel" });
assert.deepEqual(judgeContentJob(jobRow({ status: "succeeded" }), now), { kind: "gone", status: "succeeded", error: null });
assert.deepEqual(judgeContentJob(null, now), { kind: "gone", status: null, error: null });

const runningSteps = [{ step: 1, status: "done" }, { step: 2, status: "done" }, { step: 3, status: "pending" }];
assert.equal(describeRunningPage({ step: 3, error: null }, null, null), "Schritt 3 von 8: Rohtext läuft", "no job info → old text");
assert.equal(describeRunningPage({ step: 2, error: null }, runningSteps, { kind: "running" }), "Schritt 3 von 8 startet: Rohtext");
assert.equal(describeRunningPage({ step: 3, error: null }, [{ step: 3, status: "running" }], { kind: "running" }), "Schritt 3 von 8: Rohtext läuft");
assert.equal(
  describeRunningPage({ step: 3, error: "Ratenlimit" }, runningSteps, { kind: "retry", inMs: 90_000, error: "Ratenlimit" }),
  "Schritt 3 von 8: Rohtext – erneuter Versuch in ca. 2 Min. (Ratenlimit)",
);
assert.equal(describeRunningPage({ step: 2, error: null }, runningSteps, { kind: "queued", waitMs: 5_000, error: null }), "Schritt 3 von 8: Rohtext startet gleich");
assert.equal(describeRunningPage({ step: null, error: null }, [], { kind: "queued", waitMs: 5_000, error: null }), "Schritt 1 von 8: Recherche startet gleich");
assert.match(describeRunningPage({ step: null, error: null }, [], { kind: "queued", waitMs: 200_000, error: null }), /^Wartet seit 3 Min\. auf den Hintergrund-Dienst/);
assert.equal(describeRunningPage({ step: 3, error: null }, runningSteps, { kind: "stale_lock", sinceMs: 1 }), "Schritt 3 von 8: Rohtext wurde unterbrochen – wird fortgesetzt");
assert.match(describeRunningPage({ step: 3, error: null }, runningSteps, { kind: "gone", status: "dead", error: null }), /Weiterlaufen lassen/);
assert.match(interruptedStepMessage(3, iso(-7 * 60_000), { attempts: 0, max_attempts: 3 }, now), /^Schritt 3 \(Rohtext\) wurde unterbrochen.*gestartet vor 7 Min\..*Versuch 1 von 3/);
assert.match(interruptedStepMessage(3, null, { attempts: 2, max_attempts: 3 }, now), /3-mal abgebrochen.*Zeitlimit/);

const runningPage = (patch: Partial<ContentPageRow>): ContentPageRow => ({ ...base, state: "laeuft", step: 3, ...patch });
const health = planContentPageRepairs(
  [
    runningPage({ id: "dead", job_id: "j-dead" }),
    runningPage({ id: "done", job_id: "j-done" }),
    runningPage({ id: "orphan", job_id: null }),
    runningPage({ id: "fine", job_id: "j-run" }),
    runningPage({ id: "stuck", job_id: "j-stale" }),
    runningPage({ id: "waiting", job_id: "j-wait" }),
    runningPage({ id: "later", job_id: "j-retry" }),
    { ...base, id: "paused", state: "in_arbeit", job_id: "j-dead" },
  ],
  new Map<string, ContentJobState>([
    ["j-dead", jobRow({ id: "j-dead", status: "dead", last_error: "Anthropic lehnt den API-Schlüssel ab" })],
    ["j-done", jobRow({ id: "j-done", status: "succeeded" })],
    ["j-run", jobRow({ id: "j-run", status: "running", locked_at: iso(-30_000) })],
    ["j-stale", jobRow({ id: "j-stale", status: "running", locked_at: iso(-JOB_LOCK_TTL_MS - 60_000) })],
    ["j-wait", jobRow({ id: "j-wait", run_after: iso(-120_000) })],
    ["j-retry", jobRow({ id: "j-retry", run_after: iso(60_000), attempts: 1, last_error: "überlastet" })],
  ]),
  now,
);
assert.deepEqual(
  health.repairs.map((r) => [r.pageId, r.error]),
  [
    ["dead", "Abgebrochen: Anthropic lehnt den API-Schlüssel ab"],
    ["done", CONTENT_JOB_GONE_MESSAGE],
    ["orphan", CONTENT_JOB_GONE_MESSAGE],
  ],
  "pages whose job will never return are paused with the reason",
);
assert.deepEqual(health.releaseJobIds, ["j-stale"], "a dead worker's lock is released");
assert.equal(health.kick, true, "stale lock or a long wait pokes the worker");
assert.deepEqual([...health.verdicts.keys()], ["dead", "done", "orphan", "fine", "stuck", "waiting", "later"], "only running pages are judged");
assert.equal(health.verdicts.get("later")?.kind, "retry");
assert.equal(planContentPageRepairs([runningPage({ id: "fine", job_id: "j-run" })], new Map([["j-run", jobRow({ id: "j-run", status: "running", locked_at: iso(-30_000) })]]), now).kick, false);

// --- structure sync and crawl take-over against an in-memory table -------------------------
type MemRow = Record<string, unknown>;
function memoryClient() {
  const tables = new Map<string, MemRow[]>();
  const rowsOf = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  class Builder {
    private filters: Array<(row: MemRow) => boolean> = [];
    private op: "select" | "insert" | "upsert" | "update" = "select";
    private payload: MemRow[] = [];
    private single = false;
    private limitN: number | null = null;
    constructor(private name: string) {}
    select() { return this; }
    eq(col: string, value: unknown) { this.filters.push((row) => row[col] === value); return this; }
    not(col: string, op: string, value: unknown) {
      if (op === "is" && value === null) this.filters.push((row) => row[col] != null);
      return this;
    }
    is(col: string, value: unknown) {
      if (value === null) this.filters.push((row) => row[col] == null);
      return this;
    }
    or() { return this; }
    order() { return this; }
    limit(n: number) { this.limitN = n; return this; }
    maybeSingle() { this.single = true; return this; }
    insert(rows: MemRow | MemRow[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(rows: MemRow | MemRow[]) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch: MemRow) { this.op = "update"; this.payload = [patch]; return this; }
    private execute() {
      const table = rowsOf(this.name);
      if (this.op === "update") {
        const hits = table.filter((row) => this.filters.every((filter) => filter(row)));
        for (const row of hits) Object.assign(row, this.payload[0]);
        return { data: null, error: null };
      }
      if (this.op === "insert") {
        for (const row of this.payload) table.push({ html: "", structure_uploaded_at: null, ...row });
        return { data: this.payload, error: null };
      }
      if (this.op === "upsert") {
        for (const row of this.payload) {
          const hit = table.find((existing) => existing.organisation_id === row.organisation_id && existing.slug === row.slug);
          if (hit) Object.assign(hit, row);
          else table.push({ html: "", structure_uploaded_at: null, ...row });
        }
        return { data: null, error: null };
      }
      let found = table.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.limitN != null) found = found.slice(0, this.limitN);
      return { data: this.single ? (found[0] ?? null) : found, error: null };
    }
    then<T>(onfulfilled?: (value: { data: unknown; error: null }) => T) {
      return Promise.resolve(this.execute()).then(onfulfilled);
    }
  }
  return {
    tables,
    client: { from(name: string) { return new Builder(name); } } as unknown as Parameters<typeof syncContentPagesFromCrawl>[0],
  };
}

async function runStoredPages() {
  const ORG = "00000000-0000-0000-0000-00000000aaaa";
  const mem = memoryClient();
  mem.tables.set("dt_website_structures", [{
    organisation_id: ORG,
    raw_text: "Startseite /\n  Kontakt /kontakt",
    uploaded_at: "2026-03-01T00:00:00.000Z",
  }]);
  const synced = await syncContentPagesFromStructure(mem.client, ORG);
  assert.equal(synced.synced, true);
  const stored = mem.tables.get("dt_content_pages")!;
  assert.equal(stored.length, 2, "structure raw_text seeds one row per node");
  assert.ok(stored.every((row) => row.source === "structure"));
  stored[0]!.html = "<p>bleibt</p>";

  const crawled = (patch: MemRow) => ({ organisation_id: ORG, title: null, h1: null, is_excluded: false, crawled_at: crawledAt, final_url: null, ...patch });
  mem.tables.set("dt_site_pages", [
    crawled({ url: "https://x.de/", title: "Start | Firma" }),
    crawled({ url: "https://x.de/kontakt", title: "Kontakt | Firma" }),
    crawled({ url: "https://x.de/leistungen", title: "Leistungen | Firma" }),
    crawled({ url: "https://x.de/leistungen/dach", h1: "Dachsanierung", title: "Dach | Firma" }),
    crawled({ url: "https://x.de/agb", title: "AGB", is_excluded: true }),
    crawled({ url: "https://x.de/alt", title: "Alt", final_url: "https://x.de/leistungen/dach" }),
    crawled({ url: "https://x.de/kaputt" }),
    crawled({ url: "https://x.de/fremd", title: "Andere Firma", organisation_id: "andere" }),
  ]);
  const taken = await syncContentPagesFromCrawl(mem.client, ORG);
  assert.deepEqual([taken.imported, taken.attached], [2, 2], "structure pages are kept and linked, new pages added");
  assert.equal(stored.length, 4);
  assert.equal(stored[0]!.html, "<p>bleibt</p>", "taking pages over never touches text");
  assert.equal(stored[0]!.source, "structure", "a structure page stays a structure page");
  assert.equal(stored[0]!.source_url, "https://x.de/", "… but knows its live URL now");
  assert.equal(stored.find((row) => row.slug === "kontakt")?.source_url, "https://x.de/kontakt");
  const dach = stored.find((row) => row.slug === "dach")!;
  assert.deepEqual(
    [dach.name, dach.path, dach.level, dach.position, dach.source, dach.source_url, dach.crawled_at],
    ["Dachsanierung", "/leistungen/dach", 2, 3, "crawl", "https://x.de/leistungen/dach", crawledAt],
  );
  assert.equal(stored.find((row) => row.slug === "leistungen")?.position, 2);
  assert.ok(!stored.some((row) => row.slug === "fremd"), "other organisations are not read");

  const again = await syncContentPagesFromCrawl(mem.client, ORG);
  assert.deepEqual([again.imported, again.attached], [0, 0], "taking over twice changes nothing");
  assert.equal(stored.length, 4);

  mem.tables.get("dt_website_structures")![0]!.uploaded_at = "2026-03-02T00:00:00.000Z";
  mem.tables.get("dt_website_structures")![0]!.raw_text = "Startseite /\n  Kontakt /kontakt\n  Impressum /impressum";
  const resynced = await syncContentPagesFromStructure(mem.client, ORG);
  assert.equal(resynced.synced, true);
  assert.ok(stored.some((row) => row.slug === "impressum"));
  assert.ok(stored.some((row) => row.slug === "dach"), "a later structure upload keeps crawl pages");
  assert.equal(stored[0]!.html, "<p>bleibt</p>");
  assert.equal(stored[0]!.source_url, "https://x.de/", "a structure re-sync keeps the live URL");
}

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

runStoredPages()
  .then(() => console.log("OK: content tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
