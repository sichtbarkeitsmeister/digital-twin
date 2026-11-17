/**
 * Texte → Seitenquelle → „Verbesserung“ → „Texte hochladen“: Word files (file name = page name)
 * as the second source next to the crawl. The name key and the deterministic matching (no AI),
 * the AI step for what the name rule left over (stored assignments kept or released, candidates,
 * the checked model answer; the model call is a stub), manual assignments, the takeover into the Texte table, storage of one file per request, the
 * existing text and the skipped SEO of an upload page, and the migration message.
 * In-memory database, real .docx bytes built here; no network.
 * Run: npm run test:content-text-uploads
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import JSZip from "jszip";

import type { ContentBriefingPage } from "../lib/dt/content/excel-structure";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { CONTENT_HERO_PLACEHOLDER, pageBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { UPLOAD_EXISTING_TEXT_MAX_CHARS, loadExistingText, skipContentStep } from "../lib/dt/content/pipeline/run-step";
import { UPLOAD_TEXT_FAILURE_PREFIX } from "../lib/dt/content/pipeline/step-patch";
import { CONTENT_STEP_SEO, contentStepDefinition, contentStepSkippable } from "../lib/dt/content/pipeline/steps";
import { contentSkipWarnings, contentStepStatusLabel } from "../lib/dt/content/presentation";
import { parseBlocksFromHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { DEFAULT_CONTENT_MATCH_MODEL, resolveContentMatchModels } from "../lib/dt/content/model-config";
import { describeSeiten } from "../lib/dt/content/route-helpers";
import {
  buildReview,
  canEditContentPageType,
  contentPageSourceOf,
  planContentSkipSteps,
  upsertContentPagesFromBriefing,
  type ContentPageRow,
  type ContentStepRow,
} from "../lib/dt/content/store";
import {
  CONTENT_TEXT_UPLOADS_MIGRATION_FILE,
  CONTENT_UPLOAD_AI_MATCH_MIGRATION_FILE,
  TEXT_UPLOADS_MIGRATION_MESSAGE,
  UPLOAD_AI_MATCH_MIGRATION_MESSAGE,
  assignTextUpload,
  isMissingTextUploadsError,
  isMissingUploadAiMatchError,
  loadPageTextUpload,
  loadTextUploadsResult,
  removeTextUpload,
  storeTextUpload,
  takeOverTextUploads,
  textUploadsDbErrorMessage,
} from "../lib/dt/content/text-uploads";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import {
  UPLOAD_AI_MATCH_CHUNK,
  UPLOAD_AI_MATCH_TIMEOUT_MS,
  UPLOAD_AI_MATCH_USAGE_MODE,
  aiMatchTextUploads,
  uploadAiMatchPrompt,
  uploadEvidence,
  validateUploadAiMatches,
  type UploadAiMatchCall,
} from "../lib/dt/content/upload-ai-match";
import {
  UPLOAD_AI_CONFLICT_NOTE,
  UPLOAD_AI_NO_PAGE_NOTE,
  UPLOAD_PAGE_GONE_NOTE,
  UPLOAD_TAKEOVER_RUNNING_REASON,
  aiMatchCandidateIds,
  matchTextUploads,
  pageNameKey,
  planUploadTakeover,
  uploadBlocksToMarkdown,
  type TakeoverRow,
  type UploadMatchFile,
} from "../lib/dt/content/upload-match";

import { FakeDb, type FakeRow } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "44444444-4444-4444-8444-444444444444";
const UPLOADED_AT = "2026-11-01T08:00:00.000Z";

// --- fixtures -----------------------------------------------------------------------------------

const briefingPage = (name: string, patch: Partial<ContentBriefingPage> = {}): ContentBriefingPage => ({
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name,
  path: null,
  level: 1,
  position: 0,
  page_role: "supporting",
  page_type: "unterseite",
  pillar_name: null,
  source_url: null,
  estimated_traffic: null,
  keywords: null,
  h1_options: [],
  user_questions: [],
  ki_prompt: null,
  internal_link_targets: [],
  ...patch,
});

const file = (id: string, file_name: string, patch: Partial<UploadMatchFile> = {}): UploadMatchFile => ({
  id,
  file_name,
  name_key: pageNameKey(file_name),
  structure_slug: null,
  match: null,
  match_note: null,
  error: null,
  ...patch,
});

/** A minimal Word file: `# ` lines are Heading 1, `## ` Heading 2, everything else a paragraph. */
async function docx(lines: readonly string[]): Promise<Uint8Array> {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraph = (line: string) => {
    const heading = line.match(/^(#{1,2}) (.*)$/);
    const style = heading ? `<w:pPr><w:pStyle w:val="Heading${heading[1]!.length}"/></w:pPr>` : "";
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${esc(heading ? heading[2]! : line)}</w:t></w:r></w:p>`;
  };
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(paragraph).join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const structureRow = (pages: ContentBriefingPage[]): FakeRow => ({
  organisation_id: ORG,
  filename: "struktur.xlsx",
  raw_text: pages.map((p) => `- ${p.name}`).join("\n"),
  uploaded_at: UPLOADED_AT,
  content_briefing: { mode: "crawl", uploaded_at: UPLOADED_AT, columns: "briefing", pages },
});

const uploadRow = (id: string, file_name: string, patch: FakeRow = {}): FakeRow => ({
  id,
  organisation_id: ORG,
  file_name,
  name_key: pageNameKey(file_name),
  format: "docx",
  blocks: [
    { id: "abschnitt-1", heading: file_name.replace(/\.docx$/i, ""), level: 1, html: "<p>Bisheriger Text.</p>" },
    { id: "abschnitt-2", heading: "Ablauf", level: 2, html: "<p>Drei Termine.</p><ul><li>Beratung</li></ul>" },
  ],
  title: null,
  meta_description: null,
  chars: 60,
  block_count: 2,
  structure_slug: null,
  match: null,
  match_note: null,
  page_id: null,
  error: null,
  uploaded_at: `2026-11-02T08:00:0${id.length % 10}.000Z`,
  ...patch,
});

const contentRow = (id: string, slug: string, patch: FakeRow = {}): FakeRow => ({
  id,
  organisation_id: ORG,
  slug,
  name: slug,
  path: null,
  source: "structure",
  source_url: null,
  position: 0,
  state: "nicht_begonnen",
  html: "",
  skip_steps: [],
  ...patch,
});

const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID,
  organisation_id: ORG,
  slug: "implantate",
  name: "Implantate",
  path: "/implantate",
  level: 1,
  position: 0,
  source: "upload",
  source_url: null,
  crawled_at: null,
  main_keyword: null,
  page_role: "supporting",
  page_type: "unterseite",
  pillar_name: null,
  estimated_traffic: null,
  keywords: null,
  h1_options: [],
  user_questions: [],
  ki_prompt: null,
  internal_link_targets: [],
  state: "laeuft",
  step: 1,
  released: false,
  released_at: null,
  title: null,
  meta_description: null,
  html: "",
  markdown: "",
  findings: [],
  final_findings: [],
  unresolved: [],
  questions: [],
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  skip_steps: [],
  client_wishes: "",
  question_stop: { handled: [] },
  error: null,
  job_id: JOB_ID,
  cost_eur: 0,
  started_by: null,
  created_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  ...patch,
});

// --- 1. the name key --------------------------------------------------------------------------------

function nameKeyTests() {
  assert.equal(pageNameKey("Kontakt / Anfahrt"), pageNameKey("Kontakt Anfahrt.docx"));
  assert.equal(pageNameKey("Kontakt / Anfahrt"), "kontakt anfahrt");
  assert.equal(pageNameKey("Was kostet ein Dach?"), pageNameKey("Was kostet ein Dach.docx"));
  assert.equal(pageNameKey("Über uns"), pageNameKey("ueber_uns.docx"));
  assert.equal(pageNameKey("Über uns"), "ueber uns");
  assert.equal(pageNameKey("  Leistungen   &  Preise  "), "leistungen & preise", "double spaces collapse, the ends are trimmed");
  assert.equal(pageNameKey("Dachsanierung..."), "dachsanierung", "trailing dots go");
  assert.equal(pageNameKey("Dachsanierung. .docx"), "dachsanierung");
  assert.equal(pageNameKey("DACHDECKER KÖLN.DOCX"), "dachdecker koeln", "upper case, also in the extension");
  assert.equal(pageNameKey("Straße-Fuß_Weg"), "strasse fuss weg");
  assert.equal(pageNameKey("A\\B:C*D?E\"F<G>H|I"), "a b c d e f g h i", "every character a file name may not contain is a space");
  assert.equal(pageNameKey("Über uns"), "ueber uns", "NFC first: a combining umlaut is an umlaut");
  // No other rules.
  assert.notEqual(pageNameKey("Kontakt (1).docx"), pageNameKey("Kontakt"));
  assert.notEqual(pageNameKey("Kontakt - Kopie.docx"), pageNameKey("Kontakt"));
  assert.notEqual(pageNameKey("Kontackt.docx"), pageNameKey("Kontakt"), "no fuzzy comparison");
  assert.equal(pageNameKey("Preise.doc"), "preise.doc", "only .docx is an extension here");
  assert.equal(pageNameKey("Version 2.0"), "version 2.0", "a dot inside a page name stays");
  console.log("pageNameKey: ok");
}

// --- 2. the matching ---------------------------------------------------------------------------------

function matchingTests() {
  const pages = [
    briefingPage("Kontakt / Anfahrt", { slug: "kontakt" }),
    briefingPage("Über uns", { slug: "ueber-uns" }),
    briefingPage("Leistungen", { slug: "leistungen", path: "/leistungen" }),
    briefingPage("Leistungen", { slug: "leistungen-2", path: "/koeln/leistungen" }),
    briefingPage("Preise", { slug: "preise" }),
  ];
  const status = (files: UploadMatchFile[], against: ContentBriefingPage[] | null = pages) =>
    matchTextUploads(files, against).map((r) => [r.status, r.structure_slug, r.match]);

  // Unique, none, ambiguous.
  const basic = matchTextUploads(
    [file("a", "Kontakt Anfahrt.docx"), file("b", "ueber_uns.docx"), file("c", "Team.docx"), file("d", "Leistungen.docx")],
    pages,
  );
  assert.deepEqual(basic.map((r) => [r.status, r.structure_slug, r.match]), [
    ["auto", "kontakt", "auto"],
    ["auto", "ueber-uns", "auto"],
    ["unassigned", null, null],
    ["ambiguous", null, null],
  ]);
  assert.match(basic[3]!.match_note ?? "", /„Leistungen“ \(\/leistungen\), „Leistungen“ \(\/koeln\/leistungen\)/, "the hint names the pages");

  // Several files with the same key: the first is assigned, the others are „doppelt“.
  const dup = matchTextUploads([file("a", "Über uns.docx"), file("b", "ueber_uns.docx"), file("c", "UEBER-UNS.docx")], pages);
  assert.deepEqual(dup.map((r) => [r.status, r.structure_slug]), [["auto", "ueber-uns"], ["duplicate", null], ["duplicate", null]]);
  assert.match(dup[1]!.match_note ?? "", /„Über uns\.docx“/);

  // Manual wins: a manual assignment is never re-matched, and its page takes no second file.
  const manual = [
    file("m", "Wir.docx", { structure_slug: "ueber-uns", match: "manual" }),
    file("a", "Über uns.docx"),
    file("p", "Preise.docx", { structure_slug: "kontakt", match: "manual" }),
    file("k", "Kontakt Anfahrt.docx"),
  ];
  assert.deepEqual(status(manual), [
    ["manual", "ueber-uns", "manual"],
    ["duplicate", null, null],
    ["manual", "kontakt", "manual"],
    ["duplicate", null, null],
  ]);
  assert.match(matchTextUploads(manual, pages)[1]!.match_note ?? "", /hat bereits die Datei „Wir\.docx“/);

  // A re-match (new Seitenstruktur, new files) only touches files that are not manual.
  const renamed = [briefingPage("Unternehmen", { slug: "ueber-uns" }), briefingPage("Preise", { slug: "preise" }), briefingPage("Wir", { slug: "wir" })];
  const before = matchTextUploads([file("m", "Wir.docx", { structure_slug: "ueber-uns", match: "manual" }), file("a", "Preise.docx")], pages);
  const again = matchTextUploads(
    [file("m", "Wir.docx", { ...before[0]! }), file("a", "Preise.docx", { ...before[1]! })],
    renamed,
  );
  assert.deepEqual(again.map((r) => [r.status, r.structure_slug]), [["manual", "ueber-uns"], ["auto", "preise"]], "the manual file keeps its page although „Wir“ now exists by name");
  // An automatic assignment follows the new structure.
  const moved = matchTextUploads([file("a", "Preise.docx", { structure_slug: "preise", match: "auto" })], [briefingPage("Kosten", { slug: "preise" })]);
  assert.deepEqual([moved[0]!.status, moved[0]!.structure_slug], ["unassigned", null], "auto follows the name, not the old slug");

  // A manual assignment whose page disappeared.
  const gone = matchTextUploads([file("m", "Wir.docx", { structure_slug: "ueber-uns", match: "manual" })], [briefingPage("Preise", { slug: "preise" })]);
  assert.deepEqual(gone[0], { id: "m", structure_slug: null, match: "manual", match_note: UPLOAD_PAGE_GONE_NOTE, status: "unassigned", ai_tried_at: null, ai_reason: null });
  assert.equal(UPLOAD_PAGE_GONE_NOTE, "Seite nicht mehr in der Seitenstruktur");
  // … stays „nicht zugeordnet“ with the hint, also when a page of its name turns up: by hand only.
  const stays = matchTextUploads([file("m", "Wir.docx", { ...gone[0]! })], [briefingPage("Wir", { slug: "wir" })]);
  assert.deepEqual([stays[0]!.status, stays[0]!.structure_slug, stays[0]!.match_note], ["unassigned", null, UPLOAD_PAGE_GONE_NOTE]);

  // No Seitenstruktur yet: the files wait.
  assert.deepEqual(status([file("a", "Preise.docx"), file("e", "Kaputt.docx", { error: "nicht lesbar" })], null), [
    ["waiting", null, null],
    ["error", null, null],
  ]);
  // … and are matched as soon as it arrives.
  assert.deepEqual(status([file("a", "Preise.docx")]), [["auto", "preise", "auto"]]);
  // A file that could not be read is never assigned and blocks nothing.
  assert.deepEqual(status([file("e", "Preise.docx", { error: "nicht lesbar" }), file("a", "preise.docx")]), [
    ["error", null, null],
    ["auto", "preise", "auto"],
  ]);
  // Deterministic: the same input gives the same output.
  assert.deepEqual(matchTextUploads(manual, pages), matchTextUploads(manual, pages));
  console.log("matching: ok");
}

// --- 2b. the AI step: stored assignments in the pure matching -------------------------------------

function aiMatchingTests() {
  const pages = [
    briefingPage("Über uns", { slug: "ueber-uns" }),
    briefingPage("Preise", { slug: "preise" }),
    briefingPage("Kosten", { slug: "kosten", path: "/privatumzug/kosten", pillar_name: "Privatumzug" }),
    briefingPage("Kosten", { slug: "kosten-2", path: "/firmenumzug/kosten", pillar_name: "Firmenumzug" }),
    briefingPage("Team", { slug: "team" }),
  ];
  const shape = (files: UploadMatchFile[], against: ContentBriefingPage[] | null = pages) =>
    matchTextUploads(files, against).map((r) => [r.status, r.structure_slug, r.match]);
  const ai = (id: string, name: string, slug: string, patch: Partial<UploadMatchFile> = {}) =>
    file(id, name, { structure_slug: slug, match: "ai", ai_reason: "Tippfehler im Namen", ...patch });

  // The order: manual, then the name rule, then the stored AI assignments.
  const order = [
    ai("k", "Preisliste final (1).docx", "preise"),
    file("a", "Über uns.docx"),
    file("m", "Wir.docx", { structure_slug: "team", match: "manual" }),
    ai("t", "Tema.docx", "team"),
    ai("x", "Kosten Privat.docx", "kosten"),
  ];
  const ordered = matchTextUploads(order, pages);
  assert.deepEqual(ordered.map((r) => [r.status, r.structure_slug, r.match]), [
    ["ai", "preise", "ai"],
    ["auto", "ueber-uns", "auto"],
    ["manual", "team", "manual"],
    ["unassigned", null, null],
    ["ai", "kosten", "ai"],
  ]);
  assert.equal(ordered[0]!.ai_reason, "Tippfehler im Namen", "a kept AI assignment keeps its reason");
  assert.equal(ordered[1]!.ai_reason, null);
  // … the AI file whose page a manual file has is released, with a note, and may be tried again.
  assert.equal(ordered[3]!.match_note, "KI-Zuordnung aufgehoben: Seite hat jetzt die Datei „Wir.docx“");
  assert.deepEqual([ordered[3]!.ai_tried_at, ordered[3]!.ai_reason], [null, null]);

  // The name rule wins over a stored AI assignment: a later file with the exact name takes the page.
  const exact = matchTextUploads([ai("k", "Preisliste.docx", "preise"), file("p", "Preise.docx")], pages);
  assert.deepEqual(exact.map((r) => [r.status, r.structure_slug, r.match]), [["unassigned", null, null], ["auto", "preise", "auto"]]);
  assert.equal(exact[0]!.match_note, "KI-Zuordnung aufgehoben: Seite hat jetzt die Datei „Preise.docx“");
  // … and an AI file whose own name now matches a page exactly is „automatisch“ from then on.
  assert.deepEqual(shape([ai("k", "Team.docx", "preise")]), [["auto", "team", "auto"]]);

  // The page is gone from the Seitenstruktur.
  const without = pages.filter((p) => p.slug !== "preise");
  const gone = matchTextUploads([ai("k", "Preisliste.docx", "preise", { ai_tried_at: "2026-10-01T00:00:00.000Z" })], without);
  assert.deepEqual(gone[0], {
    id: "k",
    structure_slug: null,
    match: null,
    match_note: `KI-Zuordnung aufgehoben: ${UPLOAD_PAGE_GONE_NOTE}`,
    status: "unassigned",
    ai_tried_at: null,
    ai_reason: null,
  });
  // The note survives the next reads (the matching runs on every one), as long as the file is open.
  const reread = matchTextUploads([file("k", "Preisliste.docx", { ...gone[0]! })], without);
  assert.deepEqual(reread[0], gone[0]);
  // … and is gone as soon as the file has a page.
  assert.equal(matchTextUploads([file("k", "Preise.docx", { ...gone[0]! })], pages)[0]!.match_note, null);

  // Two AI files on one page (never stored like that): the first keeps it.
  assert.deepEqual(shape([ai("a", "Preisliste.docx", "preise"), ai("b", "Preise neu.docx", "preise")]), [
    ["ai", "preise", "ai"],
    ["unassigned", null, null],
  ]);
  // An AI assignment settles a „mehrdeutig“ file („Kosten“ exists twice).
  assert.deepEqual(shape([ai("k", "Kosten.docx", "kosten-2")]), [["ai", "kosten-2", "ai"]]);
  // No Seitenstruktur: nothing is assigned; a manual decision on a former AI row is manual.
  assert.deepEqual(shape([ai("k", "Preisliste.docx", "preise")], null), [["waiting", null, null]]);
  assert.deepEqual(shape([file("k", "Preisliste.docx", { structure_slug: "team", match: "manual", ai_reason: "alt" })]), [["manual", "team", "manual"]]);

  // What the AI wrote onto a file it could not assign stays readable.
  const tried = file("n", "Sonstiges.docx", { match_note: UPLOAD_AI_NO_PAGE_NOTE, ai_tried_at: "2026-11-03T00:00:00.000Z" });
  const kept = matchTextUploads([tried], pages)[0]!;
  assert.deepEqual([kept.status, kept.match_note, kept.ai_tried_at], ["unassigned", UPLOAD_AI_NO_PAGE_NOTE, "2026-11-03T00:00:00.000Z"]);
  const ambiguous = matchTextUploads([file("k", "Kosten.docx", { match_note: UPLOAD_AI_NO_PAGE_NOTE, ai_tried_at: "2026-11-03T00:00:00.000Z" })], pages)[0]!;
  assert.equal(ambiguous.status, "ambiguous");
  assert.match(ambiguous.match_note ?? "", /^Mehrere Seiten der Seitenstruktur heißen so: .* · KI hat keine passende Seite gefunden/);
  assert.equal(matchTextUploads([file("k", "Kosten.docx", { ...ambiguous })], pages)[0]!.match_note, ambiguous.match_note, "stable over reads");
  assert.deepEqual(matchTextUploads(order, pages), matchTextUploads(order, pages), "deterministic");

  // Who the AI looks at.
  const structureAt = "2026-11-05T00:00:00.000Z";
  const candidates = [
    file("new", "Preisliste.docx"),
    file("old", "Sonstiges.docx", { ai_tried_at: "2026-11-04T00:00:00.000Z" }),
    file("seen", "Anderes.docx", { ai_tried_at: "2026-11-06T00:00:00.000Z" }),
    file("amb", "Kosten.docx"),
    file("off", "Abgelöst.docx", { match: "manual", match_note: "Zuordnung von Hand gelöst" }),
    file("err", "Kaputt.docx", { error: "nicht lesbar" }),
    file("auto", "Team.docx"),
    ai("ki", "Über uns Seite.docx", "ueber-uns"),
  ];
  const matched = matchTextUploads(candidates, pages);
  assert.deepEqual(aiMatchCandidateIds(candidates, matched, structureAt), ["new", "old", "amb"], "untried, or tried before the Seitenstruktur was uploaded");
  assert.deepEqual(aiMatchCandidateIds(candidates, matched, structureAt, true), ["new", "old", "seen", "amb"], "force: also the ones tried since");
  assert.deepEqual(aiMatchCandidateIds(candidates, matched, null), ["new", "amb"], "no upload date: only the untried");
  assert.deepEqual(aiMatchCandidateIds(candidates, matchTextUploads(candidates, null), structureAt, true), [], "no Seitenstruktur: nothing to ask");
  console.log("ai matching (pure): ok");
}

// --- 2c. the AI step itself, with a stubbed model call ----------------------------------------------

type AiCallLog = Array<Parameters<UploadAiMatchCall>[0]>;

/** A model stub: answers with `matches` built from the files and pages it was sent. */
function aiStub(log: AiCallLog, answer: (refOf: (fileName: string) => string) => Array<Record<string, unknown>>): UploadAiMatchCall {
  return async (input) => {
    log.push(input);
    const refs = new Map<string, string>();
    for (const line of input.user.split("\n")) {
      if (!line.startsWith('{"file_id"')) continue;
      const row = JSON.parse(line) as { file_id: string; datei: string };
      refs.set(row.datei, row.file_id);
    }
    const matches = answer((name) => refs.get(name) ?? "unbekannt").filter((m) => m.file_id !== "unbekannt");
    return { json: { matches }, usage: { inputTokens: 1_000, outputTokens: 200 }, model: "claude-sonnet-5-5" };
  };
}

async function aiStepTests() {
  // Pure parts first: evidence, prompt, validation, model list.
  const blocks: ContentTextBlock[] = [
    { id: "a", heading: "Privatumzug   Kosten", level: 1, html: "<p>x</p>" },
    { id: "b", heading: null, level: 2, html: "<p>y</p>" },
    { id: "c", heading: "Was kostet ein Umzug?", level: 2, html: "" },
    { id: "d", heading: "Privatumzug Kosten", level: 2, html: "" },
    { id: "e", heading: "L".repeat(400), level: 2, html: "" },
    { id: "f", heading: "Nicht mehr", level: 2, html: "" },
  ];
  assert.deepEqual(uploadEvidence("  Kosten | Steiner ", blocks), { title: "Kosten | Steiner", headings: ["Privatumzug Kosten", "Was kostet ein Umzug?"] });
  assert.deepEqual(uploadEvidence(null, []), { title: null, headings: [] });

  const offered = [
    briefingPage("Kosten", { slug: "kosten", path: "/privatumzug/kosten", level: 2, pillar_name: "Privatumzug" }),
    briefingPage("Kosten", { slug: "kosten-2", path: "/firmenumzug/kosten", level: 2, pillar_name: "Firmenumzug" }),
    briefingPage("Impressum", { slug: "impressum", page_role: "pillar", page_type: "nicht_bearbeiten" }),
  ];
  const prompt = uploadAiMatchPrompt([{ ref: "f1", file_name: "Kosten Firmen_final (1).docx", title: "Umzugskosten für Firmen", headings: ["Firmenumzug: Kosten"] }], offered);
  assert.ok(prompt.user.includes('{"slug":"kosten-2","name":"Kosten","pfad":"/firmenumzug/kosten","ebene":2,"rolle":"Unterseite","hauptsilo":"Firmenumzug","typ":"Unterseite"}'), "a page with path, level, role and Hauptsilo");
  assert.ok(prompt.user.includes('"slug":"impressum"') && prompt.user.includes('"typ":"Nicht bearbeiten"'), "„Nicht bearbeiten“ pages are offered, marked with their type");
  assert.ok(prompt.user.includes('{"file_id":"f1","datei":"Kosten Firmen_final (1).docx","titel":"Umzugskosten für Firmen","ueberschriften":["Firmenumzug: Kosten"]}'));
  assert.match(prompt.system, /gib null zurück/);
  assert.match(prompt.system, /Nie zwei Dateien auf dieselbe Seite/);
  assert.match(prompt.system, /Erfinde keine Slugs/);
  assert.deepEqual((prompt.tool.input_schema as { required: string[] }).required, ["matches"]);
  assert.ok(prompt.maxTokens <= 1_000, "a small output budget for one file");
  assert.ok(uploadAiMatchPrompt(Array.from({ length: 500 }, (_, i) => ({ ref: `f${i}`, file_name: "x.docx", title: null, headings: [] })), offered).maxTokens <= 8_000);

  const slugs = new Set(["preise", "team", "kosten"]);
  const checked = validateUploadAiMatches(
    [
      {
        matches: [
          { file_id: "f1", page_slug: "preise", reason: "  Tippfehler:\n Preisliste  " },
          { file_id: "f2", page_slug: "erfunden", reason: "geraten" },
          { file_id: "f3", page_slug: null, reason: "nichts passt" },
          { file_id: "f4", page_slug: "team", reason: "a" },
          { file_id: "f1", page_slug: "team", reason: "second entry of the same file" },
          { file_id: "f9", page_slug: "kosten", reason: "unknown file" },
          "kein Objekt",
        ],
      },
      // A second call of the same run names the same page for another file.
      { matches: [{ file_id: "f5", page_slug: "team", reason: "b" }, { file_id: "f6", page_slug: "", reason: "" }] },
      null,
    ],
    ["f1", "f2", "f3", "f4", "f5", "f6", "f7"],
    slugs,
  );
  assert.deepEqual([...checked], [
    ["f1", { kind: "page", slug: "preise", reason: "Tippfehler: Preisliste" }],
    ["f2", { kind: "none" }],
    ["f3", { kind: "none" }],
    ["f4", { kind: "conflict" }],
    ["f5", { kind: "conflict" }],
    ["f6", { kind: "none" }],
    ["f7", { kind: "none" }],
  ]);

  assert.equal(DEFAULT_CONTENT_MATCH_MODEL, "claude-sonnet-5-5");
  const write = ["claude-sonnet-4-6", "claude-sonnet-4-20250514"];
  assert.deepEqual(resolveContentMatchModels(null, write, {}), { models: ["claude-sonnet-5-5", ...write], source: "default" });
  assert.deepEqual(resolveContentMatchModels(null, write, { ANTHROPIC_DT_CONTENT_MATCH_MODEL: "claude-haiku-5-5" }).models, ["claude-haiku-5-5", ...write]);
  assert.deepEqual(resolveContentMatchModels(" claude-sonnet-4-6 ", write, { ANTHROPIC_DT_CONTENT_MATCH_MODEL: "x" }), { models: write, source: "app_settings" });
  assert.equal(UPLOAD_AI_MATCH_USAGE_MODE, "content.upload_match");

  // The run on a database.
  const pages = [
    briefingPage("Startseite", { slug: "startseite", path: "/", level: 0, page_role: "startseite", page_type: "startseite" }),
    briefingPage("Privatumzug", { slug: "privatumzug", path: "/privatumzug", page_role: "pillar", page_type: "hauptsilo" }),
    briefingPage("Kosten", { slug: "kosten", path: "/privatumzug/kosten", level: 2, pillar_name: "Privatumzug" }),
    briefingPage("Firmenumzug", { slug: "firmenumzug", path: "/firmenumzug", page_role: "pillar", page_type: "hauptsilo" }),
    briefingPage("Kosten", { slug: "kosten-2", path: "/firmenumzug/kosten", level: 2, pillar_name: "Firmenumzug" }),
    briefingPage("Über uns", { slug: "ueber-uns", path: "/ueber-uns", page_role: "pillar", page_type: "ueber_uns" }),
    briefingPage("Impressum", { slug: "impressum", path: "/impressum", page_role: "pillar", page_type: "nicht_bearbeiten" }),
  ];
  const at = (n: number) => `2026-11-02T08:00:${String(n).padStart(2, "0")}.000Z`;
  const db = new FakeDb({
    dt_website_structures: [structureRow(pages)],
    dt_content_text_uploads: [
      uploadRow("u1", "Startseite.docx", { uploaded_at: at(1) }),
      uploadRow("u2", "Privatumzg final (1).docx", { uploaded_at: at(2), title: "Privatumzug in Köln" }),
      uploadRow("u3", "Kosten Firmen Kopie.docx", { uploaded_at: at(3) }),
      uploadRow("u4", "Wir über uns 2026-10-01.docx", { uploaded_at: at(4) }),
      uploadRow("u5", "Unser Team.docx", { uploaded_at: at(5) }),
      uploadRow("u6", "Kosten.docx", { uploaded_at: at(6) }),
      uploadRow("u7", "Impresum.docx", { uploaded_at: at(7) }),
      uploadRow("u8", "Notizen.docx", { uploaded_at: at(8) }),
      uploadRow("u9", "Abgelöst.docx", { uploaded_at: at(9), match: "manual", match_note: "Zuordnung von Hand gelöst" }),
      uploadRow("ue", "Kaputt.docx", { uploaded_at: at(10), error: "nicht lesbar", blocks: [], block_count: 0 }),
    ],
    dt_content_pages: [],
  });
  const stored = (id: string) => {
    const row = db.rows("dt_content_text_uploads").find((r) => r.id === id)!;
    return [row.structure_slug ?? null, row.match ?? null, row.match_note ?? null];
  };

  // Before the AI ran: the table says how many files wait for it.
  const before = await loadTextUploadsResult(db.service, ORG);
  assert.deepEqual([before.ai.supported, before.ai.hint, before.ai.candidates, before.ai.candidates_all], [true, null, 7, 7]);
  assert.deepEqual(before.summary, { assigned: 1, auto: 1, ai: 0, manual: 0, unassigned: 9, pages_without_text: 5, pending: 1 });

  const log: AiCallLog = [];
  const call = aiStub(log, (ref) => [
    { file_id: ref("Privatumzg final (1).docx"), page_slug: "privatumzug", reason: "Tippfehler und Zusatz „final (1)“" },
    { file_id: ref("Kosten Firmen Kopie.docx"), page_slug: "kosten-2", reason: "Kosten unter dem Hauptsilo Firmenumzug" },
    // Two files on one page: neither gets it.
    { file_id: ref("Wir über uns 2026-10-01.docx"), page_slug: "ueber-uns", reason: "Datum im Namen" },
    { file_id: ref("Unser Team.docx"), page_slug: "ueber-uns", reason: "Team gehört zu Über uns" },
    // Not clearly one of the two „Kosten“ pages.
    { file_id: ref("Kosten.docx"), page_slug: null, reason: "zwei Seiten heißen Kosten" },
    { file_id: ref("Impresum.docx"), page_slug: "impressum", reason: "Tippfehler" },
    // A slug that was not offered (the Startseite has a file).
    { file_id: ref("Notizen.docx"), page_slug: "startseite", reason: "geraten" },
  ]);
  const first = await aiMatchTextUploads(db.service, ORG, { call, models: ["claude-sonnet-5-5", "claude-sonnet-4-6"], userId: USER });
  assert.ok(first.ok);
  assert.deepEqual(first.data, { tried: 7, assigned: 3, conflicts: 2, model: "claude-sonnet-5-5" });
  assert.equal(log.length, 1, "one call for all candidates");
  const sent = log[0]!;
  assert.deepEqual(sent.models, ["claude-sonnet-5-5", "claude-sonnet-4-6"]);
  assert.equal(sent.timeoutMs, UPLOAD_AI_MATCH_TIMEOUT_MS);
  assert.equal(UPLOAD_AI_MATCH_TIMEOUT_MS, 60_000);
  assert.ok(!sent.user.includes("Startseite.docx") && !sent.user.includes("Abgelöst.docx") && !sent.user.includes("Kaputt.docx"), "assigned, hand-detached and unreadable files are not sent");
  assert.ok(!sent.user.includes('"slug":"startseite"'), "a page that has a file is not offered");
  assert.ok(sent.user.includes('"slug":"impressum"'), "a free „Nicht bearbeiten“ page is offered");
  assert.ok(sent.user.includes('"datei":"Privatumzg final (1).docx","titel":"Privatumzug in Köln","ueberschriften":["Privatumzg final (1)","Ablauf"]'), "title and first headings as evidence");
  assert.ok(!sent.user.includes("u2"), "row ids are not sent, only short references");

  assert.deepEqual(stored("u2"), ["privatumzug", "ai", null]);
  assert.deepEqual(stored("u3"), ["kosten-2", "ai", null]);
  assert.deepEqual(stored("u7"), ["impressum", "ai", null]);
  assert.deepEqual(stored("u4"), [null, null, UPLOAD_AI_CONFLICT_NOTE]);
  assert.deepEqual(stored("u5"), [null, null, UPLOAD_AI_CONFLICT_NOTE]);
  assert.deepEqual(stored("u6"), [null, null, UPLOAD_AI_NO_PAGE_NOTE]);
  assert.deepEqual(stored("u8"), [null, null, UPLOAD_AI_NO_PAGE_NOTE], "an invented slug is no match");
  assert.deepEqual(stored("u9"), [null, "manual", "Zuordnung von Hand gelöst"], "a file taken off by hand is never touched");
  assert.equal(UPLOAD_AI_NO_PAGE_NOTE, "KI hat keine passende Seite gefunden – bitte von Hand zuordnen");
  assert.match(UPLOAD_AI_CONFLICT_NOTE, /^KI: mehrere Dateien für dieselbe Seite/);
  const rowOf = (id: string) => db.rows("dt_content_text_uploads").find((r) => r.id === id)!;
  assert.equal(rowOf("u3").ai_reason, "Kosten unter dem Hauptsilo Firmenumzug");
  assert.equal(rowOf("u3").ai_tried_at, null);
  assert.ok(typeof rowOf("u6").ai_tried_at === "string" && typeof rowOf("u4").ai_tried_at === "string", "files without a page are marked as tried");
  const usage = db.rows("dt_llm_usage_events");
  assert.deepEqual(usage.map((u) => [u.mode, u.model, u.input_tokens, u.output_tokens, u.user_id, u.organisation_id]), [["content.upload_match", "claude-sonnet-5-5", 1_000, 200, USER, ORG]]);

  // The table after the run.
  const view = await loadTextUploadsResult(db.service, ORG);
  const byId = new Map(view.uploads.map((u) => [u.id, u]));
  assert.deepEqual([byId.get("u3")!.status, byId.get("u3")!.structure, byId.get("u3")!.ai_reason], ["ai", { slug: "kosten-2", name: "Kosten", path: "/firmenumzug/kosten" }, "Kosten unter dem Hauptsilo Firmenumzug"]);
  assert.equal(byId.get("u6")!.status, "ambiguous");
  assert.match(byId.get("u6")!.note ?? "", /Mehrere Seiten .* · KI hat keine passende Seite gefunden – bitte von Hand zuordnen$/);
  assert.deepEqual([byId.get("u8")!.status, byId.get("u8")!.note], ["unassigned", UPLOAD_AI_NO_PAGE_NOTE], "the note survives the read");
  assert.deepEqual(view.summary, { assigned: 4, auto: 1, ai: 3, manual: 0, unassigned: 6, pages_without_text: 3, pending: 4 });
  assert.deepEqual([view.ai.candidates, view.ai.candidates_all], [0, 4], "tried files wait for the button, not for the automatic run");

  // Tried files are skipped …
  const again = await aiMatchTextUploads(db.service, ORG, { call, models: ["m"] });
  assert.ok(again.ok);
  assert.deepEqual(again.data, { tried: 0, assigned: 0, conflicts: 0, model: null });
  assert.equal(log.length, 1, "no model call without candidates");
  // … until „Mit KI zuordnen“ (force), which sends them again, with the free pages only.
  const forcedLog: AiCallLog = [];
  const forced = await aiMatchTextUploads(db.service, ORG, {
    force: true,
    models: ["m"],
    call: aiStub(forcedLog, (ref) => [{ file_id: ref("Wir über uns 2026-10-01.docx"), page_slug: "ueber-uns", reason: "Datum im Namen" }]),
  });
  assert.ok(forced.ok);
  assert.deepEqual(forced.data, { tried: 4, assigned: 1, conflicts: 0, model: "claude-sonnet-5-5" });
  assert.ok(!forcedLog[0]!.user.includes('"slug":"kosten-2"') && forcedLog[0]!.user.includes('"slug":"kosten"'));
  assert.deepEqual(stored("u4"), ["ueber-uns", "ai", null]);
  assert.deepEqual(stored("u5"), [null, null, UPLOAD_AI_NO_PAGE_NOTE], "a file the answer leaves out has no page");

  // … or a new Seitenstruktur: files tried before it are candidates again.
  db.rows("dt_website_structures")[0]!.uploaded_at = "2099-01-01T00:00:00.000Z";
  (db.rows("dt_website_structures")[0]!.content_briefing as { uploaded_at: string }).uploaded_at = "2099-01-01T00:00:00.000Z";
  assert.equal((await loadTextUploadsResult(db.service, ORG)).ai.candidates, 3);

  // By hand on a KI row: another page, then „Zuordnung lösen“. Both are manual and stay.
  assert.ok((await assignTextUpload(db.service, ORG, "u3", "kosten")).ok);
  assert.deepEqual(stored("u3"), ["kosten", "manual", null]);
  const taken = await assignTextUpload(db.service, ORG, "u6", "ueber-uns");
  assert.ok(!taken.ok && taken.status === 409 && /hat bereits die Datei „Wir über uns 2026-10-01\.docx“/.test(taken.message), "a KI page takes no second file by hand either");
  assert.ok((await assignTextUpload(db.service, ORG, "u7", null)).ok);
  assert.deepEqual(stored("u7"), [null, "manual", "Zuordnung von Hand gelöst"]);
  const afterHand = await loadTextUploadsResult(db.service, ORG);
  const hand = new Map(afterHand.uploads.map((u) => [u.id, u]));
  assert.deepEqual([hand.get("u3")!.status, hand.get("u3")!.ai_reason, hand.get("u7")!.status], ["manual", null, "unassigned"]);
  assert.equal(rowOf("u3").ai_reason, null, "the AI's reason goes with its assignment");
  const afterHandLog: AiCallLog = [];
  const afterHandRun = await aiMatchTextUploads(db.service, ORG, {
    force: true,
    models: ["m"],
    call: aiStub(afterHandLog, (ref) => [{ file_id: ref("Impresum.docx"), page_slug: "impressum", reason: "nochmal" }, { file_id: ref("Kosten.docx"), page_slug: "kosten-2", reason: "übrig" }]),
  });
  assert.ok(afterHandRun.ok);
  assert.ok(!afterHandLog[0]!.user.includes("Impresum.docx") && !afterHandLog[0]!.user.includes("Kosten Firmen Kopie.docx"), "manual decisions are not sent to the AI");
  assert.deepEqual(stored("u7"), [null, "manual", "Zuordnung von Hand gelöst"], "the manual decision wins");
  assert.deepEqual(stored("u6"), ["kosten-2", "ai", null]);

  // „Zugeordnete Seiten übernehmen“ takes KI assignments like the others.
  const takeover = await takeOverTextUploads(db.service, ORG);
  assert.ok(takeover.ok);
  assert.equal(takeover.data.created, 5);
  const created = db.rows("dt_content_pages");
  assert.deepEqual(created.map((r) => r.slug).sort(), ["kosten", "kosten-2", "privatumzug", "startseite", "ueber-uns"], "auto, KI and manual assignments alike");
  assert.ok(created.some((r) => r.slug === "kosten-2" && r.text_upload_id === "u6" && r.source === "upload"), "the KI-assigned file is the page's text");

  // The AI assignment is released when its page leaves the Seitenstruktur, and may be tried again.
  Object.assign(db.rows("dt_website_structures")[0]!, {
    raw_text: pages.filter((p) => p.slug !== "privatumzug").map((p) => `- ${p.name}`).join("\n"),
    uploaded_at: "2099-01-02T00:00:00.000Z",
    content_briefing: { mode: "crawl", uploaded_at: "2099-01-02T00:00:00.000Z", columns: "briefing", pages: pages.filter((p) => p.slug !== "privatumzug") },
  });
  const released = await loadTextUploadsResult(db.service, ORG);
  const gone = released.uploads.find((u) => u.id === "u2")!;
  assert.deepEqual([gone.status, gone.note, gone.ai_reason], ["unassigned", `KI-Zuordnung aufgehoben: ${UPLOAD_PAGE_GONE_NOTE}`, null]);
  assert.deepEqual([rowOf("u2").match ?? null, rowOf("u2").ai_tried_at ?? null], [null, null]);

  // A failed call assigns nothing; the reason is passed on.
  const failDb = new FakeDb({
    dt_website_structures: [structureRow(pages)],
    dt_content_text_uploads: [uploadRow("a", "Privatumzg.docx", { uploaded_at: at(1) }), uploadRow("b", "Ueber uns Seite.docx", { uploaded_at: at(2) })],
  });
  const snapshot = JSON.stringify(failDb.rows("dt_content_text_uploads"));
  const failedRun = await aiMatchTextUploads(failDb.service, ORG, {
    models: ["m"],
    call: async () => {
      throw new Error("Ausgabe unvollständig (Zeitlimit erreicht). Der Schritt wird einmal erneut versucht.");
    },
  });
  assert.ok(!failedRun.ok && failedRun.status === 502);
  assert.match(failedRun.message, /^Die KI-Zuordnung ist fehlgeschlagen, es wurde nichts zugeordnet: Ausgabe unvollständig \(Zeitlimit erreicht\)/);
  assert.equal(JSON.stringify(failDb.rows("dt_content_text_uploads")), snapshot, "nothing is written, the files stay „nicht zugeordnet“");
  assert.equal((await loadTextUploadsResult(failDb.service, ORG)).ai.candidates, 2, "and wait for the next try");

  // More files than one call takes: several calls, checked together; one failing call voids the run.
  const manyPages = Array.from({ length: 130 }, (_, i) => briefingPage(`Leistung ${i}`, { slug: `leistung-${i}`, position: i }));
  const manyRows = () => manyPages.map((_, i) => uploadRow(`m${String(i).padStart(3, "0")}`, `Leistng ${i} final.docx`, { uploaded_at: `2026-11-02T09:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z` }));
  const manyDb = new FakeDb({ dt_website_structures: [structureRow(manyPages)], dt_content_text_uploads: manyRows() });
  const manyLog: AiCallLog = [];
  const answerAll: UploadAiMatchCall = async (input) => {
    manyLog.push(input);
    const matches = input.user
      .split("\n")
      .filter((line) => line.startsWith('{"file_id"'))
      .map((line) => JSON.parse(line) as { file_id: string; datei: string })
      // Every call also claims „leistung-0“ for its first file: a clash across calls.
      .map((row, index) => ({ file_id: row.file_id, page_slug: index === 0 ? "leistung-0" : `leistung-${row.datei.match(/\d+/)![0]}`, reason: "Tippfehler" }));
    return { json: { matches }, usage: { inputTokens: 10, outputTokens: 5 }, model: "m" };
  };
  const many = await aiMatchTextUploads(manyDb.service, ORG, { models: ["m"], call: answerAll });
  assert.ok(many.ok);
  assert.equal(manyLog.length, Math.ceil(130 / UPLOAD_AI_MATCH_CHUNK));
  assert.deepEqual(many.data, { tried: 130, assigned: 127, conflicts: 3, model: "m" });
  assert.equal(manyDb.rows("dt_llm_usage_events").length, 3, "every call is recorded");
  const partDb = new FakeDb({ dt_website_structures: [structureRow(manyPages)], dt_content_text_uploads: manyRows() });
  let calls = 0;
  const part = await aiMatchTextUploads(partDb.service, ORG, {
    models: ["m"],
    call: async (input) => {
      calls += 1;
      if (calls === 2) throw new Error("Die KI ist gerade ausgelastet.");
      return answerAll(input);
    },
  });
  assert.ok(!part.ok && /ausgelastet/.test(part.message));
  assert.ok(partDb.rows("dt_content_text_uploads").every((r) => (r.match ?? null) === null && (r.structure_slug ?? null) === null), "no partial result");
  assert.equal(partDb.rows("dt_llm_usage_events").length, 2, "the calls that answered are still recorded");

  // No Seitenstruktur, no free page.
  const noStructure = await aiMatchTextUploads(new FakeDb({ dt_website_structures: [], dt_content_text_uploads: [uploadRow("a", "X.docx")] }).service, ORG, { call, models: ["m"] });
  assert.ok(!noStructure.ok && noStructure.status === 400 && /Seitenstruktur/.test(noStructure.message));
  const fullDb = new FakeDb({ dt_website_structures: [structureRow([pages[0]!])], dt_content_text_uploads: [uploadRow("a", "Startseite.docx", { uploaded_at: at(1) }), uploadRow("b", "Rest.docx", { uploaded_at: at(2) })] });
  const fullLog: AiCallLog = [];
  const full = await aiMatchTextUploads(fullDb.service, ORG, { call: aiStub(fullLog, () => []), models: ["m"] });
  assert.ok(full.ok && full.data.tried === 0 && fullLog.length === 0, "no free page: no call");
  assert.equal((await loadTextUploadsResult(fullDb.service, ORG)).ai.candidates_all, 0);
  console.log("ai step: ok");
}

/** The database before `20261117_dt_content_upload_ai_match.sql`: the AI columns are unknown. */
class NoAiColumnsDb extends FakeDb {
  from(table: string): ReturnType<FakeDb["from"]> {
    const query = super.from(table);
    if (table !== "dt_content_text_uploads") return query;
    const select = query.select.bind(query);
    const update = query.update.bind(query);
    const broken = (message: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["eq", "in", "limit", "is", "neq", "select"]) q[method] = () => q;
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message } }).then(resolve);
      return q as never;
    };
    query.select = ((columns?: string) => (/ai_tried_at|ai_reason/.test(columns ?? "") ? broken("column dt_content_text_uploads.ai_tried_at does not exist") : select())) as typeof query.select;
    query.update = ((payload: FakeRow) =>
      "ai_tried_at" in payload || "ai_reason" in payload || payload.match === "ai"
        ? broken("Could not find the 'ai_reason' column of 'dt_content_text_uploads' in the schema cache")
        : update(payload)) as typeof query.update;
    return query;
  }
}

async function aiMigrationTests() {
  assert.equal(CONTENT_UPLOAD_AI_MATCH_MIGRATION_FILE, "database/migrations/20261117_dt_content_upload_ai_match.sql");
  const sql = readFileSync(CONTENT_UPLOAD_AI_MATCH_MIGRATION_FILE, "utf8");
  assert.match(sql, /RUN THIS BEFORE DEPLOYING THE CODE/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS dt_content_text_uploads_match_check/);
  assert.match(sql, /CHECK \(match IS NULL OR match IN \('auto', 'ai', 'manual'\)\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS ai_tried_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS ai_reason text/);

  assert.ok(isMissingUploadAiMatchError({ code: "42703", message: "column dt_content_text_uploads.ai_tried_at does not exist" }));
  assert.ok(isMissingUploadAiMatchError({ code: "PGRST204", message: "Could not find the 'ai_reason' column of 'dt_content_text_uploads' in the schema cache" }));
  assert.ok(isMissingUploadAiMatchError({ code: "23514", message: 'new row for relation "dt_content_text_uploads" violates check constraint "dt_content_text_uploads_match_check"' }));
  assert.ok(!isMissingUploadAiMatchError({ code: "42703", message: "column dt_content_text_uploads.foo does not exist" }));
  assert.ok(!isMissingUploadAiMatchError({ code: "23505", message: "duplicate key" }));
  assert.ok(UPLOAD_AI_MATCH_MIGRATION_MESSAGE.includes(CONTENT_UPLOAD_AI_MATCH_MIGRATION_FILE));
  // The message names the AI migration, not the one of „Texte hochladen“ itself (both errors name the table).
  assert.equal(textUploadsDbErrorMessage({ code: "42703", message: "column dt_content_text_uploads.ai_tried_at does not exist" }, "x"), UPLOAD_AI_MATCH_MIGRATION_MESSAGE);
  assert.equal(textUploadsDbErrorMessage({ code: "42P01", message: 'relation "public.dt_content_text_uploads" does not exist' }, "x"), TEXT_UPLOADS_MIGRATION_MESSAGE);

  // Without the migration: the name match and the manual assignment work as before, the AI step is skipped.
  const pages = [briefingPage("Preise", { slug: "preise" }), briefingPage("Team", { slug: "team" })];
  const db = new NoAiColumnsDb({
    dt_website_structures: [structureRow(pages)],
    dt_content_text_uploads: [uploadRow("u1", "Preise.docx", { uploaded_at: "2026-11-02T08:00:01.000Z" }), uploadRow("u2", "Tema.docx", { uploaded_at: "2026-11-02T08:00:02.000Z" })],
  });
  const view = await loadTextUploadsResult(db.service, ORG);
  assert.ok(view.supported, "„Texte hochladen“ itself is there");
  assert.deepEqual(view.uploads.map((u) => [u.status, u.structure?.slug ?? null]), [["auto", "preise"], ["unassigned", null]]);
  assert.deepEqual([view.ai.supported, view.ai.hint, view.ai.candidates, view.ai.candidates_all], [false, UPLOAD_AI_MATCH_MIGRATION_MESSAGE, 0, 0]);
  assert.equal(db.rows("dt_content_text_uploads").find((r) => r.id === "u1")!.match, "auto", "the name match is stored without the new columns");
  let called = false;
  const run = await aiMatchTextUploads(db.service, ORG, {
    models: ["m"],
    call: async () => {
      called = true;
      return { json: { matches: [] }, usage: { inputTokens: 0, outputTokens: 0 }, model: "m" };
    },
  });
  assert.ok(!run.ok && run.status === 409 && run.message === UPLOAD_AI_MATCH_MIGRATION_MESSAGE);
  assert.equal(called, false, "no model call without the columns");
  assert.ok((await assignTextUpload(db.service, ORG, "u2", "team")).ok);
  assert.deepEqual((await loadTextUploadsResult(db.service, ORG)).uploads.map((u) => u.status), ["auto", "manual"]);
  console.log("ai migration missing: ok");
}

// --- 3. the takeover plan ----------------------------------------------------------------------------

function takeoverPlanTests() {
  const pages = [
    briefingPage("Startseite", { slug: "startseite", path: "/", position: 0 }),
    briefingPage("Preise", { slug: "preise", path: "/preise", position: 1 }),
    briefingPage("Kontakt", { slug: "kontakt", path: "/kontakt", position: 2, page_type: "nicht_bearbeiten" }),
    briefingPage("Team", { slug: "team", path: "/team", position: 3 }),
  ];
  const rows: TakeoverRow[] = [
    { id: "r1", slug: "home", path: "/", source_url: null, position: 0, state: "fertig" },
    { id: "r2", slug: "team", path: null, source_url: null, position: 1, state: "nicht_begonnen" },
  ];
  const uploads = [
    { id: "u1", file_name: "Startseite.docx", structure_slug: "startseite", page_id: null },
    { id: "u2", file_name: "Preise.docx", structure_slug: "preise", page_id: null },
    { id: "u3", file_name: "Kontakt.docx", structure_slug: "kontakt", page_id: null },
    { id: "u4", file_name: "Team.docx", structure_slug: "team", page_id: null },
    { id: "u5", file_name: "Frei.docx", structure_slug: null, page_id: null },
    { id: "u6", file_name: "Kaputt.docx", structure_slug: "preise", page_id: null, error: "nicht lesbar" },
  ];
  const plan = planUploadTakeover(uploads, pages, rows, 300);
  // Attach: path first (the row „home“ has the path „/“), then slug („team“ has no path).
  assert.deepEqual(plan.attach, [
    { upload_id: "u1", file_name: "Startseite.docx", row_id: "r1", row_slug: "home", started: true },
    { upload_id: "u4", file_name: "Team.docx", row_id: "r2", row_slug: "team", started: false },
  ]);
  // Create: from the page of the Seitenstruktur, also a „Nicht bearbeiten“ page (it keeps the type).
  assert.deepEqual(plan.create.map((c) => [c.upload_id, c.page.slug, c.page.page_type, c.page.position]), [
    ["u2", "preise", "unterseite", 1],
    ["u3", "kontakt", "nicht_bearbeiten", 2],
  ]);
  assert.deepEqual([plan.already, plan.over_limit, plan.skipped], [0, 0, []]);

  // Linked already: nothing to do. A running row is never touched.
  const second = planUploadTakeover(
    [{ ...uploads[0]!, page_id: "r1" }, uploads[3]!],
    pages,
    [rows[0]!, { ...rows[1]!, state: "laeuft" }],
    300,
  );
  assert.deepEqual([second.already, second.attach, second.create], [1, [], []]);
  assert.deepEqual(second.skipped, [{ file: "Team.docx", reason: UPLOAD_TAKEOVER_RUNNING_REASON }]);

  // A slug of the table that belongs to another path is not overwritten: the new row gets its own.
  const clash = planUploadTakeover([uploads[1]!], pages, [{ id: "x", slug: "preise", path: "/alt/preise", source_url: null, position: 0, state: "nicht_begonnen" }], 300);
  assert.deepEqual(clash.create.map((c) => c.page.slug), ["preise-2"]);

  // The limit of 300 rows: attaching always works, creating stops at the limit.
  const full: TakeoverRow[] = Array.from({ length: 299 }, (_, i) => ({ id: `f${i}`, slug: `seite-${i}`, path: `/seite-${i}`, source_url: null, position: i, state: "nicht_begonnen" }));
  const limited = planUploadTakeover(uploads, pages, full, 300);
  assert.deepEqual([limited.create.map((c) => c.upload_id), limited.over_limit, limited.attach], [["u1"], 3, []], "one row fits, the rest is over the limit");
  const atLimit = planUploadTakeover(uploads, pages, [...full, { id: "last", slug: "team", path: "/team", source_url: null, position: 299, state: "nicht_begonnen" }], 300);
  assert.deepEqual([atLimit.create.length, atLimit.over_limit, atLimit.attach.map((a) => a.row_id)], [0, 3, ["last"]]);
  console.log("takeover plan: ok");
}

// --- 4. storage: one file per request ------------------------------------------------------------------

async function storageTests() {
  const pages = [briefingPage("Dachsanierung", { slug: "dachsanierung" }), briefingPage("Über uns", { slug: "ueber-uns" })];
  const db = new FakeDb({ dt_website_structures: [structureRow(pages)], dt_content_text_uploads: [], dt_content_pages: [] });
  const good = await docx(["# Dachsanierung in Köln", "Wir sanieren Dächer seit 1990.", "## Ablauf", "Erst die Besichtigung, dann das Angebot."]);
  const upload = (fileName: string, bytes: Uint8Array, extra: { replace?: boolean; uploadId?: string } = {}) =>
    storeTextUpload(db.service, { organisationId: ORG, userId: USER, fileName, bytes, ...extra });

  // A batch: a readable file, an old .doc, a broken .docx, another readable one. Nothing stops the batch.
  const results = [
    await upload("Dachsanierung.docx", good),
    await upload("Preise.doc", new TextEncoder().encode("\xd0\xcf\x11\xe0 altes Word")),
    await upload("Kaputt.docx", new TextEncoder().encode("PK kein echtes zip")),
    await upload("ueber_uns.docx", await docx(["# Über uns", "Familienbetrieb in dritter Generation."])),
  ];
  assert.ok(results.every((r) => r.ok), "every request answers; a failing file is stored with its error");
  const errors = results.map((r) => (r.ok ? r.data.error : "request failed"));
  assert.equal(errors[0], null);
  assert.equal(errors[1], "„Preise.doc“ ist das alte Word-Format (.doc). Bitte in Word als .docx speichern und erneut hochladen.", "the ingest's .doc message");
  assert.match(errors[2] ?? "", /Kaputt\.docx/);
  assert.equal(errors[3], null);
  const rows = db.rows("dt_content_text_uploads");
  assert.equal(rows.length, 4);
  const stored = rows.find((r) => r.file_name === "Dachsanierung.docx")!;
  assert.deepEqual(
    (stored.blocks as ContentTextBlock[]).map((b) => [b.heading, b.level]),
    [["Dachsanierung in Köln", 1], ["Ablauf", 2]],
    "the headings of the Word file are kept",
  );
  assert.deepEqual([stored.format, stored.block_count, stored.name_key, stored.uploaded_by], ["docx", 2, "dachsanierung", USER]);
  assert.ok(Number(stored.chars) > 50);
  assert.ok(!("file" in stored) && !("bytes" in stored), "only the extracted text is stored");
  assert.deepEqual((rows.find((r) => r.file_name === "Preise.doc")!.blocks as unknown[]).length, 0);

  // The table: matched by name, the failures listed with their message.
  const view = await loadTextUploadsResult(db.service, ORG);
  assert.ok(view.supported && view.has_structure);
  const byName = new Map(view.uploads.map((u) => [u.file_name, u]));
  assert.deepEqual([byName.get("Dachsanierung.docx")!.status, byName.get("Dachsanierung.docx")!.structure?.slug], ["auto", "dachsanierung"]);
  assert.deepEqual([byName.get("ueber_uns.docx")!.status, byName.get("ueber_uns.docx")!.structure?.name], ["auto", "Über uns"]);
  assert.deepEqual([byName.get("Preise.doc")!.status, byName.get("Preise.doc")!.note], ["error", errors[1]]);
  assert.deepEqual(view.summary, { assigned: 2, auto: 2, ai: 0, manual: 0, unassigned: 2, pages_without_text: 0, pending: 2 });
  assert.deepEqual(view.free_pages, []);

  // The same name again: refused without the confirmation, replaced with it; the assignment stays.
  const again = await upload("DACHSANIERUNG.docx", await docx(["# Dachsanierung neu", "Neuer Text."]));
  assert.ok(!again.ok && again.status === 409 && /bereits hochgeladen/.test(again.message));
  const replaced = await upload("DACHSANIERUNG.docx", await docx(["# Dachsanierung neu", "Neuer Text."]), { replace: true });
  assert.ok(replaced.ok && replaced.data.replaced && replaced.data.id === stored.id);
  assert.equal(db.rows("dt_content_text_uploads").length, 4);
  const after = db.rows("dt_content_text_uploads").find((r) => r.id === stored.id)!;
  assert.deepEqual([(after.blocks as ContentTextBlock[])[0]!.heading, after.structure_slug, after.match], ["Dachsanierung neu", "dachsanierung", "auto"]);
  // A failing replacement never overwrites a readable text.
  const failing = await upload("Dachsanierung.docx", new TextEncoder().encode("PK kaputt"), { replace: true });
  assert.ok(failing.ok && failing.data.error && !failing.data.replaced);
  assert.equal((db.rows("dt_content_text_uploads").find((r) => r.id === stored.id)!.blocks as ContentTextBlock[])[0]!.heading, "Dachsanierung neu");
  // A file with an error is replaced without asking.
  const fixed = await upload("Kaputt.docx", await docx(["# Kaputt", "Jetzt lesbar."]));
  assert.ok(fixed.ok && fixed.data.error === null);
  // Anything but Word is refused.
  const pdf = await upload("Preise.pdf", good);
  assert.ok(!pdf.ok && pdf.status === 400 && /nur \.docx/.test(pdf.message));

  // Manual assignment, and „Zuordnung lösen“ that survives the next match.
  const kaputt = db.rows("dt_content_text_uploads").find((r) => r.file_name === "Kaputt.docx")!;
  const taken = await assignTextUpload(db.service, ORG, String(kaputt.id), "ueber-uns");
  assert.ok(!taken.ok && taken.status === 409 && /hat bereits die Datei „ueber_uns\.docx“/.test(taken.message), "a page has at most one file");
  const uu = db.rows("dt_content_text_uploads").find((r) => r.file_name === "ueber_uns.docx")!;
  assert.ok((await assignTextUpload(db.service, ORG, String(uu.id), null)).ok);
  let now = await loadTextUploadsResult(db.service, ORG);
  assert.equal(now.uploads.find((u) => u.id === uu.id)!.status, "unassigned", "taken off by hand: the name rule does not put it back");
  assert.deepEqual(now.free_pages.map((p) => p.slug), ["ueber-uns"]);
  assert.ok((await assignTextUpload(db.service, ORG, String(kaputt.id), "ueber-uns")).ok);
  now = await loadTextUploadsResult(db.service, ORG);
  assert.deepEqual([now.uploads.find((u) => u.id === kaputt.id)!.status, now.uploads.find((u) => u.id === kaputt.id)!.structure?.slug], ["manual", "ueber-uns"]);
  const missing = await assignTextUpload(db.service, ORG, String(kaputt.id), "gibt-es-nicht");
  assert.ok(!missing.ok && missing.status === 404);

  // A new Seitenstruktur without the page: the manual assignment becomes „nicht zugeordnet“ with the hint.
  db.tables.dt_website_structures = [structureRow([pages[0]!])];
  now = await loadTextUploadsResult(db.service, ORG);
  assert.deepEqual([now.uploads.find((u) => u.id === kaputt.id)!.status, now.uploads.find((u) => u.id === kaputt.id)!.note], ["unassigned", UPLOAD_PAGE_GONE_NOTE]);

  // No Seitenstruktur: the files wait.
  db.tables.dt_website_structures = [];
  now = await loadTextUploadsResult(db.service, ORG);
  assert.ok(!now.has_structure);
  assert.equal(now.uploads.find((u) => u.id === stored.id)!.status, "waiting");
  console.log("storage: ok");
}

// --- 5. „Zugeordnete Seiten übernehmen“ ----------------------------------------------------------------

async function takeoverTests() {
  const pages = [
    briefingPage("Startseite", { slug: "startseite", path: "/", level: 0, position: 0, page_type: "startseite", keywords: { main: { text: "dachdecker köln" }, secondary: [] } }),
    briefingPage("Preise", { slug: "preise", path: "/preise", position: 1, user_questions: ["Was kostet ein Dach?"] }),
    briefingPage("Kontakt", { slug: "kontakt", path: "/kontakt", position: 2, page_type: "nicht_bearbeiten" }),
    briefingPage("Team", { slug: "team", path: "/team", position: 3 }),
  ];
  const db = new FakeDb({
    dt_website_structures: [structureRow(pages)],
    dt_content_text_uploads: [
      uploadRow("u1", "Startseite.docx"),
      uploadRow("u2", "Preise.docx"),
      uploadRow("u3", "Kontakt.docx"),
      uploadRow("u4", "Team.docx"),
      uploadRow("u5", "Ohne Seite.docx"),
    ],
    dt_content_pages: [
      // A started page: its state and text must survive.
      contentRow("r1", "startseite", { path: "/", state: "fertig", html: "<section data-block-id=\"a\"><h1>Fertiger Text</h1></section>", step: 10 }),
      contentRow("r4", "team", { path: "/team", state: "laeuft" }),
    ],
  });
  const result = await takeOverTextUploads(db.service, ORG);
  assert.ok(result.ok);
  assert.deepEqual(
    { ...result.data },
    { created: 2, attached: 1, kept_started: 1, already: 0, over_limit: 0, skipped: [{ file: "Team.docx", reason: UPLOAD_TAKEOVER_RUNNING_REASON }] },
  );
  const rows = db.rows("dt_content_pages");
  const start = rows.find((r) => r.id === "r1")!;
  assert.deepEqual([start.source, start.text_upload_id, start.state, start.step], ["upload", "u1", "fertig", 10]);
  assert.match(String(start.html), /Fertiger Text/, "a started page keeps its text");
  const team = rows.find((r) => r.id === "r4")!;
  assert.deepEqual([team.source, team.text_upload_id ?? null], ["structure", null], "a running page is not touched");
  const preise = rows.find((r) => r.slug === "preise")!;
  assert.deepEqual(
    [preise.source, preise.text_upload_id, preise.name, preise.path, preise.level, preise.position, preise.page_type, preise.user_questions, preise.source_url ?? null],
    ["upload", "u2", "Preise", "/preise", 1, 1, "unterseite", ["Was kostet ein Dach?"], null],
    "created from the page of the Seitenstruktur with its briefing; no live URL",
  );
  assert.equal(preise.structure_uploaded_at, UPLOADED_AT);
  const kontakt = rows.find((r) => r.slug === "kontakt")!;
  assert.deepEqual([kontakt.source, kontakt.page_type], ["upload", "nicht_bearbeiten"], "„Nicht bearbeiten“ keeps its rule");
  const uploads = db.rows("dt_content_text_uploads");
  assert.deepEqual(uploads.map((u) => [u.id, u.page_id === null ? null : typeof u.page_id]), [["u1", "string"], ["u2", "string"], ["u3", "string"], ["u4", null], ["u5", null]]);
  assert.equal(uploads.find((u) => u.id === "u2")!.page_id, preise.id);

  // A structure upload that upserts the same slug („Neue Website“) leaves the row an upload page.
  await upsertContentPagesFromBriefing(db.service, ORG, [pages[1]!], UPLOADED_AT, "briefing");
  assert.deepEqual([preise.source, preise.text_upload_id], ["upload", "u2"]);

  // Again: nothing new; the running page finished and is attached now.
  team.state = "nicht_begonnen";
  const second = await takeOverTextUploads(db.service, ORG);
  assert.ok(second.ok);
  assert.deepEqual({ ...second.data }, { created: 0, attached: 1, kept_started: 0, already: 3, over_limit: 0, skipped: [] });
  assert.equal(db.rows("dt_content_pages").length, 4);
  const view = await loadTextUploadsResult(db.service, ORG);
  assert.deepEqual(view.summary, { assigned: 4, auto: 4, ai: 0, manual: 0, unassigned: 1, pages_without_text: 0, pending: 0 });
  assert.deepEqual(view.uploads.find((u) => u.id === "u1")!.page, { slug: "startseite", name: "startseite", state: "fertig" });

  // „Entfernen“: refused while the page runs; otherwise the page falls back to a page written from scratch.
  Object.assign(preise, { state: "laeuft", skip_steps: ["seo", "geo"] });
  const refused = await removeTextUpload(db.service, ORG, "u2");
  assert.ok(!refused.ok && refused.status === 409 && /läuft gerade/.test(refused.message));
  assert.ok(db.rows("dt_content_text_uploads").some((u) => u.id === "u2"));
  preise.state = "in_arbeit";
  assert.ok((await removeTextUpload(db.service, ORG, "u2")).ok);
  assert.ok(!db.rows("dt_content_text_uploads").some((u) => u.id === "u2"));
  assert.deepEqual([preise.source, preise.text_upload_id, preise.state, preise.skip_steps], ["structure", null, "in_arbeit", ["geo"]], "source structure, SEO on again, state kept");
  // A page with a live URL falls back to the crawl.
  Object.assign(start, { source_url: "https://example.de/" });
  assert.ok((await removeTextUpload(db.service, ORG, "u1")).ok);
  assert.equal(start.source, "crawl");

  // The limit of 300 rows.
  const many = Array.from({ length: 12 }, (_, i) => briefingPage(`Seite ${i}`, { slug: `seite-${i}`, path: `/seite-${i}`, position: i }));
  const limitDb = new FakeDb({
    dt_website_structures: [structureRow(many)],
    dt_content_text_uploads: many.map((p, i) => uploadRow(`l${String(i).padStart(2, "0")}`, `${p.name}.docx`, { uploaded_at: `2026-11-02T08:00:${String(i).padStart(2, "0")}.000Z` })),
    dt_content_pages: Array.from({ length: 295 }, (_, i) => contentRow(`x${i}`, `alt-${i}`, { path: `/alt-${i}` })),
  });
  const limited = await takeOverTextUploads(limitDb.service, ORG);
  assert.ok(limited.ok);
  assert.deepEqual([limited.data.created, limited.data.over_limit], [5, 7]);
  assert.equal(limitDb.rows("dt_content_pages").length, 300);

  // Without a Seitenstruktur there is nothing to take over.
  const none = await takeOverTextUploads(new FakeDb({ dt_website_structures: [], dt_content_text_uploads: [uploadRow("u1", "Preise.docx")], dt_content_pages: [] }).service, ORG);
  assert.ok(!none.ok && none.status === 400 && /Seitenstruktur/.test(none.message));
  console.log("takeover: ok");
}

// --- 6. the pipeline ---------------------------------------------------------------------------------

async function pipelineTests() {
  const noFetch = async () => {
    throw new Error("an upload page must never fetch a website");
  };
  const linked = uploadRow("u1", "Implantate.docx", {
    page_id: PAGE_ID,
    title: "Implantate | Praxis",
    meta_description: "Feste Zähne.",
    blocks: [
      { id: "abschnitt-1", heading: "Implantate in Krefeld", level: 1, html: "<p>Feste Zähne an einem Tag.</p>" },
      { id: "abschnitt-2", heading: "Ablauf", level: 2, html: "<p>Drei Termine.</p><ul><li>Beratung</li><li>Eingriff</li></ul>" },
      { id: "abschnitt-3", heading: "Kosten", level: 3, html: "<p>Ab <strong>1.800 €</strong>.</p>" },
    ],
  });

  // The existing text of an upload page: the Word text with its headings as Markdown lines.
  {
    const db = new FakeDb({ dt_content_text_uploads: [linked, uploadRow("u2", "Andere.docx")], dt_site_pages: [] });
    const text = await loadExistingText(db.service, pageRow());
    assert.equal(
      text,
      "# Implantate in Krefeld\n\nFeste Zähne an einem Tag.\n\n## Ablauf\n\nDrei Termine.\n\n- Beratung\n- Eingriff\n\n### Kosten\n\nAb **1.800 €**.",
    );
    assert.equal(uploadBlocksToMarkdown(linked.blocks as ContentTextBlock[]), text);
    // Never the crawl, also when the row carries a live URL.
    const withUrl = await loadExistingText(
      new FakeDb({ dt_content_text_uploads: [linked], dt_site_pages: [{ organisation_id: ORG, url: "https://x.de/a", text_content: "Live-Text" }] }).service,
      pageRow({ source_url: "https://x.de/a" }),
    );
    assert.match(withUrl ?? "", /^# Implantate in Krefeld/);
    // A crawl page still reads the crawl; a structure page has none.
    const crawlDb = new FakeDb({ dt_content_text_uploads: [linked], dt_site_pages: [{ organisation_id: ORG, url: "https://x.de/a", text_content: "Live-Text" }] });
    assert.equal(await loadExistingText(crawlDb.service, pageRow({ source: "crawl", source_url: "https://x.de/a" })), "Live-Text");
    assert.equal(await loadExistingText(crawlDb.service, pageRow({ source: "structure" })), null);
    // No file (removed): no text, no failure.
    assert.equal(await loadExistingText(new FakeDb({ dt_content_text_uploads: [] }).service, pageRow()), null);
    // A long Word text is kept far beyond the 6.000 characters of a crawl excerpt.
    const long = uploadRow("u9", "Lang.docx", { page_id: PAGE_ID, blocks: Array.from({ length: 6 }, (_, i) => ({ id: `abschnitt-${i + 1}`, heading: `Teil ${i + 1}`, level: i === 0 ? 1 : 2, html: `<p>${"Wort ".repeat(1_400)}</p>` })) });
    const longText = await loadExistingText(new FakeDb({ dt_content_text_uploads: [long] }).service, pageRow());
    assert.equal(UPLOAD_EXISTING_TEXT_MAX_CHARS, 30_000);
    assert.equal(longText?.length, 30_000);
    assert.equal((await loadPageTextUpload(db.service, pageRow()))?.file_name, "Implantate.docx");
  }

  // The prompt: „aus der hochgeladenen Word-Datei (Website noch nicht live)“ instead of Live-Seite / Crawl.
  {
    const context: ContentPipelineContext = {
      organisationName: "Praxis Dr. Berg",
      page: {
        name: "Implantate",
        path: "/implantate",
        level: 1,
        url: null,
        source: "upload",
        page_role: "supporting",
        page_type: "unterseite",
        pillar_name: null,
        estimated_traffic: null,
        keywords: null,
        h1_options: [],
        user_questions: [],
        ki_prompt: null,
        internal_link_targets: [],
      },
      structureOutline: "",
      existingText: "# Implantate in Krefeld\n\nFeste Zähne.",
      sections: [{ key: "unternehmen", label: "Unternehmen", current: "Praxis Dr. Berg in Krefeld." }],
      settings: { anrede: "Sie", branche: "Zahnarzt", tonalitaet: "sachlich", verbotene_woerter: [] },
      avatar: null,
      typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
      notes: [],
    } as unknown as ContentPipelineContext;
    const block = pageBlock(context);
    assert.match(block, /Quelle: Bestehender Text aus der hochgeladenen Word-Datei \(Website noch nicht live\) mit Briefing aus der Excel-Seitenstruktur/);
    assert.match(block, /## Bisheriger Text der Seite \(aus der hochgeladenen Word-Datei \(Website noch nicht live\); nur zur Orientierung\)/);
    assert.match(block, /# Implantate in Krefeld/);
    assert.doesNotMatch(block, /Live-URL|Live-Website|Crawl/);
    const crawlBlock = pageBlock({ ...context, page: { ...context.page, source: "crawl", url: "https://x.de/a" } });
    assert.match(crawlBlock, /Live-URL: https:\/\/x\.de\/a/);
    assert.match(crawlBlock, /Bisheriger Text der Seite \(Live-Website/, "crawl pages read as before");
  }

  // SEO may be switched off on an upload page.
  assert.ok(contentStepSkippable({ source: "upload", source_url: null }, "seo").ok);
  assert.ok(!contentStepSkippable({ source: "structure", source_url: null }, "seo").ok);
  assert.equal(
    contentStepSkippable({ source: "structure", source_url: null }, "seo").reason,
    "Nur bei Seiten mit vorhandenem Text (von der Website oder aus einer Word-Datei): dann wird dieser Text übernommen",
  );
  assert.ok(planContentSkipSteps({ state: "nicht_begonnen", source: "upload", source_url: null, skip_steps: [] }, ["seo"]).ok);

  const seoStepRow = (db: FakeDb) => db.rows("dt_content_steps").find((s) => s.page_id === PAGE_ID && s.step === CONTENT_STEP_SEO);
  // SEO off: the blocks of the Word file become the starting text, with the empty hero after the H1.
  {
    const page = pageRow({ skip_steps: ["seo"] });
    const db = new FakeDb({ dt_content_pages: [page as unknown as FakeRow], dt_content_text_uploads: [linked], dt_content_steps: [] });
    const outcome = await skipContentStep(db.service, page, [], CONTENT_STEP_SEO, { fetchImpl: noFetch as never });
    assert.deepEqual([outcome.halted, outcome.skipped, outcome.costEur], [false, true, 0]);
    const row = seoStepRow(db)!;
    assert.equal(row.status, "skipped");
    assert.deepEqual(row.output, { skipped_by: "user", upload_text: true, source: "upload", file: "Implantate.docx" });
    const saved = db.rows("dt_content_pages")[0]!;
    assert.deepEqual(
      parseBlocksFromHtml(String(saved.html)).map((b) => [b.heading, b.level]),
      [["Implantate in Krefeld", 1], [CONTENT_HERO_PLACEHOLDER, 2], ["Ablauf", 2], ["Kosten", 3]],
      "H1, the empty hero, the sections of the Word file",
    );
    assert.deepEqual([saved.title, saved.meta_description, saved.step], ["Implantate | Praxis", "Feste Zähne.", CONTENT_STEP_SEO]);
    const review = buildReview(pageRow({ ...(saved as Partial<ContentPageRow>), skip_steps: ["seo"] }), db.rows("dt_content_steps") as unknown as ContentStepRow[]);
    const seo = review.steps.find((s) => s.key === "seo")!;
    assert.deepEqual([seo.upload_text, seo.live_text, seo.skippable, seo.skipped_by_user], [true, false, true, true]);
    assert.equal(contentStepStatusLabel(seo.status, { liveText: seo.live_text, uploadText: seo.upload_text }), "Übersprungen – Text der Word-Datei übernommen");
    assert.equal(review.briefing.source, "upload");
  }
  // Hormozi off too: no hero is added.
  {
    const page = pageRow({ skip_steps: ["seo", "hormozi"] });
    const db = new FakeDb({ dt_content_pages: [page as unknown as FakeRow], dt_content_text_uploads: [linked], dt_content_steps: [] });
    await skipContentStep(db.service, page, [], CONTENT_STEP_SEO, { fetchImpl: noFetch as never });
    assert.deepEqual(parseBlocksFromHtml(String(db.rows("dt_content_pages")[0]!.html)).map((b) => b.heading), ["Implantate in Krefeld", "Ablauf", "Kosten"]);
  }
  // The same error rules: no usable text is an error, never an empty page; nothing is written.
  {
    const page = pageRow({ skip_steps: ["seo"] });
    const db = new FakeDb({ dt_content_pages: [page as unknown as FakeRow], dt_content_text_uploads: [], dt_content_steps: [] });
    await assert.rejects(
      skipContentStep(db.service, page, [], CONTENT_STEP_SEO, { fetchImpl: noFetch as never }),
      (error: Error) => error.message.startsWith(UPLOAD_TEXT_FAILURE_PREFIX) && /SEO wieder einschalten oder die Datei .* erneut hochladen/.test(error.message),
    );
    assert.equal(seoStepRow(db), undefined);
    assert.equal(db.rows("dt_content_pages")[0]!.html, "");
    const unreadable = new FakeDb({ dt_content_pages: [page as unknown as FakeRow], dt_content_text_uploads: [{ ...linked, error: "kaputt", blocks: [] }], dt_content_steps: [] });
    await assert.rejects(skipContentStep(unreadable.service, page, [], CONTENT_STEP_SEO, {}), /Text der Word-Datei konnte nicht übernommen werden/);
  }
  assert.ok(contentStepDefinition(CONTENT_STEP_SEO));
  assert.deepEqual(contentSkipWarnings(["seo", "faktencheck"], "upload"), ["Ohne Faktencheck werden Aussagen aus der Word-Datei nicht gegen die Anbieterfakten geprüft."]);
  console.log("pipeline: ok");
}

// --- 7. source handling and the migration ---------------------------------------------------------------

function sourceAndMigrationTests() {
  assert.deepEqual(["upload", "crawl", "structure", "x", null].map(contentPageSourceOf), ["upload", "crawl", "structure", "structure", "structure"]);
  assert.ok(canEditContentPageType({ source: "upload", page_role: null }));
  assert.deepEqual(
    describeSeiten({ structure: { filename: "s.xlsx", uploadedAt: null, nodeCount: 9 }, crawl: { websiteUrl: null, pageCount: 0, lastCrawledAt: null }, pages: { total: 9, structure: 3, crawl: 0, upload: 6 } }),
    { ok: true, hint: "3 Seiten aus der Seitenstruktur „s.xlsx“ · 6 Seiten aus hochgeladenen Word-Dateien." },
    "ready without any website",
  );

  const sql = readFileSync(new URL(`../${CONTENT_TEXT_UPLOADS_MIGRATION_FILE}`, import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.dt_content_text_uploads/);
  assert.match(sql, /UNIQUE \(organisation_id, name_key\)/);
  assert.match(sql, /page_id uuid REFERENCES public\.dt_content_pages\(id\) ON DELETE SET NULL/);
  assert.match(sql, /CHECK \(source IN \('structure', 'crawl', 'upload'\)\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS text_upload_id uuid REFERENCES public\.dt_content_text_uploads\(id\) ON DELETE SET NULL/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /dt_user_can_access_seo\(organisation_id\)/);
  assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE|ALL)/, "writes only through the service client");

  // A missing migration: a clear German message that names the file.
  const missingTable = { code: "PGRST205", message: "Could not find the table 'public.dt_content_text_uploads' in the schema cache" };
  const missingColumn = { code: "PGRST204", message: "Could not find the 'text_upload_id' column of 'dt_content_pages' in the schema cache" };
  const oldCheck = { code: "23514", message: 'new row for relation "dt_content_pages" violates check constraint "dt_content_pages_source_check"' };
  for (const error of [missingTable, missingColumn, oldCheck]) {
    assert.ok(isMissingTextUploadsError(error));
    assert.equal(textUploadsDbErrorMessage(error, "x"), TEXT_UPLOADS_MIGRATION_MESSAGE);
  }
  assert.ok(TEXT_UPLOADS_MIGRATION_MESSAGE.includes("database/migrations/20261110_dt_content_text_uploads.sql"));
  assert.match(TEXT_UPLOADS_MIGRATION_MESSAGE, /im Supabase SQL Editor ausführen/);
  assert.ok(!isMissingTextUploadsError({ code: "23505", message: "duplicate key" }));
  console.log("source and migration: ok");
}

async function unsupportedTests() {
  // The table is missing: the list says so instead of failing.
  const broken = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.dt_content_text_uploads' in the schema cache" } }),
      };
      return q;
    },
  };
  const result = await loadTextUploadsResult(broken as never, ORG);
  assert.deepEqual([result.supported, result.hint, result.uploads], [false, TEXT_UPLOADS_MIGRATION_MESSAGE, []]);
  console.log("missing migration: ok");
}

async function main() {
  nameKeyTests();
  matchingTests();
  aiMatchingTests();
  takeoverPlanTests();
  await storageTests();
  await takeoverTests();
  await pipelineTests();
  sourceAndMigrationTests();
  await unsupportedTests();
  await aiStepTests();
  await aiMigrationTests();
  console.log("\ncontent text uploads: all tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
