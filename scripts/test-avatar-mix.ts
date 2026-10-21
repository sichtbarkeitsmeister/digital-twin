/**
 * The Mix under Agenten: which row is the Mix, what it is built from, the „Mix-Avatar“ prompt,
 * the user message, the rules, one retry, create and update, where the Mix stays out, and the
 * avatar dropdowns of Texte, SEO, GEO and Hormozi.
 * Run: npx tsx scripts/test-avatar-mix.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MIX_AGENT_SLUG,
  defaultAvatarOptionId,
  findMixAgent,
  isMixAgent,
  isMixOutdated,
  mixOptionLabel,
  mixRole,
  mixSourceCandidates,
  readMixInfo,
} from "../lib/dt/agents/mix";
import { avatarTextForContent } from "../lib/dt/agents/avatar-text";
import {
  MIX_REQUIRED_HEADINGS,
  MIX_TOOL,
  buildMixUserMessage,
  generateCheckedMixWith,
  mixRuleFailureMessage,
  normalizeMixResult,
  saveMixAgent,
  selectMixSources,
  validateMixResult,
  type MixAgentRow,
  type MixResult,
} from "../lib/dt/agents/mix-generator";
import {
  DEFAULT_MIX_PROMPT,
  MIX_PROMPT_MIGRATION_FILE,
  MIX_PROMPT_SLUG,
  resolveMixPrompt,
} from "../lib/dt/agents/mix-prompt";
import { loadMixPrompt } from "../lib/dt/agents/mix-prompt-db";
import { loadContentAvatarOptions, loadContentAvatarRow } from "../lib/dt/content/load-sources";
import { avatarFromAgent } from "../lib/dt/content/mapping";
import { avatarBlock } from "../lib/dt/content/pipeline/prompts";
import { AVATAR_GLOBAL_PROMPT_ANCHOR } from "../lib/dt/prompts/avatar-global-prompt-anchor";
import { isSeoWunschkundeSourceAgent, loadWunschkundeProfilesForSeo } from "../lib/dt/seo/wunschkunden-knowledge";
import { pickPersonaReferenceRows } from "../lib/dt/survey-to-agent-context";
import {
  applyTranscriptExtractToOrg,
  createConfirmedTranscriptPersonas,
  personasAwaitingConfirmation,
} from "../lib/dt/transcripts/apply-knowledge";
import type { WorkshopToolCall } from "../lib/dt/transcripts/avatar-plan-llm";
import type { DtTranscriptPersonaExtract } from "../lib/dt/transcripts/types";

const ORG = "00000000-0000-4000-8000-000000000001";
const FOREIGN_ID = "99999999-9999-4999-8999-999999999999";
const SEO_ID = "11111111-1111-4111-8111-111111111111";
const ANNA_ID = "22222222-2222-4222-8222-222222222222";
const BERND_ID = "33333333-3333-4333-8333-333333333333";
const CLARA_ID = "44444444-4444-4444-8444-444444444444";
const TWIN_ID = "55555555-5555-4555-8555-555555555555";
const MIX_ID = "66666666-6666-4666-8666-666666666666";
const NEW_ID = "77777777-7777-4777-8777-777777777777";

const ANNA_TEXT = `${AVATAR_GLOBAL_PROMPT_ANCHOR}
---
## WER DU BIST
Du bist Anna Becker, 46 Jahre alt, Hausverwalterin aus Mülheim. Die Treppenhäuser deiner Objekte sind seit Jahren nicht gestrichen.`;
const BERND_TEXT = "Du bist Bernd Schulz, 58 Jahre alt, und willst die Fassade deines Hauses vor dem Verkauf streichen lassen.";
const CLARA_TEXT = "Du bist Clara Weiß und suchst einen Maler für dein Ladenlokal.";
const QUICK_ACTIONS = ["Erstgespräch durchspielen", "Angebotstext testen", "Einwand zum Preis üben", "Terminzusage formulieren"];

function agent(partial: Partial<MixAgentRow> & Pick<MixAgentRow, "id" | "name">): MixAgentRow {
  return {
    role: null,
    kind: "persona",
    slug: partial.name.toLowerCase().replace(/[^a-z]+/g, "_"),
    is_enabled: true,
    is_default: false,
    uses_global_prompt: true,
    prompt_template: `Avatar: ${partial.name}`,
    prompt_append: null,
    avatar_data: {},
    ...partial,
  };
}

const MIX_INFO = {
  sourceAgentIds: [ANNA_ID, BERND_ID],
  sourceNames: ["Anna Becker", "Bernd Schulz"],
  generatedAt: "2026-10-21T10:00:00.000Z",
};

const SEO = agent({ id: SEO_ID, name: "SEO-Berater", kind: "seo_advisor", slug: "seo_advisor", is_default: true, uses_global_prompt: false });
const ANNA = agent({ id: ANNA_ID, name: "Anna Becker", role: "Hausverwalterin", prompt_append: ANNA_TEXT, avatar_data: { icon: "🏢" } });
const BERND = agent({
  id: BERND_ID,
  name: "Bernd Schulz",
  role: "Eigenheimbesitzer",
  kind: "wunschkunde",
  uses_global_prompt: false,
  prompt_template: BERND_TEXT,
});
const CLARA = agent({ id: CLARA_ID, name: "Clara Weiß", role: "Ladeninhaberin", is_enabled: false, prompt_append: CLARA_TEXT });
const TWIN = agent({ id: TWIN_ID, name: "DigitalTwin", slug: "default", is_default: true });
const MIX = agent({
  id: MIX_ID,
  name: "Mix",
  slug: MIX_AGENT_SLUG,
  role: mixRole(2),
  prompt_append: `${AVATAR_GLOBAL_PROMPT_ANCHOR}\nDer alte Mix.`,
  avatar_data: { mix: MIX_INFO, icon: "🧩" },
});
const ORG_AGENTS = [SEO, ANNA, BERND, CLARA, TWIN];

const VALID_MIX = `${AVATAR_GLOBAL_PROMPT_ANCHOR}
---
## ANREDE
Im Gespräch mit deinem Gesprächspartner, also dem Mitarbeiter von Malerei Hoffmann, duzt du ganz normal. Das ist eine interne Trainingssituation, keine echte Kundenkommunikation.
---
## WER DU BIST
Du stehst für diese Zielgruppen:
- Hausverwalterin: Treppenhäuser ohne Beschwerden der Mieter
- Eigenheimbesitzer: eine frische Fassade vor dem Verkauf
Beide suchen einen Betrieb, der zurückruft und einen festen Termin nennt.
---
## EURE GEMEINSAME SITUATION
Ein Anstrich ist seit Jahren überfällig, und jetzt drängt ein Termin.
---
## EUER GEMEINSAMES ZIEL
Ein Anruf, und das Thema ist erledigt. Ihr merkt es daran, dass niemand mehr nachfragt.
---
## WAS EUCH BELASTET
1. Betriebe, die nicht zurückrufen
2. Angebote, die wochenlang dauern
---
## WAS VOM ANFRAGEN ABHÄLT
Ihr rechnet damit, dass sich ohnehin niemand meldet.
---
## TYPISCHE FRAGEN
1. "Wann könnt ihr anfangen?"
2. "Was kostet das?"
---
## EINWÄNDE UND BEDENKEN
1. Der Preis. Ein Festpreis beruhigt euch.
2. Die Wartezeit. Ein fester Starttermin beruhigt euch.
---
## WAS EUCH ÜBERZEUGT
- Preis: ein Festpreis
- Zuverlässigkeit: ein Referenzobjekt in der Nähe
---
## ENTSCHEIDUNG UND ZEITRAHMEN
Die Hausverwalterin entscheidet mit dem Beirat, der Eigenheimbesitzer allein. Den Ausschlag gibt ein fester Termin, meist innerhalb von zwei Wochen.
---
## WO SICH DIE ZIELGRUPPEN UNTERSCHEIDEN
- Hausverwalterin: braucht die Zustimmung des Beirats und denkt in Objekten
- Eigenheimbesitzer: denkt an den Verkaufspreis seines Hauses
---
## DEINE SPRACHE
- Wörter: Treppenhaus, Fassade, Termin
- Abblocken bei: Fachbegriffen zu Farbsystemen`;

function mixResult(patch: Partial<MixResult> = {}): MixResult {
  return { promptTemplate: VALID_MIX, quickActions: [...QUICK_ACTIONS], icon: "🧩", ...patch };
}

type Row = Record<string, unknown>;
type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcAnswer = { data: unknown; error: { message: string } | null };

/** Supabase stand-in: filters by eq/neq/is/in/limit, returns only the selected columns, answers rpc through `rpc`. */
function fakeDb(tables: Record<string, Row[]>, rpc: (call: RpcCall) => RpcAnswer = () => ({ data: null, error: null })) {
  const calls: RpcCall[] = [];
  const client = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let columns: string[] | null = null;
      const project = (row: Row): Row =>
        columns ? Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]])) : row;
      const query = {
        select: (list?: string) => {
          columns = list && list.trim() !== "*" ? list.split(",").map((column) => column.trim()) : null;
          return query;
        },
        eq: (field: string, value: unknown) => {
          rows = rows.filter((row) => row[field] === value);
          return query;
        },
        neq: (field: string, value: unknown) => {
          rows = rows.filter((row) => row[field] !== value);
          return query;
        },
        is: (field: string, value: unknown) => {
          rows = rows.filter((row) => (row[field] ?? null) === value);
          return query;
        },
        in: (field: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[field]));
          return query;
        },
        order: () => query,
        limit: (count: number) => {
          rows = rows.slice(0, count);
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ? project(rows[0]) : null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows.map(project), error: null }).then(resolve, reject),
      };
      return query;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const call = { fn, args };
      calls.push(call);
      return rpc(call);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function asOrgRows(agents: MixAgentRow[]): Row[] {
  return agents.map((row) => ({ ...row, organisation_id: ORG }));
}

function fakeCall(responses: unknown[]) {
  const calls: Array<{ system: string; user: string; tool: string }> = [];
  const call: WorkshopToolCall = async (input) => {
    calls.push({ system: input.system, user: input.user, tool: input.tool.name });
    const json = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { json, usage: { inputTokens: 100, outputTokens: 50 }, model: "claude-test" };
  };
  return { call, calls };
}

function toolJson(result: MixResult): Record<string, unknown> {
  return { prompt_template: result.promptTemplate, quick_actions: result.quickActions, icon: result.icon };
}

function testIsMixAgent() {
  assert.equal(isMixAgent({ slug: "mix" }), true);
  assert.equal(isMixAgent({ slug: "gesamt", avatar_data: { mix: MIX_INFO } }), true);
  assert.equal(isMixAgent({ slug: "anna", avatar_data: { icon: "🏢" } }), false);
  assert.equal(isMixAgent({ slug: "anna", avatar_data: { mix: null } }), false);
  assert.equal(isMixAgent({ slug: "mix_2", avatar_data: null }), false);
  assert.equal(isMixAgent({}), false);
  assert.deepEqual(readMixInfo(MIX.avatar_data), MIX_INFO);
  assert.equal(readMixInfo({ icon: "🏢" }), null);
  assert.equal(findMixAgent([ANNA, MIX, BERND])?.id, MIX_ID);
  assert.equal(findMixAgent(ORG_AGENTS), null);
  assert.equal(mixRole(3), "Mix aus 3 Zielgruppen");
  assert.equal(mixOptionLabel(3), "Mix (aus 3 Zielgruppen)");
  console.log("isMixAgent: ok");
}

function testSources() {
  const agents = [...ORG_AGENTS, MIX];
  // The dialog lists the enabled Zielgruppen avatars only: no SEO-Berater, default twin, disabled avatar or Mix.
  assert.deepEqual(mixSourceCandidates(agents).map((row) => row.id), [ANNA_ID, BERND_ID]);

  const picked = selectMixSources(agents, [BERND_ID, MIX_ID, ANNA_ID]);
  assert.ok(picked.ok);
  assert.deepEqual(picked.sources.map((source) => source.id), [ANNA_ID, BERND_ID], "Mix skipped, list order");
  assert.equal(picked.mix?.id, MIX_ID);
  // The avatar part: prompt_append on the global prompt, the own prompt otherwise.
  assert.equal(picked.sources[0]?.text, ANNA_TEXT);
  assert.equal(picked.sources[1]?.text, BERND_TEXT);
  assert.equal(picked.sources[1]?.role, "Eigenheimbesitzer");

  const foreign = selectMixSources(agents, [ANNA_ID, FOREIGN_ID]);
  assert.equal(foreign.ok, false);
  assert.match(!foreign.ok ? foreign.message : "", /gehört nicht zu dieser Organisation/);

  const onlyOneLeft = selectMixSources(agents, [ANNA_ID, MIX_ID]);
  assert.deepEqual(onlyOneLeft, { ok: false, message: "Mindestens zwei Zielgruppen-Avatare auswählen." });
  assert.deepEqual(selectMixSources(agents, [ANNA_ID]), { ok: false, message: "Mindestens zwei Zielgruppen-Avatare auswählen." });

  const advisor = selectMixSources(agents, [ANNA_ID, SEO_ID]);
  assert.deepEqual(advisor, { ok: false, message: "Kein aktiver Zielgruppen-Avatar: „SEO-Berater“." });
  const disabled = selectMixSources(agents, [ANNA_ID, BERND_ID, CLARA_ID]);
  assert.deepEqual(disabled, { ok: false, message: "Kein aktiver Zielgruppen-Avatar: „Clara Weiß“." });

  const firstMix = selectMixSources(ORG_AGENTS, [ANNA_ID, BERND_ID]);
  assert.ok(firstMix.ok);
  assert.equal(firstMix.mix, null);
  console.log("sources: Mix skipped, foreign ids refused, at least two: ok");
}

async function testSystemPrompt() {
  const filled = resolveMixPrompt(null, "Malerei Hoffmann");
  assert.match(filled, /^Du bist der Mix-Generator von DigitalTwin für Malerei Hoffmann\./);
  assert.equal(filled.includes("{{organisation}}"), false);
  assert.match(filled, /also dem Mitarbeiter von Malerei Hoffmann, duzt du/);
  assert.equal(resolveMixPrompt("   ", "Malerei Hoffmann"), filled);
  assert.equal(resolveMixPrompt("Eigener Mix für {{organisation}} und {{organisation}}.", "Malerei Hoffmann"), "Eigener Mix für Malerei Hoffmann und Malerei Hoffmann.");
  assert.equal(MIX_PROMPT_SLUG, "avatar_mix");

  const saved = fakeDb({ dt_agent_templates: [{ slug: MIX_PROMPT_SLUG, default_prompt: "Gespeichert für {{organisation}}." }] });
  assert.equal(await loadMixPrompt("Malerei Hoffmann", saved.client), "Gespeichert für Malerei Hoffmann.");
  const empty = fakeDb({ dt_agent_templates: [{ slug: MIX_PROMPT_SLUG, default_prompt: "" }] });
  assert.equal(await loadMixPrompt("Malerei Hoffmann", empty.client), filled);
  const missing = fakeDb({ dt_agent_templates: [] });
  assert.equal(await loadMixPrompt("Malerei Hoffmann", missing.client), filled);

  // The generator sends exactly this system prompt.
  const { call, calls } = fakeCall([toolJson(mixResult())]);
  const sources = selectMixSources(ORG_AGENTS, [ANNA_ID, BERND_ID]);
  assert.ok(sources.ok);
  await generateCheckedMixWith({ system: filled, sources: sources.sources, call });
  assert.equal(calls[0]?.system, filled);
  assert.equal(calls[0]?.tool, MIX_TOOL.name);
  console.log("system prompt: saved text or default, organisation filled in: ok");
}

function testDefaultPromptAndMigration() {
  // The required blocks are the ones the default prompt lists, in its order.
  const blockList = DEFAULT_MIX_PROMPT.slice(
    DEFAULT_MIX_PROMPT.indexOf("BLÖCKE IN DIESER REIHENFOLGE"),
    DEFAULT_MIX_PROMPT.indexOf("QUICK ACTIONS"),
  );
  const headings = [...blockList.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, [...MIX_REQUIRED_HEADINGS]);
  assert.equal(/[–—]/.test(DEFAULT_MIX_PROMPT), false);
  assert.equal(/\[[^\]]+\]/.test(DEFAULT_MIX_PROMPT), false);

  // The migration stores the same default and keeps every slug the function accepted before.
  const sql = readFileSync(MIX_PROMPT_MIGRATION_FILE, "utf8");
  const stored = sql.slice(sql.indexOf("$prompt$") + "$prompt$".length, sql.lastIndexOf("$prompt$"));
  assert.equal(stored, DEFAULT_MIX_PROMPT);
  assert.match(sql, /ON CONFLICT \(slug\) DO NOTHING;/);
  assert.match(sql, /'avatar_mix',\s+'custom',\s+'Mix-Avatar',/);
  assert.match(
    sql,
    /p_slug NOT IN \('default', 'seo_advisor', 'survey_to_agent', 'survey_refine_agent', 'avatar_generator', 'avatar_mix'\)/,
  );
  console.log("default prompt and migration: ok");
}

function testUserMessage() {
  const picked = selectMixSources([...ORG_AGENTS, MIX], [ANNA_ID, BERND_ID]);
  assert.ok(picked.ok);
  const message = buildMixUserMessage({ sources: picked.sources });
  assert.equal(
    message,
    [
      "Die 2 ausgewählten Zielgruppen-Avatare:",
      `<avatar nummer="1">\nName: Anna Becker\nRolle: Hausverwalterin\nAvatar-Text:\n${ANNA_TEXT}\n</avatar>`,
      `<avatar nummer="2">\nName: Bernd Schulz\nRolle: Eigenheimbesitzer\nAvatar-Text:\n${BERND_TEXT}\n</avatar>`,
    ].join("\n\n"),
  );
  // Nothing else: no ids, no other agent, no Quick Actions, no stored avatar data.
  for (const leaked of [ANNA_ID, BERND_ID, MIX_ID, "SEO-Berater", "Clara", "Der alte Mix", "🏢", "Avatar: Bernd Schulz"]) {
    assert.equal(message.includes(leaked), false, `user message must not contain ${leaked}`);
  }
  const noRole = buildMixUserMessage({ sources: [{ id: ANNA_ID, name: "Anna Becker", role: null, text: ANNA_TEXT }] });
  assert.match(noRole, /Rolle: keine Angabe/);

  const retry = buildMixUserMessage({ sources: picked.sources, previousErrors: ["Pflichtblock fehlt: „## DEINE SPRACHE“."] });
  assert.ok(retry.startsWith(message));
  assert.match(retry, /Dein letztes Ergebnis wurde nicht gespeichert\. Diese Regeln waren verletzt, behebe sie:\n- Pflichtblock fehlt: „## DEINE SPRACHE“\./);
  console.log("user message: name, role and text of each selected avatar, nothing else: ok");
}

function testValidation() {
  assert.deepEqual(validateMixResult(mixResult()), []);

  const expectOnly = (result: MixResult, pattern: RegExp) => {
    const errors = validateMixResult(result);
    assert.equal(errors.length, 1, errors.join(" | "));
    assert.match(errors[0]!, pattern);
  };
  expectOnly(mixResult({ promptTemplate: "" }), /keinen Mix-Text/);
  expectOnly(mixResult({ promptTemplate: `Einleitung\n${VALID_MIX}` }), /beginnt nicht mit „## ANKER: GLOBALER DIGITALTWIN-PROMPT“/);
  expectOnly(mixResult({ promptTemplate: VALID_MIX.replace("## TYPISCHE FRAGEN", "## FRAGEN") }), /Pflichtblock fehlt: „## TYPISCHE FRAGEN“/);
  const swapped = VALID_MIX.replace("## EURE GEMEINSAME SITUATION", "## PLATZHALTER_A")
    .replace("## EUER GEMEINSAMES ZIEL", "## EURE GEMEINSAME SITUATION")
    .replace("## PLATZHALTER_A", "## EUER GEMEINSAMES ZIEL");
  expectOnly(mixResult({ promptTemplate: swapped }), /„## EUER GEMEINSAMES ZIEL“ steht vor „## EURE GEMEINSAME SITUATION“/);
  expectOnly(mixResult({ promptTemplate: VALID_MIX.replace("einen festen Termin", "[Termin]") }), /Platzhalter in eckigen Klammern: „\[Termin\]“/);
  expectOnly(mixResult({ promptTemplate: VALID_MIX.replace("ein Festpreis\n", "ein Festpreis – sofort\n") }), /Gedankenstrich/);
  expectOnly(mixResult({ promptTemplate: VALID_MIX.replace("ein Festpreis\n", "ein Festpreis — sofort\n") }), /Gedankenstrich/);
  expectOnly(mixResult({ quickActions: QUICK_ACTIONS.slice(0, 3) }), /3 Quick Actions statt 4 bis 6/);
  expectOnly(mixResult({ quickActions: [...QUICK_ACTIONS, "Rückruf üben", "Festpreis erklären", "Referenz zeigen"] }), /7 Quick Actions statt 4 bis 6/);
  for (const persona of ["Ich brauche ein Angebot", "Mir ist das zu teuer", "Mich ruft keiner zurück", "Meine Fassade bröckelt"]) {
    expectOnly(mixResult({ quickActions: [...QUICK_ACTIONS.slice(0, 3), persona] }), /Quick Action aus Sicht der Persona/);
  }
  assert.deepEqual(validateMixResult(mixResult({ quickActions: [...QUICK_ACTIONS, "Mitarbeiterfrage testen"] })), []);

  // Normalising tidies what the model keeps getting wrong: a code fence, text before the
  // anchor, dashes; Quick Actions sent as a JSON string are read back.
  const normalized = normalizeMixResult({
    prompt_template: `\`\`\`markdown\nHier ist der Mix:\n${VALID_MIX.replace("ein Festpreis\n", "ein Festpreis – sofort\n")}\n\`\`\``,
    quick_actions: JSON.stringify(QUICK_ACTIONS),
    icon: "🧩",
  });
  assert.deepEqual(validateMixResult(normalized), []);
  assert.equal(normalized.promptTemplate.includes("ein Festpreis, sofort"), true);
  assert.deepEqual(normalized.quickActions, QUICK_ACTIONS);
  assert.equal(normalized.icon, "🧩");
  console.log("validation rules pass and fail: ok");
}

async function testRetry() {
  const sources = selectMixSources(ORG_AGENTS, [ANNA_ID, BERND_ID]);
  assert.ok(sources.ok);
  const broken = toolJson(mixResult({ promptTemplate: VALID_MIX.replace(/\n---\n## DEINE SPRACHE[\s\S]*$/, "") }));

  // Broken, then valid: the second run gets the errors of the first in its user message.
  const fixed = fakeCall([broken, toolJson(mixResult())]);
  const passed = await generateCheckedMixWith({ system: "System", sources: sources.sources, call: fixed.call });
  assert.equal(passed.runs, 2);
  assert.deepEqual(passed.errors, []);
  assert.equal(passed.result.promptTemplate, VALID_MIX);
  assert.deepEqual(passed.usage, { inputTokens: 200, outputTokens: 100 });
  assert.equal(fixed.calls[0]?.user, buildMixUserMessage({ sources: sources.sources }));
  assert.match(fixed.calls[1]?.user ?? "", /Diese Regeln waren verletzt, behebe sie:\n- Pflichtblock fehlt: „## DEINE SPRACHE“\./);

  // Broken twice: no third run, the errors stay and nothing may be saved.
  const twice = fakeCall([broken, broken, toolJson(mixResult())]);
  const failed = await generateCheckedMixWith({ system: "System", sources: sources.sources, call: twice.call });
  assert.equal(twice.calls.length, 2);
  assert.equal(failed.runs, 2);
  assert.deepEqual(failed.errors, ["Pflichtblock fehlt: „## DEINE SPRACHE“."]);
  const message = mixRuleFailureMessage(failed.errors);
  assert.equal(message, "Der Mix wurde nicht gespeichert, weil das Ergebnis gegen Regeln verstößt: Pflichtblock fehlt: „## DEINE SPRACHE“. Bitte erneut versuchen.");

  // A valid first result needs no second run.
  const once = fakeCall([toolJson(mixResult())]);
  assert.equal((await generateCheckedMixWith({ system: "System", sources: sources.sources, call: once.call })).runs, 1);

  // Past the deadline the second run does not start.
  const late = fakeCall([broken, toolJson(mixResult())]);
  const lateResult = await generateCheckedMixWith({
    system: "System",
    sources: sources.sources,
    call: late.call,
    deadline: 1_000,
    now: () => 2_000,
  });
  assert.equal(late.calls.length, 1);
  assert.equal(lateResult.errors.length, 1);
  console.log("one retry, then error: ok");
}

function rpcAnswer(options: { deleted?: string[]; slugTaken?: boolean } = {}) {
  return (call: RpcCall): RpcAnswer => {
    if (call.fn === "dt_create_persona_agent") {
      return options.slugTaken ? { data: null, error: { message: "agent_slug_exists" } } : { data: NEW_ID, error: null };
    }
    if (call.fn === "dt_update_agent" && options.deleted?.includes(String(call.args.p_agent_id))) {
      return { data: null, error: { message: "agent_not_found" } };
    }
    return { data: call.args.p_agent_id ?? null, error: null };
  };
}

async function testCreateThenUpdate() {
  const generatedAt = "2026-10-21T12:00:00.000Z";

  // First run: no Mix yet, so it is created with slug `mix` on the global prompt.
  const first = selectMixSources(ORG_AGENTS, [ANNA_ID, BERND_ID]);
  assert.ok(first.ok);
  const creating = fakeDb({}, rpcAnswer());
  const created = await saveMixAgent({
    supabase: creating.client,
    organisationId: ORG,
    existing: first.mix,
    result: mixResult(),
    sources: first.sources,
    generatedAt,
  });
  assert.deepEqual(created, { ok: true, agentId: NEW_ID, created: true });
  assert.equal(creating.calls.length, 1);
  assert.equal(creating.calls[0]?.fn, "dt_create_persona_agent");
  assert.equal(creating.calls[0]?.args.p_organisation_id, ORG);
  const payload = creating.calls[0]?.args.p_payload as Record<string, unknown>;
  assert.equal(payload.slug, "mix");
  assert.equal(payload.name, "Mix");
  assert.equal(payload.role, "Mix aus 2 Zielgruppen");
  assert.equal(payload.prompt_template, "Avatar: Mix");
  assert.equal(payload.prompt_append, VALID_MIX);
  assert.equal(payload.uses_global_prompt, true);
  assert.equal(payload.is_enabled, true);
  assert.deepEqual(payload.quick_actions, QUICK_ACTIONS);
  assert.deepEqual(payload.avatar_data, {
    mix: { sourceAgentIds: [ANNA_ID, BERND_ID], sourceNames: ["Anna Becker", "Bernd Schulz"], generatedAt },
    icon: "🧩",
  });
  const createdRow = agent({
    id: NEW_ID,
    name: "Mix",
    slug: "mix",
    role: payload.role as string,
    prompt_append: payload.prompt_append as string,
    avatar_data: payload.avatar_data,
  });
  assert.equal(isMixAgent(createdRow), true);

  // Rebuild: the same row is updated in place (same id, so the chats stay).
  const rebuild = selectMixSources([...ORG_AGENTS, createdRow], [ANNA_ID, BERND_ID]);
  assert.ok(rebuild.ok);
  assert.equal(rebuild.mix?.id, NEW_ID);
  const updating = fakeDb({}, rpcAnswer());
  const later = "2026-10-22T08:00:00.000Z";
  const updated = await saveMixAgent({
    supabase: updating.client,
    organisationId: ORG,
    existing: rebuild.mix,
    result: mixResult({ icon: "", quickActions: QUICK_ACTIONS.slice(1).concat("Rückruf üben") }),
    sources: rebuild.sources,
    generatedAt: later,
  });
  assert.deepEqual(updated, { ok: true, agentId: NEW_ID, created: false });
  assert.deepEqual(updating.calls.map((call) => call.fn), ["dt_update_agent"]);
  assert.equal(updating.calls[0]?.args.p_agent_id, NEW_ID);
  const patch = updating.calls[0]?.args.p_patch as Record<string, unknown>;
  assert.equal(patch.prompt_append, VALID_MIX);
  assert.equal(patch.role, "Mix aus 2 Zielgruppen");
  assert.equal(patch.uses_global_prompt, true);
  assert.deepEqual(patch.quick_actions, [...QUICK_ACTIONS.slice(1), "Rückruf üben"]);
  assert.deepEqual(patch.avatar_data, {
    mix: { sourceAgentIds: [ANNA_ID, BERND_ID], sourceNames: ["Anna Becker", "Bernd Schulz"], generatedAt: later },
    icon: "🧩",
  });
  // Name and on/off stay as the team set them.
  assert.equal("name" in patch, false);
  assert.equal("is_enabled" in patch, false);

  // A Mix deleted meanwhile is created anew; a second Mix created meanwhile is refused.
  const gone = fakeDb({}, rpcAnswer({ deleted: [MIX_ID] }));
  const recreated = await saveMixAgent({ supabase: gone.client, organisationId: ORG, existing: MIX, result: mixResult(), sources: first.sources, generatedAt });
  assert.deepEqual(recreated, { ok: true, agentId: NEW_ID, created: true });
  assert.deepEqual(gone.calls.map((call) => call.fn), ["dt_update_agent", "dt_create_persona_agent"]);
  const raced = fakeDb({}, rpcAnswer({ slugTaken: true }));
  const refused = await saveMixAgent({ supabase: raced.client, organisationId: ORG, existing: null, result: mixResult(), sources: first.sources, generatedAt });
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.message : "", /Inzwischen gibt es schon einen Mix/);
  console.log("create on first run, update the same id on rebuild: ok");
}

function testOutdated() {
  const at = MIX_INFO.generatedAt;
  const agents = [
    { id: ANNA_ID, updated_at: "2026-10-21T09:59:59.999999+00:00" },
    { id: BERND_ID, updated_at: "2026-10-21T08:00:00+00:00" },
  ];
  assert.equal(isMixOutdated(MIX_INFO, agents), false);
  assert.equal(isMixOutdated(MIX_INFO, [agents[0]!]), true, "a deleted source");
  assert.equal(isMixOutdated(MIX_INFO, [agents[0]!, { id: BERND_ID, updated_at: "2026-10-21T10:00:00.001234+00:00" }]), true, "a source changed after generatedAt");
  assert.equal(isMixOutdated({ ...MIX_INFO, generatedAt: at }, [...agents, { id: CLARA_ID, updated_at: "2026-10-23T00:00:00+00:00" }]), false, "other avatars do not count");
  console.log("outdated sources: ok");
}

async function testExclusions() {
  // SEO-Berater knowledge.
  assert.equal(isSeoWunschkundeSourceAgent({ kind: "persona", slug: "mix", is_enabled: true, is_default: false }), false);
  assert.equal(
    isSeoWunschkundeSourceAgent({ kind: "persona", slug: "gesamt", is_enabled: true, is_default: false, avatar_data: { mix: MIX_INFO } }),
    false,
  );
  assert.equal(isSeoWunschkundeSourceAgent({ kind: "persona", slug: "anna", is_enabled: true, is_default: false }), true);
  const seoDb = fakeDb({ dt_agents: asOrgRows([...ORG_AGENTS, MIX]), surveys: [] });
  const profiles = await loadWunschkundeProfilesForSeo(seoDb.client, ORG);
  assert.deepEqual(profiles.map((profile) => profile.name), ["Anna Becker", "Bernd Schulz"]);

  // Reference examples for questionnaire → agent: never the Mix, even with the longest prompt.
  const longMix = { ...MIX, prompt_template: "x".repeat(5_000) };
  assert.deepEqual(pickPersonaReferenceRows([ANNA, longMix, BERND]).map((row) => row.id), [BERND_ID]);
  assert.deepEqual(pickPersonaReferenceRows([longMix]), []);

  // Transcripts: a persona called „Mix“ is not the Mix, nothing is merged into the Mix.
  const persona = (name: string): DtTranscriptPersonaExtract => ({
    name,
    role: null,
    priority: "A",
    isPrimary: true,
    description: `${name} aus dem Gespräch.`,
    goals: null,
    pains: null,
    objections: null,
    language: null,
    buyingTriggers: null,
    promptAppend: `Du bist ${name}.`,
  });
  const pending = personasAwaitingConfirmation([persona("Mix"), persona("Anna Becker")], [MIX, ANNA]);
  assert.deepEqual(pending.map((item) => item.name), ["Mix"]);

  const applyDb = fakeDb({ dt_agents: asOrgRows([ANNA, MIX]), dt_meeting_transcripts: [] });
  const applied = await applyTranscriptExtractToOrg({
    supabase: applyDb.client,
    organisationId: ORG,
    extract: { title: null, summary: "", anbieterMarkdown: "", personas: [persona("Mix"), persona("Anna Becker")] },
  });
  assert.deepEqual(applied.updatedPersonaIds, [ANNA_ID]);
  assert.deepEqual(applied.pendingPersonas.map((item) => item.name), ["Mix"]);
  assert.equal(applyDb.calls.some((call) => call.args.p_agent_id === MIX_ID), false);

  const createDb = fakeDb({ dt_agents: asOrgRows([ANNA, MIX]) }, () => ({ data: NEW_ID, error: null }));
  const confirmed = await createConfirmedTranscriptPersonas({
    supabase: createDb.client,
    organisationId: ORG,
    personas: [persona("Mix")],
    names: ["Mix"],
  });
  assert.deepEqual(confirmed.createdNames, ["Mix"]);
  assert.equal((createDb.calls[0]?.args.p_payload as Record<string, unknown>).slug, "mix_2");
  // Even without a Mix, `mix` stays reserved for it.
  const reservedDb = fakeDb({ dt_agents: asOrgRows([ANNA]) }, () => ({ data: NEW_ID, error: null }));
  await createConfirmedTranscriptPersonas({ supabase: reservedDb.client, organisationId: ORG, personas: [persona("Mix")], names: ["Mix"] });
  assert.equal((reservedDb.calls[0]?.args.p_payload as Record<string, unknown>).slug, "mix_2");
  console.log("Mix left out of SEO knowledge, reference examples and transcripts: ok");
}

async function testDropdowns() {
  const row = (agentRow: MixAgentRow, createdAt: string) => ({ ...agentRow, organisation_id: ORG, created_at: createdAt });
  // Newest first from the database; the Mix is the newest of all here.
  const rows = [
    row(MIX, "2026-10-21T12:00:00+00:00"),
    row(BERND, "2026-10-20T12:00:00+00:00"),
    row(ANNA, "2026-10-19T12:00:00+00:00"),
    row(SEO, "2026-10-01T12:00:00+00:00"),
  ];
  const db = fakeDb({ dt_agents: rows });
  const options = await loadContentAvatarOptions(db.client, ORG);
  assert.deepEqual(options.map((option) => option.id), [MIX_ID, BERND_ID, ANNA_ID]);
  assert.deepEqual(
    options.map((option) => ({ label: option.label, isMix: option.isMix })),
    [
      { label: "Mix (aus 2 Zielgruppen)", isMix: true },
      { label: "Bernd Schulz", isMix: false },
      { label: "Anna Becker", isMix: false },
    ],
  );
  // The preselection stays the newest Zielgruppen avatar.
  assert.equal(defaultAvatarOptionId(options), BERND_ID);

  // An older Mix is still listed first.
  const older = fakeDb({ dt_agents: [row(BERND, "2026-10-20T12:00:00+00:00"), row(MIX, "2026-10-01T12:00:00+00:00"), row(ANNA, "2026-09-19T12:00:00+00:00")] });
  const olderOptions = await loadContentAvatarOptions(older.client, ORG);
  assert.deepEqual(olderOptions.map((option) => option.id), [MIX_ID, BERND_ID, ANNA_ID]);
  assert.equal(defaultAvatarOptionId(olderOptions), BERND_ID);

  // Without a Mix nothing changes; a disabled Mix is not listed.
  const plain = fakeDb({ dt_agents: [row(BERND, "2026-10-20T12:00:00+00:00"), row(ANNA, "2026-10-19T12:00:00+00:00")] });
  const plainOptions = await loadContentAvatarOptions(plain.client, ORG);
  assert.deepEqual(plainOptions.map((option) => [option.label, option.isMix]), [["Bernd Schulz", false], ["Anna Becker", false]]);
  assert.equal(defaultAvatarOptionId(plainOptions), BERND_ID);
  const disabledMix = fakeDb({ dt_agents: [row({ ...MIX, is_enabled: false }, "2026-10-21T12:00:00+00:00"), row(ANNA, "2026-10-19T12:00:00+00:00")] });
  assert.deepEqual((await loadContentAvatarOptions(disabledMix.client, ORG)).map((option) => option.id), [ANNA_ID]);

  // Only the Mix left: it is the default, as the sole avatar was before.
  assert.equal(defaultAvatarOptionId([{ id: MIX_ID, isMix: true }]), MIX_ID);
  assert.equal(defaultAvatarOptionId([]), null);
  console.log("avatar dropdowns: Mix first, preselection unchanged: ok");
}

async function testToolsReadTheMix() {
  // Texte, SEO, GEO and Hormozi read the Mix text, not „Avatar: Mix“, and without the blocks
  // that only steer the chat (anchor, Anrede towards the employee).
  const forContent = avatarTextForContent({ name: "Mix", prompt_append: VALID_MIX, uses_global_prompt: true });
  assert.ok(forContent.startsWith("## WER DU BIST\nDu stehst für diese Zielgruppen:"));
  assert.match(forContent, /## WO SICH DIE ZIELGRUPPEN UNTERSCHEIDEN\n- Hausverwalterin/);
  assert.ok(forContent.endsWith("- Abblocken bei: Fachbegriffen zu Farbsystemen"));
  for (const chatOnly of ["ANKER", "ANREDE", "duzt du", "Trainingssituation", "\n---"]) {
    assert.equal(forContent.includes(chatOnly), false, `content text must not contain ${chatOnly}`);
  }
  assert.equal(avatarTextForContent({ name: "Mix", prompt_template: "Avatar: Mix", prompt_append: null, uses_global_prompt: true }), "");

  const storedMix = {
    ...MIX,
    organisation_id: ORG,
    prompt_template: "Avatar: Mix",
    prompt_append: VALID_MIX,
    avatar_data: { mix: MIX_INFO, icon: "🧩" },
  };
  const db = fakeDb({ dt_agents: [storedMix, { ...ANNA, organisation_id: ORG }] });
  const mixRow = await loadContentAvatarRow(db.client, ORG, MIX_ID);
  assert.ok(mixRow);
  const avatar = avatarFromAgent(mixRow);
  assert.equal(avatar.name, "Mix");
  assert.equal(avatar.role, "Mix aus 2 Zielgruppen");
  assert.equal(avatar.beschreibung, forContent);
  assert.equal(avatar.icon, "🧩");
  assert.equal("mix" in avatar, false, "the source list stays in Agenten");
  const block = avatarBlock({ avatar: { name: avatar.name, role: avatar.role, beschreibung: avatar.beschreibung } });
  assert.match(block, /^## Avatar \(Wunschkunde, für den der Text geschrieben wird\)\nName: Mix\nRolle: Mix aus 2 Zielgruppen\n## WER DU BIST/);
  // Up to 20,000 characters of the description reach the prompt; longer ones are cut there.
  const long = (chars: number) => avatarBlock({ avatar: { name: "Mix", role: "", beschreibung: "x".repeat(chars) } });
  assert.equal(long(20_000).endsWith("x".repeat(20_000)), true);
  assert.equal(long(25_000).endsWith(`${"x".repeat(20_000)}\n… (gekürzt)`), true);

  // The same rule for every avatar on the global prompt: its prompt_append, not the stub.
  const annaRow = await loadContentAvatarRow(db.client, ORG, ANNA_ID);
  assert.ok(annaRow);
  const anna = avatarFromAgent(annaRow);
  assert.equal(anna.beschreibung, ANNA_TEXT.slice(ANNA_TEXT.indexOf("## WER DU BIST")));
  assert.equal(anna.icon, "🏢");
  console.log("Texte, SEO, GEO, Hormozi read the Mix text: ok");
}

async function main() {
  testIsMixAgent();
  testSources();
  await testSystemPrompt();
  testDefaultPromptAndMigration();
  testUserMessage();
  testValidation();
  await testRetry();
  await testCreateThenUpdate();
  testOutdated();
  await testExclusions();
  await testDropdowns();
  await testToolsReadTheMix();
  console.log("avatar mix: all ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
