/**
 * Texte: „Zur Durchsicht“ before the Watermark Entfernung, „Abschnitt überarbeiten lassen“ and the
 * buttons on the open points („Vorschlag umsetzen“, „Eigene Angabe“, „So lassen“).
 * In-memory database, stubbed model calls; no network.
 * Run: npm run test:content-review-revise
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { findingKey, findingTargetBlock, findingTargetBlocks, markNewSentences, withoutFinding } from "../lib/dt/content/finding-target";
import { parseContentPagePatch } from "../lib/dt/content/page-patch";
import { approvalPatch, rerunPagePatch } from "../lib/dt/content/pipeline/actions";
import type { callContentTool } from "../lib/dt/content/pipeline/llm";
import { keptFindingsBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { heroStructureFinding, stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import { buildContentKnowledge } from "../lib/dt/content/pipeline/questions";
import { kundePrueftPlaceholder } from "../lib/dt/content/pipeline/kunde-prueft";
import { isKeptFinding, questionStopKeep, readQuestionStop, reviewStopDue } from "../lib/dt/content/pipeline/question-stop";
import { emptyRephraseProgress } from "../lib/dt/content/pipeline/rephrase";
import type { runRephraseOnBlocks } from "../lib/dt/content/pipeline/rephrase-runner";
import { REVISE_RULES, REVISE_TOOL, checkRevision, revisionNote, revisionOrder, revisionPrompt, type ContentRevisionRequest } from "../lib/dt/content/pipeline/revise";
import { applyProposals, applyRevision, keepFinding, previewRevision } from "../lib/dt/content/pipeline/revise-actions";
import type { StepOutcome } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_ENDABNAHME, CONTENT_STEP_WATERMARK, contentStepDefinition } from "../lib/dt/content/pipeline/steps";
import { parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { buildReview, pageActions, pageDetail, type ContentPageRow, type ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentFinding } from "../lib/dt/content/types";
import { runContentPageSteps } from "../lib/jobs/handlers/content-page";

import { FakeDb } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const blocks: ContentTextBlock[] = [
  { id: "hero", heading: "Luxusuhren Ankauf Düsseldorf", level: 1, html: "" },
  { id: "zusammenfassung", heading: "Ihre Uhr, sicher bewertet", level: 2, html: "<p>Sie besitzen eine Rolex. Wir bewerten sie in 24 Stunden.</p>" },
  { id: "ablauf", heading: "So läuft der Ankauf", level: 2, html: "<p>Fotos schicken, Termin, Angebot. [BITTE PRÜFEN: Gibt es eine schriftliche Einzelaufstellung pro Uhr?]</p>" },
];
const html = renderBlocksHtml(blocks);

const finding: ContentFinding = {
  title: "Offene Frage (nicht gestellt)",
  problem: "Gibt es eine schriftliche Einzelaufstellung pro Uhr? Stelle: „Fotos schicken, Termin, Angebot. [BITTE PRÜFEN: Gibt es eine schriftliche Einzelaufstellung pro Uhr?]“",
  proposal: "Den Satz ohne die Angabe formulieren oder die Angabe ergänzen.",
  severity: "low",
  severity_label: "Hinweis",
  block_id: null,
};

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID, organisation_id: ORG, slug: "luxus-uhren", name: "Luxus-Uhren Ankauf", path: "/uhren", level: 2, position: 0, source: "structure",
  source_url: null, crawled_at: null, main_keyword: null, page_role: "supporting", page_type: "unterseite", pillar_name: null,
  estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "fertig", step: 10, released: false, released_at: null, title: null, meta_description: null, html, markdown: "",
  findings: [], final_findings: [], unresolved: [finding], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, skip_steps: [], client_wishes: "",
  question_stop: { status: "done", handled: [] }, error: null, job_id: null, cost_eur: 0.5, started_by: null, created_at: "2026-11-11T15:00:00Z", updated_at: "2026-11-11T15:00:00Z",
  ...patch,
});

const context = (): ContentPipelineContext => ({
  organisationName: "Antikankauf Kolb & Sartor",
  page: {
    name: "Luxus-Uhren Ankauf", path: "/uhren", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [
    { key: "preis", label: "Preis & Positionierung", current: "Bewertung kostenlos. Antwort auf Fotos meist innerhalb von 2 Stunden. Nicht für Content verwenden: Margen." },
  ],
  settings: { anrede: "Sie", branche: "Antiquitätenhandel", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: { name: "Frank Wiesner", role: "Erbe", beschreibung: "Hat eine Rolex geerbt." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks,
  title: null,
  metaDescription: null,
});

const doneUpTo = (n: number, extra: Partial<ContentStepRow> = {}) =>
  Array.from({ length: n }, (_, i) => ({ page_id: PAGE_ID, organisation_id: ORG, step: i + 1, name: `Schritt ${i + 1}`, status: "done", output: i === 0 ? { page_facts: { facts: [], conversations: 0 } } : null, ...extra }));

async function reviewStopTests() {
  // --- when the page stops „Zur Durchsicht“ ---------------------------------------------------------
  const steps8 = doneUpTo(8);
  assert.equal(reviewStopDue({ status: "done" }, steps8, CONTENT_STEP_WATERMARK), true, "questions settled, switch on (default): stop");
  assert.equal(reviewStopDue({ status: "done", review_off: true }, steps8, CONTENT_STEP_WATERMARK), false, "switched off");
  assert.equal(reviewStopDue({ status: "done", review: { status: "done" } }, steps8, CONTENT_STEP_WATERMARK), false, "already released");
  assert.equal(reviewStopDue({ status: "waiting" }, steps8, CONTENT_STEP_WATERMARK), false, "the questions come first");
  assert.equal(reviewStopDue({ status: "done" }, steps8, 8), false, "not before the Watermark");
  assert.equal(reviewStopDue({ status: "done" }, [...steps8, { step: 9, status: "done" }], 10), false, "a page past the Watermark keeps its course");

  // The job loop: the page stops instead of running the Watermark.
  const loop = async (stop: Record<string, unknown>) => {
    const db = new FakeDb({
      dt_content_pages: [pageRow({ state: "laeuft", step: 8, job_id: JOB_ID, question_stop: stop as ContentPageRow["question_stop"] }) as unknown as Record<string, unknown>],
      dt_content_steps: doneUpTo(8),
      jobs: [{ id: JOB_ID, status: "running" }],
    });
    const ran: number[] = [];
    const runStep = async (_s: unknown, _p: ContentPageRow, _st: readonly ContentStepRow[], step: number): Promise<StepOutcome> => {
      ran.push(step);
      return { step, halted: true, model: "stub", costEur: 0 };
    };
    const result = await runContentPageSteps({ service: db.service, job: { id: JOB_ID, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, deadline: Date.now() + 240_000, runners: { runStep } });
    return { result, ran, page: db.rows("dt_content_pages")[0] as unknown as ContentPageRow };
  };
  const stopped = await loop({ status: "done", handled: [] });
  assert.deepEqual([stopped.ran, stopped.page.state, readQuestionStop(stopped.page.question_stop).review?.status], [[], "braucht_sie", "waiting"]);
  assert.deepEqual(stopped.result, { ok: true, result: { step: 9, halted: true, review: true } });
  const off = await loop({ status: "done", handled: [], review_off: true });
  assert.deepEqual(off.ran, [9], "switched off: the Watermark runs");
  const released = await loop({ status: "done", handled: [], review: { status: "done" } });
  assert.deepEqual(released.ran, [9], "released: the Watermark runs");

  // --- releasing, the table, the actions ---------------------------------------------------------------
  const waiting = pageRow({ state: "braucht_sie", step: 8, question_stop: { status: "done", handled: [], review: { status: "waiting" } } });
  assert.deepEqual(readQuestionStop((approvalPatch(waiting, "2026-11-11T16:00:00Z").question_stop)).review, { status: "done", at: "2026-11-11T16:00:00Z" });
  const atQuestions = pageRow({ state: "braucht_sie", question_stop: { status: "waiting", handled: [] } });
  assert.equal(readQuestionStop(approvalPatch(atQuestions, "2026-11-11T16:00:00Z").question_stop).review?.status, "done", "released at the questions: no second stop");
  assert.equal(pageActions(waiting).find((a) => a.kind === "approve")!.label, "Freigeben und fertigstellen");
  assert.equal(pageActions(atQuestions).find((a) => a.kind === "approve")!.label, "Freigeben");
  assert.match(pageDetail(waiting) ?? "", /^Zur Durchsicht/);
  for (const page of [waiting, pageRow(), pageRow({ released: true }), pageRow({ state: "in_arbeit" })]) {
    assert.ok(pageActions(page).some((a) => a.kind === "revise"), page.state);
  }
  assert.ok(!pageActions(pageRow({ state: "laeuft" })).some((a) => a.kind === "revise"));
  const review = buildReview(waiting, doneUpTo(8) as unknown as ContentStepRow[]);
  assert.deepEqual(review.review_stop, { enabled: true, status: "waiting", watermark_done: false });

  // --- the switch: stored in the stop, kept by reset and rerun --------------------------------------------
  assert.equal(parseContentPagePatch({ organisationId: ORG, review_stop: false }).ok, true);
  assert.deepEqual(questionStopKeep({ review_off: true }), { review_off: true });
  assert.deepEqual(rerunPagePatch(pageRow({ question_stop: { status: "done", handled: [], review_off: true } }), 4, "x").question_stop, { review_off: true });
  assert.deepEqual(rerunPagePatch(pageRow(), 4, "x").question_stop, {});
  console.log("review stop: ok");
}

function checkTests() {
  const ctx = context();
  // --- the prompt and the order -------------------------------------------------------------------------------
  const prompt = revisionPrompt(ctx, blocks[1]!, { instruction: "Hero-Überschrift kürzer, auf Erben zugeschnitten." });
  assert.match(prompt.user, /## Abschnitt, den du überarbeitest \(id zusammenfassung, Ebene 2\)\n\[Abschnitt zusammenfassung\]\n## Ihre Uhr, sicher bewertet/);
  assert.match(prompt.user, /## Auftrag der Redaktion\nAuftrag: Hero-Überschrift kürzer, auf Erben zugeschnitten\./);
  assert.match(prompt.user, /### Gesperrt \(nicht verwenden, auch nicht sinngemäß\)[\s\S]*Margen/, "the blocked statements go along");
  assert.match(prompt.user, /Frank Wiesner/);
  assert.match(prompt.system, /^Du überarbeitest genau einen Abschnitt/);
  assert.equal(REVISE_TOOL.name, "submit_abschnitt");
  assert.match(revisionOrder({ finding, info: "Ja, pro Uhr gibt es eine schriftliche Aufstellung." }), /Angabe der Redaktion \(bestätigter Fakt, genau so übernehmen\): Ja, pro Uhr/);
  assert.match(revisionOrder({ finding, info: "KUNDE PRÜFT" }), /Platzhalter \[BITTE PRÜFEN: Offene Frage \(nicht gestellt\)\]/);

  const allowed = ctx.sections.map((s) => s.current).join("\n");
  const json = (heading: string | null, h: string) => ({ block: { id: "anders", heading: heading ?? "", level: 3, html: h } });

  // A new heading: taken, with the old id and level.
  const ok = checkRevision(json("Ihre Uhr fair bewertet", blocks[1]!.html), blocks[1]!, { instruction: "kürzer" }, allowed);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && [ok.block.id, ok.block.level, ok.block.heading], ["zusammenfassung", 2, "Ihre Uhr fair bewertet"]);

  // A number from the facts is fine, a new one is not.
  assert.ok(checkRevision(json("Ihre Uhr, sicher bewertet", "<p>Sie besitzen eine Rolex. Antwort meist innerhalb von 2 Stunden.</p>"), blocks[1]!, { instruction: "x" }, allowed).ok);
  const invented = checkRevision(json("Ihre Uhr", "<p>Wir zahlen bis zu 15.000 €.</p>"), blocks[1]!, { instruction: "x" }, allowed);
  assert.ok(!invented.ok && /Zahl, die weder im Abschnitt, im Auftrag noch in den Fakten steht: 15000/.test(invented.reasons.join()));

  // A placeholder stays unless the open point settles it.
  const dropped = checkRevision(json("So läuft der Ankauf", "<p>Fotos schicken, Termin, Angebot.</p>"), blocks[2]!, { instruction: "kürzer" }, allowed);
  assert.ok(!dropped.ok && /Platzhalter oder Marker entfernt/.test(dropped.reasons.join()));
  const settled = checkRevision(
    json("So läuft der Ankauf", "<p>Fotos schicken, Termin, Angebot. Pro Uhr gibt es eine schriftliche Aufstellung.</p>"),
    blocks[2]!,
    { finding, info: "Ja, pro Uhr gibt es eine schriftliche Aufstellung." },
    allowed,
  );
  assert.ok(settled.ok, "the open point names the placeholder: it may go");

  // „KUNDE PRÜFT“: its placeholder may come in, the words never.
  const pending = checkRevision(json("Ihre Uhr, sicher bewertet", `${blocks[1]!.html}<p>[BITTE PRÜFEN: Offene Frage (nicht gestellt)]</p>`), blocks[1]!, { finding, info: "KUNDE PRÜFT" }, allowed);
  assert.ok(pending.ok);
  const words = checkRevision(json("Ihre Uhr, sicher bewertet", `${blocks[1]!.html}<p>Kunde prüft das noch.</p>`), blocks[1]!, { finding, info: "KUNDE PRÜFT" }, allowed);
  assert.ok(!words.ok && /„KUNDE PRÜFT“ steht im Text/.test(words.reasons.join()));

  // „Vorschlag umsetzen“ may end in one placeholder for the missing fact; a plain order may not.
  const withCheck = (n: number) =>
    json("Ihre Uhr, sicher bewertet", `${blocks[1]!.html}${["Genügt ein Kaufbeleg?", "Gibt es eine Garantie?"].slice(0, n).map((q) => `<p>[BITTE PRÜFEN: ${q}]</p>`).join("")}`);
  assert.ok(checkRevision(withCheck(1), blocks[1]!, { finding }, allowed).ok);
  assert.ok(!checkRevision(withCheck(2), blocks[1]!, { finding }, allowed).ok, "only one");
  assert.ok(!checkRevision(withCheck(1), blocks[1]!, { instruction: "kürzer" }, allowed).ok, "not without an open point");

  // Nothing changed, nothing delivered, a new link.
  assert.ok(!checkRevision(json(blocks[1]!.heading, blocks[1]!.html), blocks[1]!, { instruction: "x" }, allowed).ok);
  assert.ok(!checkRevision({}, blocks[1]!, { instruction: "x" }, allowed).ok);
  assert.ok(!checkRevision(json("Ihre Uhr", "<p>Mehr auf https://example.com</p>"), blocks[1]!, { instruction: "x" }, allowed).ok);

  // --- which Abschnitt an open point is about ----------------------------------------------------------------------
  assert.equal(findingTargetBlock(finding, blocks), "ablauf", "by its placeholder");
  assert.equal(findingTargetBlock({ ...finding, block_id: "zusammenfassung" }, blocks), "zusammenfassung", "by its block");
  assert.equal(findingTargetBlock({ block_id: null, problem: "Stelle: „Sie besitzen eine Rolex. Wir bewerten sie“", proposal: "" }, blocks), "zusammenfassung", "by a quoted sentence");
  assert.equal(findingTargetBlock({ block_id: null, problem: "Allgemein", proposal: "" }, blocks), null);
  // A point about several Abschnitte, as the Endabnahme wrote it on 11.11.: no block_id, quotes cut
  // off with „…“, ids named bare.
  {
    const page = [
      { id: "verlauf", heading: "Wie ein Uhrenverkauf aus dem Nachlass typischerweise verläuft", html: "<p>Die meisten melden sich, wenn sie eine Uhr gefunden haben und nicht wissen, was sie wert ist.</p>" },
      { id: "verlauf-2", heading: "Erste Schritte", html: "<p>Hier melden sich die meisten mit Fotos und einer kurzen Frage.</p>" },
      { id: "warum", heading: "Warum Erben zögern", html: "<p>Vier Einwände begegnen uns bei Uhrenverkäufen am häufigsten.</p>" },
      { id: "andere", heading: "Anderes", html: "<p>Nichts davon.</p>" },
    ];
    const multi = {
      block_id: null,
      problem: "Im Text stehen Mengenaussagen über das Kundenverhalten. Im Abschnitt verlauf heißt es: „Die meisten melden sich, wenn sie eine Uhr gefunden haben …“. In verlauf-2 steht: „Hier melden sich die meisten: …“. Im Abschnitt warum steht: „Vier Einwände begegnen uns bei Uhrenverkäufen am häufigsten.“",
      proposal: "Die Häufigkeitsangaben streichen oder neutral formulieren.",
    };
    assert.deepEqual(findingTargetBlocks(multi, page), ["verlauf", "verlauf-2", "warum"]);
    assert.equal(findingTargetBlock(multi, page), "verlauf");
    assert.deepEqual(findingTargetBlocks({ block_id: null, problem: "Die Seite wirkt allgemein zu lang.", proposal: "" }, page), [], "nothing named");
  }
  const lists = { findings: [], final_findings: [finding], unresolved: [finding] };
  assert.deepEqual(withoutFinding(lists, findingKey(finding)), { findings: [], final_findings: [], unresolved: [] });
  assert.equal(withoutFinding(lists, "nichts"), null);
  assert.match(revisionNote(blocks[2]!, { finding, info: "Ja, gibt es." }), /^Angabe der Redaktion zu „Offene Frage \(nicht gestellt\)“ \(Abschnitt „So läuft der Ankauf“\): Ja, gibt es\.$/);
  // The preview marks every sentence that is new.
  assert.deepEqual(
    markNewSentences("Voraussetzung ist die Originalrechnung. Online-Verkauf bieten wir nicht an.", "Voraussetzung ist die Originalrechnung. Bei alten Uhren genügt eine Erklärung. Online-Verkauf bieten wir nicht an."),
    [
      { text: "Voraussetzung ist die Originalrechnung.", isNew: false },
      { text: "Bei alten Uhren genügt eine Erklärung.", isNew: true },
      { text: "Online-Verkauf bieten wir nicht an.", isNew: false },
    ],
  );
  // Several points: one [BITTE PRÜFEN: …] each.
  const two: ContentRevisionRequest = { findings: [finding, { ...finding, title: "Zweiter Punkt" }] };
  assert.ok(checkRevision(withCheck(2), blocks[1]!, two, allowed).ok, "two points, two placeholders");
  assert.ok(!checkRevision(withCheck(2), blocks[1]!, { findings: [finding] }, allowed).ok, "one point, one placeholder");
  assert.match(REVISE_RULES, /Auch keine Ausnahme, Bedingung oder Alternative, die dort nicht steht\./);
  console.log("revision checks: ok");
}

async function actionTests() {
  const ctx = context();
  type Call = typeof callContentTool;
  type Rephrase = typeof runRephraseOnBlocks;
  const answer = (block: Record<string, unknown>): Call => async () => ({ json: { block }, usage: { inputTokens: 20_000, outputTokens: 400 }, model: "claude-sonnet-5-5", stopReason: "tool_use" });
  const grok: Rephrase = async (_c, input, options) => {
    options.progress.cost_eur = 0.01;
    await options.onUsage({ model: "grok-4", inputTokens: 500, outputTokens: 120, costEur: 0.01 });
    return { state: "done", model: "grok-4", blocks: input.map((b) => ({ ...b, html: "<p>Von Grok umformuliert, 2 Stunden.</p>" })) };
  };
  const db = (page: ContentPageRow, steps = doneUpTo(10)) => new FakeDb({ dt_content_pages: [page as unknown as Record<string, unknown>], dt_content_steps: steps, dt_llm_usage_events: [] });

  // --- preview after the Watermark: Claude, then Grok on this one Abschnitt; billed on the page ---------------
  {
    const store = db(pageRow());
    const preview = await previewRevision(store.service, pageRow(), doneUpTo(10) as unknown as ContentStepRow[], { block_id: "zusammenfassung", instruction: "Antwortzeit nennen" }, null, {
      callTool: answer({ id: "zusammenfassung", heading: "Ihre Uhr, schnell bewertet", level: 2, html: "<p>Antwort auf Fotos meist innerhalb von 2 Stunden.</p>" }),
      rephrase: grok,
      context: { context: ctx, avatarId: null },
      models: ["claude-sonnet-5-5"],
    });
    assert.ok(preview.ok);
    if (preview.ok) {
      assert.deepEqual([preview.after.heading, preview.after.html, preview.watermark], ["Ihre Uhr, schnell bewertet", "<p>Von Grok umformuliert, 2 Stunden.</p>", true]);
      assert.equal(preview.before.html, blocks[1]!.html);
    }
    assert.ok(Number((store.rows("dt_content_pages")[0] as { cost_eur: number }).cost_eur) > 0.5, "the preview is billed on the page");
    assert.deepEqual(store.rows("dt_llm_usage_events").map((e) => e.mode), ["content.revise", "content.revise.watermark"]);
    assert.equal((store.rows("dt_content_pages")[0] as { html: string }).html, html, "the text is not changed by a preview");
  }
  // Before the Watermark (the review stop): no Grok.
  {
    const waiting = pageRow({ state: "braucht_sie", question_stop: { status: "done", handled: [], review: { status: "waiting" } } });
    const preview = await previewRevision(db(waiting, doneUpTo(8)).service, waiting, doneUpTo(8) as unknown as ContentStepRow[], { block_id: "zusammenfassung", instruction: "kürzer" }, null, {
      callTool: answer({ id: "zusammenfassung", heading: "Ihre Uhr, sicher bewertet", level: 2, html: "<p>Sie besitzen eine Rolex.</p>" }),
      rephrase: async () => {
        throw new Error("no Grok before the Watermark");
      },
      context: { context: ctx, avatarId: null },
      models: ["claude-sonnet-5-5"],
    });
    assert.ok(preview.ok && !preview.watermark);
  }
  // A version that breaks the rules: refused with the reasons, nothing changes.
  {
    const preview = await previewRevision(db(pageRow()).service, pageRow(), doneUpTo(8) as unknown as ContentStepRow[], { block_id: "zusammenfassung", instruction: "x" }, null, {
      callTool: answer({ id: "zusammenfassung", heading: "Ihre Uhr", level: 2, html: "<p>Wir zahlen 15.000 €.</p>" }),
      context: { context: ctx, avatarId: null },
      models: ["m"],
    });
    assert.ok(!preview.ok && preview.status === 422 && /15000/.test((preview.reasons ?? []).join()));
  }
  // Guards.
  assert.equal((await previewRevision(db(pageRow()).service, pageRow({ state: "laeuft" }), [], { block_id: "x", instruction: "x" }, null)).ok, false);
  const missing = await previewRevision(db(pageRow()).service, pageRow(), [], { block_id: "gibt-es-nicht", instruction: "x" }, null);
  assert.ok(!missing.ok && missing.status === 404);
  const noOrder = await previewRevision(db(pageRow()).service, pageRow(), [], { block_id: "ablauf" }, null);
  assert.ok(!noOrder.ok && noOrder.status === 400);

  // --- „Übernehmen“: the Abschnitt, a note, the open point gone, a released page released no more -------------------
  {
    const page = pageRow({ released: true });
    const store = db(page);
    const after = { heading: "So läuft der Ankauf", html: "<p>Fotos schicken, Termin, Angebot. Pro Uhr gibt es eine schriftliche Aufstellung.</p>" };
    const result = await applyRevision(store.service, page, {
      block_id: "ablauf",
      before: { heading: blocks[2]!.heading, html: blocks[2]!.html },
      after,
      info: "Ja, pro Uhr gibt es eine schriftliche Aufstellung.",
      finding_key: findingKey(finding),
    });
    assert.ok(result.ok);
    const saved = store.rows("dt_content_pages")[0] as unknown as ContentPageRow;
    assert.deepEqual(parseBlocksFromHtml(saved.html).map((b) => [b.id, b.level, b.html]), [
      ["hero", 1, ""],
      ["zusammenfassung", 2, blocks[1]!.html],
      ["ablauf", 2, after.html],
    ]);
    assert.deepEqual(saved.unresolved, [], "the open point is gone");
    assert.match(saved.notes.at(-1)!, /^Angabe der Redaktion zu „Offene Frage \(nicht gestellt\)“/, "kept for a later run");
    assert.equal(saved.released, false);
    assert.match(saved.markdown, /Pro Uhr gibt es eine schriftliche Aufstellung/);
  }
  // Changed meanwhile: refused.
  {
    const conflict = await applyRevision(db(pageRow()).service, pageRow(), { block_id: "ablauf", before: { heading: "Alt", html: "<p>alt</p>" }, after: { heading: "Neu", html: "<p>neu</p>" } });
    assert.ok(!conflict.ok && conflict.status === 409);
  }
  // „Jetzt umsetzen“: two chosen points on one Abschnitt, one call, taken over at once, both points gone.
  {
    const second = { title: "Satz holprig", problem: "„Fotos schicken, Termin, Angebot.“", proposal: "Als ganzen Satz formulieren.", severity: "medium", severity_label: "Mittel", block_id: "ablauf" };
    const page = pageRow({ unresolved: [finding, second] });
    const store = db(page, doneUpTo(8));
    let user = "";
    const call: Call = async (input) => {
      user = input.user;
      return answer({ id: "ablauf", heading: "So läuft der Ankauf", level: 2, html: "<p>Sie schicken Fotos, wir vereinbaren einen Termin und machen ein Angebot. [BITTE PRÜFEN: Gibt es eine Aufstellung pro Uhr?]</p>" })(input);
    };
    const result = await applyProposals(store.service, page, doneUpTo(8) as unknown as ContentStepRow[], { block_id: "ablauf", finding_keys: [findingKey(finding), findingKey(second)] }, null, {
      callTool: call,
      context: { context: ctx, avatarId: null },
      models: ["claude-sonnet-5-5"],
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.match(user, /Mehrere offene Punkte in diesem Abschnitt\. Setze alle Vorschläge um, jeden nur an der Stelle, die er betrifft:\n1\. Offener Punkt: Offene Frage \(nicht gestellt\)[\s\S]*\n2\. Offener Punkt: Satz holprig\n   Problem: „Fotos schicken, Termin, Angebot\.“\n   Vorschlag \(umsetzen\): Als ganzen Satz formulieren\./);
    const saved = store.rows("dt_content_pages")[0] as unknown as ContentPageRow;
    assert.deepEqual(saved.unresolved, [], "both points gone");
    assert.match(saved.html, /wir vereinbaren einen Termin/);
    assert.match(saved.notes.at(-1)!, /^Abschnitt „So läuft der Ankauf“ überarbeitet nach den Vorschlägen zu „Offene Frage \(nicht gestellt\)“, „Satz holprig“: /);
    // A point that is gone meanwhile: nothing is called.
    const gone = await applyProposals(db(page).service, pageRow({ unresolved: [second] }), [], { block_id: "ablauf", finding_keys: [findingKey(finding), findingKey(second)] }, null, {
      callTool: async () => assert.fail("no call"),
      context: { context: ctx, avatarId: null },
      models: ["m"],
    });
    assert.ok(!gone.ok && gone.status === 409);
  }
  // A point about two Abschnitte: the first call keeps it (done_keys empty), the last one removes it.
  {
    const page = pageRow({ unresolved: [finding] });
    const store = db(page, doneUpTo(8));
    const opts = { callTool: answer({ id: "zusammenfassung", heading: "Ihre Uhr, sicher bewertet", level: 2, html: "<p>Sie besitzen eine Uhr. Wir bewerten sie in Ruhe.</p>" }), context: { context: ctx, avatarId: null }, models: ["m"] };
    const first = await applyProposals(store.service, page, doneUpTo(8) as unknown as ContentStepRow[], { block_id: "zusammenfassung", finding_keys: [findingKey(finding)], done_keys: [] }, null, opts);
    assert.ok(first.ok, JSON.stringify(first));
    assert.equal((store.rows("dt_content_pages")[0] as unknown as ContentPageRow).unresolved.length, 1, "still open after the first Abschnitt");
  }
  // An Abschnitt that is right already (the model changes nothing): no failure and no change. The
  // point stays unless its proposal changed an earlier Abschnitt (`touched_keys`), then it goes.
  {
    const same = parseBlocksFromHtml(html).find((b) => b.id === "zusammenfassung")!;
    const opts = { callTool: answer({ id: same.id, heading: same.heading, level: same.level, html: same.html }), context: { context: ctx, avatarId: null }, models: ["m"] };
    const key = findingKey(finding);
    const page = pageRow({ unresolved: [finding] });
    const store = db(page, doneUpTo(8));
    const alone = await applyProposals(store.service, page, doneUpTo(8) as unknown as ContentStepRow[], { block_id: "zusammenfassung", finding_keys: [key], done_keys: [key] }, null, opts);
    assert.ok(alone.ok && alone.unchanged === true, JSON.stringify(alone));
    const kept = store.rows("dt_content_pages")[0] as unknown as ContentPageRow;
    assert.equal(kept.unresolved.length, 1, "nothing changed anywhere: the point stays open");
    assert.equal(kept.html, html, "the text stays");
    const after = await applyProposals(store.service, page, doneUpTo(8) as unknown as ContentStepRow[], { block_id: "zusammenfassung", finding_keys: [key], done_keys: [key], touched_keys: [key] }, null, opts);
    assert.ok(after.ok && after.unchanged === true, JSON.stringify(after));
    assert.deepEqual((store.rows("dt_content_pages")[0] as unknown as ContentPageRow).unresolved, [], "changed elsewhere before: the point goes");
  }
  // „So lassen“: the point goes, the text stays, the page remembers it.
  {
    const store = db(pageRow());
    assert.ok((await keepFinding(store.service, pageRow(), findingKey(finding), new Date("2026-11-11T12:00:00Z"))).ok);
    const saved = store.rows("dt_content_pages")[0] as unknown as ContentPageRow;
    assert.deepEqual(saved.unresolved, []);
    assert.equal(saved.html, html, "the text stays");
    assert.deepEqual(readQuestionStop(saved.question_stop).kept, [
      { title: finding.title, problem: finding.problem, block_id: finding.block_id || null, at: "2026-11-11T12:00:00.000Z" },
    ]);
    assert.equal((await keepFinding(store.service, pageRow({ unresolved: [] }), findingKey(finding))).ok, false);
  }
  assert.ok(emptyRephraseProgress(1).total === 1);
  console.log("preview, apply, so lassen: ok");
}

/** „So lassen“: kept points survive a rerun, go with a reset, and are never listed again. */
function keptTests() {
  const kept = [{ title: "Zeitdruck-Formulierungen trotz Tonalität", problem: "„Gerade jetzt entscheiden …“", block_id: "wichtig", at: "2026-11-11T12:00:00Z" }];
  const stop = { handled: [], review_off: true, kept };
  assert.deepEqual(questionStopKeep(stop), { review_off: true }, "Zurücksetzen: the kept points go");
  assert.deepEqual(questionStopKeep(stop, { keepKept: true }), { review_off: true, kept }, "Wiederholen: they stay");
  assert.ok(isKeptFinding({ title: "zeitdruck-formulierungen trotz tonalität", problem: "anders formuliert", block_id: "wichtig" }, kept), "same title, same Abschnitt");
  assert.ok(isKeptFinding({ title: "Zeitdruck-Formulierungen trotz Tonalität", problem: "„Gerade jetzt entscheiden …“", block_id: "" }, kept), "same point without block");
  assert.ok(!isKeptFinding({ title: "Anredebruch", problem: "x", block_id: "wichtig" }, kept), "another point on the same Abschnitt stays");

  // The Endabnahme drops a kept point, also when it reports it again under the same title.
  const def = contentStepDefinition(CONTENT_STEP_ENDABNAHME)!;
  const again = { title: "Zeitdruck-Formulierungen trotz Tonalität", problem: "neu formuliert", proposal: "streichen", severity: "medium", block_id: "wichtig" };
  const other = { title: "Anredebruch", problem: "„Du“ in Abschnitt wichtig", proposal: "Sie", severity: "high", block_id: "wichtig" };
  const patch = stepPatchFor(def, { unresolved: [again, other], summary: "s" }, { html: "<section data-block-id=\"hero\"><h1>Luxusuhren Ankauf</h1></section><section data-block-id=\"wichtig\"><h2>Wichtig</h2><p>Text</p></section>", question_stop: { kept } });
  assert.deepEqual((patch.pagePatch.unresolved as ContentFinding[]).map((f) => f.title), ["Anredebruch"]);

  // „KUNDE PRÜFT“ placeholders: „Kunde prüft: …“, low, also when the model listed them; others stay „Platzhalter offen“.
  {
    const knowledge = buildContentKnowledge({ notes: ["Antwort des Kunden auf „Gibt es eine Echtheitsgarantie?“: KUNDE PRÜFT"] });
    assert.equal(knowledge.pending.length, 1, "the note makes a pending check");
    // „Eigene Angabe: KUNDE PRÜFT“ on an open point: its note makes one too, with the same placeholder.
    const fromRevision = buildContentKnowledge({ notes: [revisionNote({ id: "intro", heading: "Ankauf" }, { finding, info: "KUNDE PRÜFT" })] });
    assert.deepEqual(fromRevision.pending.map((p) => p.placeholder), [kundePrueftPlaceholder(finding.title)]);
    assert.deepEqual(fromRevision.answered, [], "and no answer");
    const text =
      "<section data-block-id=\"hero\"><h1>Luxusuhren Ankauf</h1></section>" +
      "<section data-block-id=\"intro\"><h2>Ankauf</h2><p>Wir kaufen an. [BITTE PRÜFEN: Gibt es eine Echtheitsgarantie?] Preis: [BITTE PRÜFEN: Ab welchem Wert?]</p></section>";
    const modelSaid = { title: "Platzhalter stehen geblieben", problem: "[BITTE PRÜFEN: Gibt es eine Echtheitsgarantie?] steht noch im Text.", proposal: "ergänzen", severity: "high", block_id: "intro" };
    const patch = stepPatchFor(def, { unresolved: [modelSaid], summary: "s" }, { html: text, knowledge });
    assert.deepEqual((patch.pagePatch.unresolved as ContentFinding[]).map((f) => [f.title, f.severity]), [
      ["Kunde prüft: Gibt es eine Echtheitsgarantie?", "low"],
      ["Platzhalter offen", "high"],
    ]);
    assert.equal((patch.pagePatch.unresolved as ContentFinding[])[0]!.proposal, "Antwort des Kunden abwarten, dann Abschnitt ändern.");
  }
  // The H1 structure: hero (H1) first, then an H2.
  {
    const b = (id: string, level: 1 | 2 | 3, heading = id) => ({ id, heading, level, html: "" });
    assert.equal(heroStructureFinding([b("hero", 1), b("zusammenfassung", 2), b("ablauf", 2)]), null);
    assert.equal(heroStructureFinding([]), null);
    const legacy = heroStructureFinding([b("h1", 1, "Uhren Ankauf"), b("hero", 2, "[HERO – wird von Hormozi gefuellt]")]);
    assert.equal(legacy?.title, "H1-Aufbau prüfen");
    assert.equal(legacy?.severity, "medium");
    assert.match(legacy!.problem, /Gefunden: erster Abschnitt „Uhren Ankauf“ \(id h1, Ebene 1\), zweiter Abschnitt „\[HERO – wird von Hormozi gefuellt\]“ \(id hero, Ebene 2\)\.$/);
    assert.ok(heroStructureFinding([b("hero", 1), b("ablauf", 3)]), "an H3 right after the H1");
    assert.ok(heroStructureFinding([b("hero", 1)]), "nothing after the H1");
  }

  // …and is told about it.
  const block = keptFindingsBlock({ keptFindings: kept });
  assert.match(block, /^## Von der Redaktion bewusst so gelassen \(kein Befund\)\nDiese Punkte hat die Redaktion geprüft/);
  assert.match(block, /- Zeitdruck-Formulierungen trotz Tonalität: „Gerade jetzt entscheiden …“ \(Abschnitt wichtig\)/);
  assert.equal(keptFindingsBlock({ keptFindings: [] }), "");
  console.log("so lassen: ok");
}

reviewStopTests()
  .then(() => keptTests())
  .then(() => checkTests())
  .then(() => actionTests())
  .then(() => console.log("OK: review and revise tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
