/**
 * SEO tool (Verwaltung → SEO): the prompt is the Globale Prompts SEO instruction plus the
 * tool's own Textvorlage, Anbieterfakten and avatar; nothing from Texte's settings,
 * Seitenstruktur or Analyse. Mocked model, no network, no database.
 * Run: npx tsx scripts/test-text-tools-seo.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import { CONTENT_HERO_BLOCK_ID, CONTENT_HERO_PLACEHOLDER, TEXT_TOOL_SCHEMA } from "../lib/dt/content/pipeline/prompts";
import { DEFAULT_CONTENT_STEP_PROMPTS } from "../lib/dt/content/step-prompts";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import { loadContentTypePrompts, saveContentTypePrompts } from "../lib/dt/content/type-prompts-db";
import {
  SEO_TOOL_MAX_MATERIAL_CHARS,
  SEO_TOOL_PAGE_TYPE_OPTIONS,
  SEO_TOOL_RULES,
  materialTextFromBlocks,
  normalizeSeoToolOutput,
  runSeoOnContext,
  seoToolInstruction,
  seoToolRequestSchema,
  seoToolSpec,
  type SeoToolContext,
  type SeoToolModelCall,
} from "../lib/dt/text-tools/seo";

const sections = [{ key: "leistungen", label: "Leistungen", current: "Prophylaxe und Implantate in Münster. Telefon 0251 123456." }];
/** The tool's own set: one recipe differs from the Texte defaults, so a test can tell them apart. */
const toolTypePrompts = { ...DEFAULT_CONTENT_TYPE_PROMPTS, unterseite: "EIGENE VORLAGE SEO-WERKZEUG: Unterseite für „[Hauptsilo]“." };

function context(extra: Partial<SeoToolContext> = {}): SeoToolContext {
  return {
    organisationName: "Praxis Dr. Test",
    pageName: "Prophylaxe",
    pageType: "unterseite",
    material: "# Prophylaxe\n\nAlle sechs Monate zur Kontrolle.",
    sections,
    avatar: { name: "Anna", role: "Patientin", beschreibung: "45, berufstätig, Angst vor dem Bohrer." },
    seoPrompt: null,
    typePrompts: toolTypePrompts,
    ...extra,
  };
}

const seoAnswer = {
  title: "Prophylaxe Münster | Praxis Dr. Test",
  meta_description: "Vorsorge in Münster.",
  blocks: [
    { id: "h1", heading: "Prophylaxe in Münster", level: 2, html: "" },
    { id: "zusammenfassung", heading: "Das Wichtigste in Kürze", level: 2, html: "<p>Alle sechs Monate.</p>" },
    { id: "kontakt", heading: "Termin vereinbaren", level: 2, html: "<p>Telefon 0251 123456.</p>" },
  ],
};

function testRequestSchemaAndOptions() {
  const base = {
    organisationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    pageName: "Prophylaxe",
    pageType: "unterseite",
    avatarId: "33333333-3333-4333-8333-333333333333",
    fileName: null,
    material: null,
  };
  assert.ok(seoToolRequestSchema.safeParse(base).success);
  assert.ok(seoToolRequestSchema.safeParse({ ...base, avatarId: null }).success, "without avatar is allowed");
  assert.equal(seoToolRequestSchema.safeParse({ ...base, pageName: "  " }).success, false);
  assert.equal(seoToolRequestSchema.safeParse({ ...base, pageType: "nicht_bearbeiten" }).success, false);
  assert.equal(seoToolRequestSchema.safeParse({ ...base, avatarId: "kein-uuid" }).success, false);
  assert.deepEqual(
    SEO_TOOL_PAGE_TYPE_OPTIONS.map((o) => o.value),
    ["hauptsilo", "hauptseite", "unterseite", "ratgeber", "standort", "startseite", "ueber_uns"],
  );
  console.log("request schema and options: ok");
}

function testSystemPromptUsesGlobalSeoPromptAndOwnTemplate() {
  const { system, tool, maxTokens } = seoToolSpec(context());
  // Default instruction from Globale Prompts → SEO, with its variables filled.
  assert.ok(system.startsWith("Schritt 2 SEO: Du schreibst den vollständigen Seitentext"), "the instruction comes first");
  assert.match(system, /Enthält eine H1-Option aus dem Briefing das Hauptkeyword/);
  assert.match(system, /Mindestens 3 Frage-Überschriften/);
  assert.match(system, /„Wir von Praxis Dr\. Test“/);
  assert.doesNotMatch(system, /\{\{/, "no unfilled variable");
  assert.ok(system.includes(SEO_TOOL_RULES));
  // The tool's own Textvorlage, never the Texte one; no Hauptsilo field, so the word stays.
  assert.match(system, /Seitentyp-Vorlage \(gilt bei Widerspruch vor der Anweisung oben\):\nEIGENE VORLAGE SEO-WERKZEUG: Unterseite für „Hauptsilo“\./);
  assert.doesNotMatch(system, /Seitentyp Unterseite innerhalb des Hauptsilos/);
  // Nothing from Texte's settings: no Vorgaben, no Branchenregel, no Texter prompt.
  assert.doesNotMatch(system, /Branchenregel|Allgemeine Regeln \(jeder Seitentyp\)|aus den Vorgaben gelten/);
  assert.equal(tool.name, "submit_seo_text");
  assert.deepEqual(tool.input_schema, TEXT_TOOL_SCHEMA);
  assert.equal(maxTokens, 12_000);

  // Ratgeber: the type changes the filled variables and the recipe.
  const ratgeber = seoToolSpec(context({ pageType: "ratgeber" })).system;
  assert.match(ratgeber, /Mindestens 5 Frage-Überschriften/);
  assert.match(ratgeber, /naechster-schritt/);
  assert.ok(ratgeber.includes(DEFAULT_CONTENT_TYPE_PROMPTS.ratgeber));
  console.log("system prompt: global SEO prompt + own Textvorlage: ok");
}

function testSavedGlobalSeoPromptWins() {
  const saved = "Eigene SEO-Anweisung für {{firmenname}}, mindestens {{mindest_fragen}} Fragen.";
  const instruction = seoToolInstruction({ organisationName: "Praxis Dr. Test", pageType: "unterseite", seoPrompt: saved });
  assert.equal(instruction, "Eigene SEO-Anweisung für Praxis Dr. Test, mindestens 3 Fragen.");
  const system = seoToolSpec(context({ seoPrompt: saved })).system;
  assert.ok(system.startsWith(instruction));
  assert.doesNotMatch(system, /Schritt 2 SEO: Du schreibst/, "the default is replaced, not appended");
  // An empty saved prompt means the default, like in Texte.
  assert.equal(
    seoToolInstruction({ organisationName: "X", pageType: "unterseite", seoPrompt: "  " }).slice(0, 40),
    DEFAULT_CONTENT_STEP_PROMPTS.seo.slice(0, 40),
  );
  console.log("saved global SEO prompt wins: ok");
}

function testUserPromptOnlyAnbieterfaktenAvatarAndMaterial() {
  const { user } = seoToolSpec(context());
  assert.match(user, /^## Seite\nOrganisation: Praxis Dr\. Test\nSeite: Prophylaxe\nSeitentyp: Unterseite\nQuelle: eigenständiges SEO-Werkzeug/);
  assert.match(user, /Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen/);
  assert.match(user, /## Analyse\nEs gibt keine Analyse \(Schritt 1\)\. Leite Hauptkeyword/);
  assert.match(user, /## Hochgeladenes Material[^\n]*\n[^\n]*\n# Prophylaxe\n\nAlle sechs Monate zur Kontrolle\./);
  assert.match(user, /## Anbieterfakten aus Fragebogen und Kundengesprächen[\s\S]*### Leistungen\nProphylaxe und Implantate in Münster\./);
  assert.match(user, /## Avatar \(Wunschkunde[\s\S]*Name: Anna\nRolle: Patientin\n45, berufstätig/);
  assert.doesNotMatch(user, /## Vorgaben|## Anmerkungen|Weitere Seiten der Website|Excel|Hauptsilo \(übergeordnete Seite\)/);

  const bare = seoToolSpec(context({ material: null, avatar: null, sections: [] })).user;
  assert.doesNotMatch(bare, /Hochgeladenes Material/);
  assert.match(bare, /## Anbieterfakten\n\(keine\)/);
  assert.match(bare, /## Avatar \(Wunschkunde\)\n\(kein Avatar hinterlegt\)/);
  console.log("user prompt: page, material, Anbieterfakten, avatar only: ok");
}

function testHeroPlaceholderNormalisation() {
  const out = normalizeSeoToolOutput(seoAnswer);
  assert.deepEqual(
    out.blocks.map((b) => [b.id, b.level, b.heading]),
    [
      ["h1", 1, "Prophylaxe in Münster"],
      [CONTENT_HERO_BLOCK_ID, 2, CONTENT_HERO_PLACEHOLDER],
      ["zusammenfassung", 2, "Das Wichtigste in Kürze"],
      ["kontakt", 2, "Termin vereinbaren"],
    ],
  );
  const filledHero = normalizeSeoToolOutput({
    blocks: [seoAnswer.blocks[0], seoAnswer.blocks[1], { id: CONTENT_HERO_BLOCK_ID, heading: "Ihr Lächeln", level: 2, html: "<p>Jetzt buchen!</p>" }],
  });
  assert.deepEqual(filledHero.blocks.map((b) => b.id), ["h1", CONTENT_HERO_BLOCK_ID, "zusammenfassung"]);
  assert.equal(filledHero.blocks[1]!.heading, CONTENT_HERO_PLACEHOLDER);
  assert.equal(filledHero.blocks[1]!.html, "");
  assert.equal(filledHero.title, null);
  assert.deepEqual(normalizeSeoToolOutput({ blocks: [] }).blocks, []);
  console.log("hero placeholder normalisation: ok");
}

async function testRunOneCall() {
  const calls: Array<{ tool: string; models: string[]; timeoutMs?: number }> = [];
  const call: SeoToolModelCall = async (req) => {
    calls.push({ tool: req.tool.name, models: req.models, timeoutMs: req.timeoutMs });
    return { json: seoAnswer, usage: { inputTokens: 9_000, outputTokens: 4_000 }, model: "claude-sonnet-4-6" };
  };
  const { result, usage } = await runSeoOnContext(context(), { fileName: "alt.docx" }, { models: ["claude-sonnet-4-6"], call });
  assert.deepEqual(calls.map((c) => c.tool), ["submit_seo_text"], "exactly one call, no Analyse");
  assert.deepEqual(calls[0]!.models, ["claude-sonnet-4-6"]);
  assert.equal(calls[0]!.timeoutMs, 270_000);
  assert.deepEqual(usage, { model: "claude-sonnet-4-6", inputTokens: 9_000, outputTokens: 4_000 });
  assert.equal(result.page_name, "Prophylaxe");
  assert.equal(result.page_type, "unterseite");
  assert.equal(result.avatar_name, "Anna");
  assert.equal(result.file_name, "alt.docx");
  assert.equal(result.title, "Prophylaxe Münster | Praxis Dr. Test");
  assert.ok(result.cost_eur > 0);
  assert.match(result.html, /<section data-block-id="h1"><h1>Prophylaxe in Münster<\/h1>/);

  const empty: SeoToolModelCall = async () => ({ json: { blocks: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" });
  await assert.rejects(
    () => runSeoOnContext(context(), { fileName: null }, { models: ["m"], call: empty }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && /keinen Seitentext/.test(error.message),
  );
  console.log("run: one call, result, empty answer: ok");
}

function testMaterialAndExport() {
  const blocks = [
    { id: "a", heading: "Titel", level: 1 as const, html: "<p>Erster &amp; Absatz.</p><ul><li>Punkt</li></ul>" },
    { id: "b", heading: null, level: 2 as const, html: "<p>Ohne Überschrift.</p>" },
  ];
  assert.equal(materialTextFromBlocks(blocks), "# Titel\nErster & Absatz.\n\n- Punkt\n\nOhne Überschrift.");
  assert.equal(materialTextFromBlocks([]), null);
  const long = materialTextFromBlocks([{ id: "a", heading: null, level: 2, html: `<p>${"x".repeat(SEO_TOOL_MAX_MATERIAL_CHARS + 500)}</p>` }]);
  assert.ok(long?.endsWith("[… gekürzt]"));

  const html = normalizeSeoToolOutput(seoAnswer);
  const rendered = contentExportFile("html", { slug: "prophylaxe-seo", title: "Prophylaxe", html: "<section data-block-id=\"h1\"><h1>Prophylaxe in Münster</h1></section>" });
  assert.equal(rendered.filename, "prophylaxe-seo.html");
  assert.match(rendered.body, /<title>Prophylaxe<\/title>/);
  const txt = contentExportFile("txt", { slug: "prophylaxe-seo", title: "Prophylaxe", html: "<section data-block-id=\"h1\"><h1>Prophylaxe in Münster</h1><p>Vorsorge.</p></section>" });
  assert.equal(txt.body, "Prophylaxe in Münster\n\nVorsorge.\n");
  assert.equal(txt.filename, "prophylaxe-seo.txt");
  assert.ok(html.blocks.length > 0);
  console.log("material and export: ok");
}

/** A fake `dt_content_type_prompts` with the old `id = 'agency'` check switchable on. */
function fakeTypePromptsDb(options: { oldCheck?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const service = {
    from(table: string) {
      assert.equal(table, "dt_content_type_prompts");
      return {
        select() {
          return {
            eq(_column: string, id: string) {
              return { maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }) };
            },
          };
        },
        async upsert(row: Record<string, unknown>) {
          if (options.oldCheck && row.id !== "agency") {
            return { error: { code: "23514", message: 'new row violates check constraint "dt_content_type_prompts_id_check"' } };
          }
          rows.set(row.id as string, { ...row });
          return { error: null };
        },
      };
    },
  };
  return { rows, service: service as unknown as Parameters<typeof loadContentTypePrompts>[0] };
}

async function testTextvorlagenAreIndependent() {
  const { rows, service } = fakeTypePromptsDb();
  const user = { userId: "u", userEmail: "a@b.de" };
  await saveContentTypePrompts(service, { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS, unterseite: "TEXTE" }, ...user }, "texte");
  await saveContentTypePrompts(service, { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS, unterseite: "SEO-WERKZEUG" }, ...user }, "seo_tool");
  assert.deepEqual([...rows.keys()].sort(), ["agency", "seo_tool"]);
  assert.equal((await loadContentTypePrompts(service, "texte")).prompts.unterseite, "TEXTE");
  assert.equal((await loadContentTypePrompts(service)).prompts.unterseite, "TEXTE", "Texte stays the default scope");
  assert.equal((await loadContentTypePrompts(service, "seo_tool")).prompts.unterseite, "SEO-WERKZEUG");

  // A later change under Texte leaves the SEO tool's set alone.
  await saveContentTypePrompts(service, { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS, unterseite: "TEXTE NEU" }, ...user }, "texte");
  assert.equal((await loadContentTypePrompts(service, "seo_tool")).prompts.unterseite, "SEO-WERKZEUG");

  // Without a saved row the SEO tool reads the defaults, not the Texte row.
  const fresh = fakeTypePromptsDb();
  await saveContentTypePrompts(fresh.service, { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS, unterseite: "TEXTE" }, ...user }, "texte");
  const tool = await loadContentTypePrompts(fresh.service, "seo_tool");
  assert.equal(tool.storage, "defaults");
  assert.equal(tool.prompts.unterseite, DEFAULT_CONTENT_TYPE_PROMPTS.unterseite);

  // Before the migration the old check refuses the second row with a German hint.
  const old = fakeTypePromptsDb({ oldCheck: true });
  const refused = await saveContentTypePrompts(old.service, { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS }, ...user }, "seo_tool");
  assert.ok(!refused.ok && /20261019_dt_seo_tool_type_prompts\.sql/.test(refused.error));
  console.log("Textvorlagen of Texte and SEO tool are independent: ok");
}

async function main() {
  testRequestSchemaAndOptions();
  testSystemPromptUsesGlobalSeoPromptAndOwnTemplate();
  testSavedGlobalSeoPromptWins();
  testUserPromptOnlyAnbieterfaktenAvatarAndMaterial();
  testHeroPlaceholderNormalisation();
  await testRunOneCall();
  testMaterialAndExport();
  await testTextvorlagenAreIndependent();
  console.log("ok: text-tools seo");
}

void main();
