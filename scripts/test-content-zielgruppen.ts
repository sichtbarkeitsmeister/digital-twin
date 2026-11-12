/**
 * Zielgruppen je Seite: the pure model (levels, limits, reading), the prompt block for primary and
 * secondary, the Analyse rule, the DigitalTwin's suggestion (one call, known ids only, one avatar
 * without a call, a confirmed choice kept) and saving the editor's choice.
 * Run: npx tsx scripts/test-content-zielgruppen.ts
 */
import assert from "node:assert/strict";

import type { ContentAvatarRow } from "../lib/dt/content/load-sources";
import type { callContentTool } from "../lib/dt/content/pipeline/llm";
import {
  analyseAudienceRule,
  audienceCharShares,
  avatarBlock,
  MAX_SECONDARY_AVATAR_CHARS,
  shareCharBudget,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";

const MAX_AVATAR_CHARS_FOR_TEST = 20_000;
import {
  ZIELGRUPPEN_SUGGEST_SYSTEM,
  zielgruppenSuggestSystem,
  normalizeZielgruppenAnswer,
  saveContentZielgruppen,
  suggestContentZielgruppen,
  zielgruppenTool,
} from "../lib/dt/content/pipeline/zielgruppen-suggest";
import { loadContentPage, type ContentPageRow } from "../lib/dt/content/store";
import {
  EMPTY_CONTENT_ZIELGRUPPEN,
  contentPrimaryMax,
  contentZielgruppenRule,
  normalizeZielgruppenLists,
  readContentZielgruppen,
  withZielgruppeLevel,
  zielgruppeLevel,
} from "../lib/dt/content/zielgruppen";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import { FakeDb } from "./fake-supabase";

function testModel() {
  const empty = readContentZielgruppen(undefined);
  assert.deepEqual(empty, EMPTY_CONTENT_ZIELGRUPPEN);
  const read = readContentZielgruppen({ primary: ["a", "a", "b", "c"], secondary: ["a", "d", "e", "f", "g"], status: "bestaetigt", reasons: { a: " weil " } });
  // Read as stored (12.11.: the page type's limit is applied when saving and in the run).
  assert.deepEqual([read.primary, read.secondary, read.status, read.reasons], [["a", "b", "c"], ["d", "e", "f"], "bestaetigt", { a: "weil" }], "no avatar twice, 3 secondary");
  let z = { primary: ["a"], secondary: [] as string[] };
  z = withZielgruppeLevel(z, "b", "primary");
  assert.deepEqual(z, { primary: ["a", "b"], secondary: [] });
  z = withZielgruppeLevel(z, "c", "primary");
  assert.deepEqual(z, { primary: ["b", "c"], secondary: ["a"] }, "a third primary moves the oldest to secondary");
  z = withZielgruppeLevel(z, "a", "off");
  assert.deepEqual(z, { primary: ["b", "c"], secondary: [] });
  assert.equal(zielgruppeLevel(z, "c"), "primary");
  assert.equal(zielgruppeLevel(z, "x"), "off");

  // Limits by page type: Startseite, Hauptsilo-Seite, Ratgeber none; all others two.
  for (const type of ["startseite", "hauptsilo", "ratgeber"]) assert.equal(contentPrimaryMax(type), null, type);
  for (const type of ["unterseite", "hauptseite", "standort", "ueber_uns", null]) assert.equal(contentPrimaryMax(type), 2, String(type));
  assert.match(contentZielgruppenRule("startseite"), /^Primär: keine Obergrenze bei diesem Seitentyp/);
  assert.match(contentZielgruppenRule("unterseite"), /^Primär: höchstens zwei bei diesem Seitentyp/);
  const five = ["a", "b", "c", "d", "e"];
  assert.deepEqual(normalizeZielgruppenLists(five, [], undefined, null), { primary: five, secondary: [] }, "no limit");
  assert.deepEqual(normalizeZielgruppenLists(five, ["x"], undefined, 2), { primary: ["a", "b"], secondary: ["c", "d", "e"] }, "over the limit: secondary, in order");
  let wide = { primary: ["a", "b"], secondary: [] as string[] };
  wide = withZielgruppeLevel(wide, "c", "primary", null);
  assert.deepEqual(wide.primary, ["a", "b", "c"], "a third primary on a Startseite");
  console.log("model: ok");
}

function testPromptBlock() {
  const isabelle = { name: "Isabelle Hartmann", role: "Verkäuferin hochwertiger Luxusuhren", beschreibung: "Profil Isabelle." };
  const birgit = { name: "Birgit Lehmann", role: "Erbengemeinschaft", beschreibung: "B".repeat(MAX_SECONDARY_AVATAR_CHARS + 500) };
  const block = avatarBlock({ avatar: { name: "Mix", role: "", beschreibung: "Mix-Profil" }, audience: { primary: [isabelle], secondary: [birgit] } });
  assert.match(
    block,
    /^## Zielgruppen dieser Seite\nPrimär \(für sie ist der Text geschrieben; sie bestimmt Ansprache, Beispiele und Reihenfolge\):\n### Isabelle Hartmann – Verkäuferin hochwertiger Luxusuhren\nProfil Isabelle\.\nSekundär \(mitbedienen: ihre wichtigsten Fragen und Einwände kurz aufgreifen, die Ansprache nicht auf sie umstellen\):\n### Birgit Lehmann – Erbengemeinschaft\nB+/,
  );
  assert.doesNotMatch(block, /Mix-Profil/, "the page's Zielgruppen replace the Standard-Zielgruppe");
  assert.ok(block.length < MAX_SECONDARY_AVATAR_CHARS + 1_000, "a secondary profile is shortened (at most 3,000)");
  assert.match(avatarBlock({ avatar: { name: "Mix", role: "", beschreibung: "Mix-Profil" }, audience: null }), /^## Avatar \(Wunschkunde, für den der Text geschrieben wird\)\nName: Mix/, "without own Zielgruppen: as before");
  assert.doesNotMatch(avatarBlock({ avatar: null, audience: { primary: [isabelle], secondary: [] } }), /Sekundär/, "no secondary line without one");
  assert.equal(analyseAudienceRule({ audience: { primary: [isabelle], secondary: [] } }), "", "one Zielgruppe: no rule");
  assert.equal(
    analyseAudienceRule({ audience: { primary: [isabelle], secondary: [birgit] } }),
    "Bei mehreren Zielgruppen: traumziel, hauptschmerz, groesste_huerde und einwaende kommen aus der primären Zielgruppe. Einen wichtigen Einwand einer sekundären Zielgruppe darfst du in einwaende ergänzen, mit ihrem Namen in Klammern.\n",
  );

  // Many Zielgruppen: all profile texts together stay within 20,000 characters, short ones whole.
  const long = (name: string, n: number) => ({ name, role: "", beschreibung: `${name} `.repeat(Math.ceil(n / (name.length + 1))).slice(0, n) });
  const many = { primary: Array.from({ length: 8 }, (_, i) => long(`P${i}`, 9_000)), secondary: Array.from({ length: 3 }, (_, i) => long(`S${i}`, 6_000)) };
  const shares = audienceCharShares(many.primary.map((m) => m.beschreibung.length), many.secondary.map((m) => m.beschreibung.length));
  const total = [...shares.primary, ...shares.secondary].reduce((a, b) => a + b, 0);
  assert.ok(total <= MAX_AVATAR_CHARS_FOR_TEST, `profiles together ${total} ≤ 20,000`);
  assert.deepEqual(shares.secondary, [2_000, 2_000, 2_000], "secondary at most 30 % together");
  assert.deepEqual(shares.primary, Array(8).fill(1_750), "the rest shared fairly among the primary ones");
  assert.deepEqual(shareCharBudget([500, 9_000, 9_000], 10_000), [500, 4_750, 4_750], "a short profile stays whole, its rest goes to the others");
  assert.deepEqual(audienceCharShares([1_000, 2_000], [800]), { primary: [1_000, 2_000], secondary: [800] }, "nothing cut when it fits");
  // The whole block (headings and „gekürzt“ marks included) stays within 20,000 characters.
  for (const [p, sec] of [[4, 0], [8, 3], [12, 0], [30, 3]] as const) {
    const audience = { primary: Array.from({ length: p }, (_, i) => long(`P${i}`, 9_000)), secondary: Array.from({ length: sec }, (_, i) => long(`S${i}`, 6_000)) };
    const length = avatarBlock({ avatar: null, audience }).length;
    assert.ok(length <= MAX_AVATAR_CHARS_FOR_TEST, `${p} primary + ${sec} secondary: ${length} ≤ 20,000`);
  }
  const shortOnes = { primary: [isabelle, { ...isabelle, name: "Zweite" }], secondary: [] };
  assert.match(avatarBlock({ avatar: null, audience: shortOnes }), /Profil Isabelle\.$/, "short profiles stay whole");
  console.log("prompt block: ok");
}

const ORG = "11111111-1111-1111-1111-111111111111";
const avatar = (id: string, name: string): ContentAvatarRow => ({
  id,
  name,
  role: `Rolle ${name}`,
  slug: id,
  prompt_template: `Profil von ${name}.`,
  prompt_append: null,
  uses_global_prompt: false,
  avatar_data: null,
});
function page(extra: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    id: "p1",
    organisation_id: ORG,
    slug: "uhren",
    name: "Luxus-Uhren Ankauf",
    cost_eur: 1,
    zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN },
    ...extra,
  } as ContentPageRow;
}

async function testSuggest() {
  assert.match(ZIELGRUPPEN_SUGGEST_SYSTEM, /^Du ordnest einer Seite einer Website die Zielgruppen des Anbieters zu\. Du schreibst nichts für die Seite\.\nPrimär: die Zielgruppe, die diese Seite hauptsächlich sucht und für die sie geschrieben wird – genau eine, höchstens zwei/);
  assert.match(zielgruppenSuggestSystem("startseite"), /\nPrimär: Das ist die Startseite – in der Regel alle Hauptzielgruppen des Anbieters\. Nur eine Zielgruppe, die für das Angebot eine Nebenrolle spielt, ist sekundär oder nicht zugeordnet\. Keine Obergrenze\.\nSekundär:/);
  assert.match(zielgruppenSuggestSystem("ratgeber"), /\nPrimär: Das ist ein Ratgeberartikel – alle Zielgruppen, für deren Frage der Artikel relevant ist\. Keine Obergrenze\.\n/);
  assert.match(zielgruppenSuggestSystem("hauptsilo"), /\nPrimär: Das ist eine Hauptsilo-Seite – alle Zielgruppen, für die das Thema dieses Silos ein Hauptanliegen ist\. Keine Obergrenze\.\n/);
  assert.equal(zielgruppenSuggestSystem("unterseite"), ZIELGRUPPEN_SUGGEST_SYSTEM, "other types: the text as before");
  assert.equal(((zielgruppenTool(["a"], null).input_schema as { properties: { primary: { description: string } } }).properties.primary.description), "Mindestens eine primäre Zielgruppe, keine Obergrenze.");
  const fourPrimary = { primary: ["a", "b", "c", "d"].map((agent_id) => ({ agent_id, reason: "r" })), secondary: [] };
  assert.deepEqual(normalizeZielgruppenAnswer(fourPrimary, new Set(["a", "b", "c", "d"]), null).primary, ["a", "b", "c", "d"], "Startseite: all four primary");
  assert.deepEqual(normalizeZielgruppenAnswer(fourPrimary, new Set(["a", "b", "c", "d"]), 2), { primary: ["a", "b"], secondary: ["c", "d"], reasons: { a: "r", b: "r", c: "r", d: "r" } }, "Unterseite: two, the rest secondary");
  const tool = zielgruppenTool(["a", "b"]);
  assert.deepEqual((tool.input_schema as { required: string[] }).required, ["primary", "secondary"]);
  assert.deepEqual(
    normalizeZielgruppenAnswer({ primary: [{ agent_id: "a", reason: "Sucht Ankauf." }, { agent_id: "zzz", reason: "?" }], secondary: [{ agent_id: "a", reason: "doppelt" }, { agent_id: "b", reason: "Erbt." }] }, new Set(["a", "b"])),
    { primary: ["a"], secondary: ["b"], reasons: { a: "Sucht Ankauf.", b: "Erbt." } },
    "unknown ids drop out, a primary is never secondary",
  );

  const avatars = [avatar("a", "Isabelle"), avatar("b", "Birgit"), avatar("c", "Andreas")];
  const db = new FakeDb({ dt_content_pages: [page() as unknown as Record<string, unknown>], dt_llm_usage_events: [] });
  let user = "";
  const call: typeof callContentTool = async (input) => {
    user = input.user;
    return { json: { primary: [{ agent_id: "a", reason: "Die Seite richtet sich an Verkäufer einzelner Luxusuhren." }], secondary: [{ agent_id: "b", reason: "Erben lesen mit." }] }, usage: { inputTokens: 4_000, outputTokens: 200 }, model: "claude-haiku-5-5", stopReason: "tool_use" };
  };
  const context: ContentPipelineContext = {
    organisationName: "Antikankauf Kolb & Sartor",
    page: {
      name: "Luxus-Uhren Ankauf", path: "/uhren", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
      pillar_name: "Ankauf", estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
    },
    structureOutline: "",
    existingText: null,
    sections: [{ key: "leistungen", label: "Leistungen", current: "Ankauf von Luxusuhren und Nachlässen." }],
    settings: { anrede: "Sie", branche: "Antiquitätenhandel", tonalitaet: "sachlich", verbotene_woerter: [] },
    avatar: null,
    typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
    notes: ["Fokus auf Einzelstücke."],
    freshness: EMPTY_CONTENT_FRESHNESS,
    outputs: {},
    blocks: [],
    title: null,
    metaDescription: null,
  };
  const result = await suggestContentZielgruppen(db.service as never, page(), null, {
    callTool: call,
    models: ["m"],
    avatars,
    context,
    now: new Date("2026-11-12T10:00:00Z"),
  }).catch((error: unknown) => ({ ok: false as const, status: 0, message: String(error) }));
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual([result.zielgruppen.primary, result.zielgruppen.secondary, result.zielgruppen.status], [["a"], ["b"], "vorschlag"]);
  assert.match(user, /Luxus-Uhren Ankauf/);
  assert.match(user, /Fokus auf Einzelstücke\./, "the page's notes");
  assert.match(user, /Ankauf von Luxusuhren und Nachlässen\./, "the Anbieterfakten");
  assert.match(user, /## Zielgruppen des Anbieters\n### id: a\nName: Isabelle\nRolle: Rolle Isabelle\nProfil von Isabelle\./);
  const saved = db.rows("dt_content_pages")[0] as unknown as ContentPageRow & { zielgruppen: unknown };
  assert.equal(readContentZielgruppen(saved.zielgruppen).primary[0], "a");
  assert.ok(Number(saved.cost_eur) > 1, "the call is billed on the page");
  assert.equal(db.rows("dt_llm_usage_events")[0]?.mode, "content.zielgruppen");

  // A confirmed choice stays unless „Neu vorschlagen“.
  const confirmed = page({ zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN, primary: ["c"], status: "bestaetigt" } });
  const kept = await suggestContentZielgruppen(db.service as never, confirmed, null, { callTool: async () => assert.fail("no call"), avatars });
  assert.ok(kept.ok && kept.zielgruppen.primary[0] === "c" && kept.cost_eur === 0);
  // One Zielgruppe only: no call.
  const one = await suggestContentZielgruppen(new FakeDb({ dt_content_pages: [page() as unknown as Record<string, unknown>] }).service as never, page(), null, {
    callTool: async () => assert.fail("no call"),
    avatars: [avatars[0]!],
  });
  assert.ok(one.ok && one.zielgruppen.primary[0] === "a" && one.cost_eur === 0);
  // Without the migration (column not read): a clear message, no call.
  const noColumn = await suggestContentZielgruppen(db.service as never, page({ zielgruppen: undefined }), null, { callTool: async () => assert.fail("no call"), avatars });
  assert.ok(!noColumn.ok && /20261112_dt_content_zielgruppen\.sql/.test(noColumn.message));
  console.log("suggest: ok");
}

async function testSave() {
  const avatars = [avatar("a", "Isabelle"), avatar("b", "Birgit")];
  const db = new FakeDb({ dt_content_pages: [page({ zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN, primary: ["a"], reasons: { a: "weil" } } }) as unknown as Record<string, unknown>] });
  const current = page({ zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN, primary: ["a"], reasons: { a: "weil" } } });
  const saved = await saveContentZielgruppen(db.service as never, current, { primary: ["b"], secondary: ["a"] }, { avatars, now: new Date("2026-11-12T11:00:00Z") });
  assert.ok(saved.ok);
  if (saved.ok) assert.deepEqual([saved.zielgruppen.primary, saved.zielgruppen.secondary, saved.zielgruppen.status, saved.zielgruppen.reasons], [["b"], ["a"], "bestaetigt", { a: "weil" }]);
  const cleared = await saveContentZielgruppen(db.service as never, current, { primary: [], secondary: ["a"] }, { avatars });
  assert.ok(cleared.ok && cleared.zielgruppen.primary.length === 0 && cleared.zielgruppen.secondary.length === 0, "no primary: back to the Standard-Zielgruppe");
  // Startseite: no limit; Unterseite: two, the rest secondary.
  const four = [avatar("a", "A"), avatar("b", "B"), avatar("c", "C"), avatar("d", "D")];
  const start = await saveContentZielgruppen(db.service as never, page({ page_type: "startseite", zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN } }), { primary: ["a", "b", "c", "d"], secondary: [] }, { avatars: four });
  assert.ok(start.ok && start.zielgruppen.primary.length === 4, "Startseite: four primary");
  const sub = await saveContentZielgruppen(db.service as never, page({ page_type: "unterseite", zielgruppen: { ...EMPTY_CONTENT_ZIELGRUPPEN } }), { primary: ["a", "b", "c", "d"], secondary: [] }, { avatars: four });
  assert.ok(sub.ok && sub.zielgruppen.primary.join() === "a,b" && sub.zielgruppen.secondary.join() === "c,d", "Unterseite: two primary, the others secondary");
  const unknown = await saveContentZielgruppen(db.service as never, current, { primary: ["x"], secondary: [] }, { avatars });
  assert.ok(!unknown.ok && unknown.status === 400);
  console.log("save: ok");
}

/** Without the migration the page is read without `zielgruppen` (Texte runs as before). */
async function testWithoutColumn() {
  const selects: string[] = [];
  const service = {
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        const missing = columns.includes("zielgruppen");
        const chain = {
          eq: () => chain,
          maybeSingle: async () =>
            missing
              ? { data: null, error: { code: "42703", message: "column dt_content_pages.zielgruppen does not exist" } }
              : { data: { id: "p1", slug: "uhren", name: "Uhren" }, error: null },
        };
        return chain;
      },
    }),
  };
  const row = await loadContentPage(service as never, ORG, "uhren");
  assert.equal(selects.length, 2, "read again without the column");
  assert.ok(row && row.zielgruppen === undefined, "no Zielgruppen without the column");
  console.log("without the migration: ok");
}

async function main() {
  testModel();
  await testWithoutColumn();
  testPromptBlock();
  await testSuggest();
  await testSave();
  console.log("OK: content zielgruppen tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
