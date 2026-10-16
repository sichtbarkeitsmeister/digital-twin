/**
 * Avatar-Plan and avatar generator: exact count, summaries only, the ten rules of a finished
 * avatar part, and what reaches Agenten (nothing while Rückfragen are open).
 * Run: npx tsx scripts/test-avatar-generator.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AVATAR_GLOBAL_PROMPT_ANCHOR } from "../lib/dt/prompts/avatar-global-prompt-anchor";
import {
  AVATAR_GENERATOR_TOOL,
  AVATAR_REQUIRED_HEADINGS,
  applyAvatarGeneratorResult,
  avatarPromptBlock,
  buildAvatarGeneratorUserMessage,
  normalizeAvatarGeneratorResult,
  validateAvatarResult,
  type AvatarGeneratorResult,
} from "../lib/dt/transcripts/avatar-generator";
import {
  DEFAULT_AVATAR_GENERATOR_PROMPT,
  resolveAvatarGeneratorPrompt,
} from "../lib/dt/transcripts/avatar-generator-prompt";
import {
  generateAvatarWith,
  proposeAvatarPlanWith,
  type WorkshopToolCall,
} from "../lib/dt/transcripts/avatar-plan-llm";
import type { WorkshopAvatar, WorkshopSource } from "../lib/dt/transcripts/workshop-model";

const VALID_TEMPLATE = `${AVATAR_GLOBAL_PROMPT_ANCHOR}
---
## ANREDE
Im Gespräch mit deinem Gesprächspartner, also dem Mitarbeiter von Malerei Hoffmann, duzt du ganz normal. Das ist eine interne Trainingssituation, keine echte Kundenkommunikation.
---
## WER DU BIST
Du bist Sandra Becker, 46 Jahre alt, Inhaberin einer Hausverwaltung mit 120 Wohnungen, aus Mülheim an der Ruhr. Du lebst mit deinem Mann und zwei Kindern im eigenen Haus.
Deine Persönlichkeit zeigt sich so: Du entscheidest schnell, wenn die Zahlen stimmen. Bei Verzögerungen rufst du nach zwei Tagen an. Im Projekt willst du einmal pro Woche ein kurzes Update. Bei unerwarteten Problemen willst du sofort einen Plan. Persönlich bleibst du freundlich und direkt.
---
## DEINE SITUATION UND DER AUSLÖSER
Drei Treppenhäuser in deinen Objekten sind seit Jahren nicht gestrichen. Die Mieter beschweren sich.
Genau jetzt suchst du, weil die Eigentümerversammlung am 14. November einen Beschluss erwartet.
---
## DEIN TRAUMZIEL
Was du dir wünschst, ist das Leben danach:
"Ich will einmal anrufen und dann ist das Thema durch."
Woran du merkst, dass es geklappt hat: keine einzige Beschwerde mehr im nächsten Quartal.
---
## WAS DICH BELASTET
- Was du jeden Tag merkst: "Das Telefon klingelt wegen der Flure."
- Was eigentlich dahinter steckt: "Ich habe keinen Handwerker, auf den ich mich verlassen kann."
- Was dich persönlich wurmt: "Ich stehe vor den Eigentümern schlecht da."
- Was dich nachts wach hält: "Was, wenn der Auftrag wieder liegen bleibt?"
---
## WAS DICH VOM ANFRAGEN ABHÄLT
Bevor du Kontakt aufnimmst, bremst dich vor allem: schlechte Erfahrungen mit Betrieben, die nie zurückrufen. Du denkst dann: "Die melden sich doch eh nicht."
---
## DEINE FRAGEN UND FORMULIERUNGEN
Du meldest dich per E-Mail. Dabei klingst du so:
- "Kannst du dir die Flure diese Woche ansehen?"
- "Ich brauche ein Angebot bis Freitag."
Die drei Fragen, die fast immer in den ersten Minuten kommen:
1. "Wann könnt ihr anfangen?"
2. "Was kostet das pro Treppenhaus?"
3. "Arbeitet ihr auch, während die Mieter da sind?"
Dein Vorwissen: Du kennst Preise aus alten Angeboten, aber keine Farbsysteme.
---
## DEINE EINWÄNDE UND BEDENKEN
Vor der Entscheidung kommen bei dir diese Einwände, in dieser Reihenfolge:
1. "Das ist mir zu teuer."
2. "Ihr seid doch sicher ausgebucht."
3. "Wer haftet, wenn ein Mieter sich beschwert?"
Wenn du einen festen Starttermin hörst, reagierst du so: Du gibst den Auftrag noch am selben Tag frei.
---
## ZEIT UND EIGENER AUFWAND
- Erste Ergebnisse erwartest du nach 10 Tagen. Ungeduldig wirst du nach 3 Wochen.
- Als ersten spürbaren Fortschritt zählst du: das erste fertige Treppenhaus.
- Selbst übernehmen willst du höchstens: die Mieter per Aushang informieren.
- Auf keinen Fall willst du selbst: Schlüssel verteilen.
- Wenn mehr Eigenaufwand auf dich zukommt als gedacht, brichst du ab.
---
## WAS DICH ÜBERZEUGT
- Preis: überzeugt dich ein Festpreis pro Treppenhaus
- Zuverlässigkeit: überzeugt dich ein Referenzobjekt in Mülheim
---
## DEIN ENTSCHEIDUNGSPROZESS
Die Entscheidung triffst du gemeinsam mit dem Verwaltungsbeirat. Beeinflusst wirst du vor allem durch:
1. den Preis
2. die Empfehlung eines Kollegen
Den Ausschlag gibt am Ende: ein fester Termin. Von der ersten Anfrage bis zur Entscheidung vergehen 14 Tage.
---
## DEINE ALTERNATIVEN
Du vergleichst mit: zwei anderen Malerbetrieben aus der Region.
Wenn du gar nichts beauftragst, machst du: weiter Beschwerden abwimmeln. Das ist für dich die bequemste Option, weil sie heute nichts kostet.
---
## DEINE INFORMATIONSQUELLEN VOR DEM KONTAKT
Du informierst dich über Google-Bewertungen und die Website. Am stärksten überzeugt dich ein Foto von einem fertigen Treppenhaus. Aktiv fragst du nach: Referenzen von anderen Hausverwaltungen.
---
## DEINE KUNDENREISE
1. Suche: Du weißt zu diesem Zeitpunkt nur, dass du schnell jemanden brauchst. Du fragst dich: "Wer hat überhaupt Zeit?"
2. Angebot: Du kennst den Preis. "Ist das fair?"
Kritischer Moment, an dem du abspringen könntest: das Angebot, wenn es länger als eine Woche dauert.
---
## EMOTIONALE LAGE
Du bist gereizt, weil du dich vor den Eigentümern rechtfertigen musst.
---
## NACHBETREUUNG UND WEITEREMPFEHLUNG
Nach dem Auftrag fragst du: "Könnt ihr die anderen Objekte auch machen?"
Was du am meisten lobst:
1. Pünktlichkeit
2. Sauberkeit
Dein Wow-Moment: Die Mieter bedanken sich bei dir.
Weiterempfehlen würdest du, wenn auch das zweite Objekt reibungslos läuft.
---
## BARRIEREN UND HERAUSFORDERUNGEN
Du bist nur vormittags erreichbar und antwortest abends auf E-Mails.
---
## DEINE SPRACHE
- Wörter, die du selbst benutzt: Flur, Treppenhaus, Eigentümer
- Begriffe, die du nicht kennst und erklärt brauchst: Dispersionsfarbe
- Begriffe, die du verwechselst: Lack und Lasur
- Wörter, bei denen du abblockst: Premiumpaket
- Tonalität: kurz, sachlich, freundlich
---
## DEIN NÄCHSTER SCHRITT
- Ein erster Schritt, der sich für dich klein genug anfühlt: ein Vor-Ort-Termin von 30 Minuten
- Eine Warum-jetzt-Begründung, die du glaubst: die Eigentümerversammlung im November
- Was du als Druck empfindest und abblockst: Rabatte mit Frist`;

const QUICK_ACTIONS = [
  "Angebot für drei Treppenhäuser vorstellen",
  "Starttermin zusagen",
  "Einwand zum Preis beantworten",
  "Referenzobjekt in Mülheim zeigen",
];

const META = {
  abgeleitet: [{ block: "WER DU BIST", aussage: "META-GEHEIM 120 Wohnungen", grund: "Aus Fall 2 geschlossen" }],
  fehlende_daten: ["META-GEHEIM Budgetgrenze"],
  zusatzbloecke: ["EMOTIONALE LAGE"],
  offene_fragen: ["META-GEHEIM Wer im Beirat entscheidet?"],
};

function finished(patch: Partial<AvatarGeneratorResult> = {}, data: Partial<AvatarGeneratorResult["avatarData"]> = {}): AvatarGeneratorResult {
  return {
    status: "fertig",
    rueckfragen: [],
    promptTemplate: VALID_TEMPLATE,
    avatarData: { name: "Sandra Becker", role: "Inhaberin einer Hausverwaltung", icon: "🏢", quickActions: QUICK_ACTIONS, ...data },
    meta: META,
    ...patch,
  };
}

function source(id: string, spokenOn: string, summary: string | null, rawText: string): WorkshopSource {
  return {
    id,
    title: id,
    filename: null,
    sourceKind: "raw",
    spokenOn,
    createdAt: `${spokenOn}T10:00:00.000Z`,
    updatedAt: `${spokenOn}T10:00:00.000Z`,
    summary,
    rawText,
  };
}

const SOURCES = [
  source("Folgegespräch", "2026-09-20", "Hausverwaltungen wollen Festpreise.", "ROHTEXT Folgegespräch"),
  source("Auftakt", "2026-09-01", "Privatkunden mit Altbau.", "ROHTEXT Auftakt"),
];

function avatar(partial: Partial<WorkshopAvatar> = {}): WorkshopAvatar {
  return {
    key: "verwaltung",
    title: "Hausverwaltung mit mehreren Objekten",
    whySeparate: "Entscheidet mit dem Beirat.",
    cases: [{ service: "Treppenhaus", summary: "Drei Flure in Mülheim", quotes: ["Das muss bis November fertig sein."] }],
    generator: null,
    dossier: null,
    preview: null,
    agentId: null,
    ...partial,
  };
}

function fakeCall(responses: unknown[]) {
  const calls: Array<Parameters<WorkshopToolCall>[0]> = [];
  const call: WorkshopToolCall = async (input) => {
    calls.push(input);
    const json = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { json, usage: { inputTokens: 10, outputTokens: 5 }, model: "test-model" };
  };
  return { call, calls };
}

function planJson(count: number, extra: Record<string, unknown> = {}) {
  return {
    notWanted: "Großkonzerne",
    hinweis: "",
    avatars: Array.from({ length: count }, (_, index) => ({
      title: `Zielgruppe ${index + 1}`,
      whySeparate: `Anderer Anlass ${index + 1}`,
      cases: [{ service: "Fassade", summary: `Fall ${index + 1}`, quotes: [] }],
    })),
    ...extra,
  };
}

async function testPlanCountAndInput() {
  // Exactly the requested count, with the summaries (never the raw wording) as input.
  const exact = fakeCall([planJson(3)]);
  const plan = await proposeAvatarPlanWith({
    organisationName: "Malerei Hoffmann",
    sources: SOURCES,
    anbieterItems: [{ key: "unternehmen", label: "Unternehmen & Kern", current: "Malerbetrieb aus Mülheim", earlier: null, sources: "" }],
    previous: [],
    count: 3,
    call: exact.call,
  });
  assert.equal(plan.avatars.length, 3);
  assert.equal(plan.notWanted, "Großkonzerne");
  assert.equal(exact.calls.length, 1);
  const sent = exact.calls[0]!;
  assert.match(sent.user, /Anzahl Avatare: 3/);
  assert.match(sent.user, /Privatkunden mit Altbau\./);
  assert.match(sent.user, /Hausverwaltungen wollen Festpreise\./);
  assert.match(sent.user, /Malerbetrieb aus Mülheim/);
  assert.equal(sent.user.includes("ROHTEXT"), false);
  assert.ok(sent.user.indexOf("Auftakt") < sent.user.indexOf("Folgegespräch"));
  const schema = sent.tool.input_schema as { properties: { avatars: { minItems: number; maxItems: number } }; required: string[] };
  assert.equal(schema.properties.avatars.minItems, 3);
  assert.equal(schema.properties.avatars.maxItems, 3);
  assert.ok(schema.required.includes("hinweis"));

  // Fewer groups than asked: the plan still has the count and says why in hinweis.
  const withHint = fakeCall([planJson(2, { hinweis: "Avatar 1 und 2 überschneiden sich." })]);
  const hinted = await proposeAvatarPlanWith({ organisationName: "X", sources: SOURCES, previous: [], count: 2, call: withHint.call });
  assert.equal(hinted.hinweis, "Avatar 1 und 2 überschneiden sich.");

  // A wrong number is asked again once; the second answer counts.
  const retry = fakeCall([planJson(2), planJson(4)]);
  const retried = await proposeAvatarPlanWith({ organisationName: "X", sources: SOURCES, previous: [], count: 4, call: retry.call });
  assert.equal(retried.avatars.length, 4);
  assert.equal(retry.calls.length, 2);
  assert.match(retry.calls[1]!.user, /2 statt 4 Avatare/);

  // Too many are cut to the count.
  const many = fakeCall([planJson(5)]);
  const cut = await proposeAvatarPlanWith({ organisationName: "X", sources: SOURCES, previous: [], count: 2, call: many.call });
  assert.equal(cut.avatars.length, 2);

  // Still the wrong number after the retry: an error, nothing to save.
  const wrong = fakeCall([planJson(1)]);
  await assert.rejects(
    proposeAvatarPlanWith({ organisationName: "X", sources: SOURCES, previous: [], count: 3, call: wrong.call }),
    /1 statt 3 Avatare/,
  );

  // The count is clamped to 1 to 6.
  const clamp = fakeCall([planJson(6)]);
  const clamped = await proposeAvatarPlanWith({ organisationName: "X", sources: SOURCES, previous: [], count: 9, call: clamp.call });
  assert.equal(clamped.avatars.length, 6);
  console.log("plan: exact count, summaries only: ok");
}

function expectOnly(result: AvatarGeneratorResult, pattern: RegExp, otherAgentNames: string[] = []) {
  const errors = validateAvatarResult(result, { otherAgentNames });
  assert.equal(errors.length, 1, `expected one error for ${pattern}, got ${JSON.stringify(errors)}`);
  assert.match(errors[0]!, pattern);
}

function withPrompt(prompt: string): AvatarGeneratorResult {
  return finished({ promptTemplate: prompt });
}

function testValidationRules() {
  assert.deepEqual(validateAvatarResult(finished(), { otherAgentNames: ["SEO-Berater", "Thomas Krämer"] }), []);
  assert.equal(avatarPromptBlock(VALID_TEMPLATE, "WER DU BIST").startsWith("Du bist Sandra Becker, 46 Jahre alt"), true);

  // 1 starts with the anchor
  expectOnly(withPrompt(`Hier ist der Avatar.\n${VALID_TEMPLATE}`), /beginnt nicht mit „## ANKER/);

  // 2 required headings, in order (others in between are fine, see EMOTIONALE LAGE)
  expectOnly(withPrompt(VALID_TEMPLATE.replace("## DEIN TRAUMZIEL\n", "")), /Pflichtblock fehlt: „## DEIN TRAUMZIEL“/);
  const swapped = VALID_TEMPLATE.replace("## DEINE ALTERNATIVEN", "## TMP").replace("## DEIN ENTSCHEIDUNGSPROZESS", "## DEINE ALTERNATIVEN").replace("## TMP", "## DEIN ENTSCHEIDUNGSPROZESS");
  expectOnly(withPrompt(swapped), /„## DEIN ENTSCHEIDUNGSPROZESS“ steht vor „## DEINE ALTERNATIVEN“|„## DEINE ALTERNATIVEN“ steht vor/);
  assert.equal(AVATAR_REQUIRED_HEADINGS.length, 18);

  // 3 no placeholder
  expectOnly(withPrompt(VALID_TEMPLATE.replace("aus Mülheim an der Ruhr", "aus [Ort / Region]")), /Platzhalter in eckigen Klammern: „\[Ort \/ Region\]“/);

  // 4 no en or em dash
  expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Du bist gereizt – ")), /Gedankenstrich/);
  expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Du bist gereizt — ")), /Gedankenstrich/);

  // 5 no hedge word, whole words only and in any case
  expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Du bist Vermutlich gereizt,")), /Absicherungswort im Text: „vermutlich“/);
  for (const word of ["eventuell", "möglicherweise", "meistens", "manchmal", "unklar"]) {
    expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", `Du bist ${word} gereizt,`)), new RegExp(`„${word}“`));
  }
  assert.deepEqual(
    validateAvatarResult(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Du bist über unklare Angebote gereizt,")), { otherAgentNames: [] }),
    [],
  );

  // 6 exact age in WER DU BIST
  expectOnly(withPrompt(VALID_TEMPLATE.replace("46 Jahre alt", "im mittleren Alter")), /kein exaktes Alter/);

  // 7 no age span
  expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Du wirkst wie Mitte 40 und bist gereizt,")), /Altersspanne statt exaktem Alter: „Mitte 40“/);
  expectOnly(withPrompt(VALID_TEMPLATE.replace("Du bist gereizt,", "Deine Mieter sind 30 bis 40 Jahre alt. Du bist gereizt,")), /Altersspanne statt exaktem Alter: „30 bis 40 Jahre“/);

  // 8 no global rules
  expectOnly(withPrompt(VALID_TEMPLATE.replace("- Tonalität: kurz", "- Antworte ohne Markdown.\n- Tonalität: kurz")), /Globale Regel im Avatar-Teil: „Markdown“/);
  expectOnly(withPrompt(VALID_TEMPLATE.replace("- Tonalität: kurz", "- Keine Emojis.\n- Tonalität: kurz")), /Globale Regel im Avatar-Teil: „Emoji“/);
  expectOnly(withPrompt(VALID_TEMPLATE.replace("- Tonalität: kurz", "- Du schreibst höchstens 2 Sätze.\n- Tonalität: kurz")), /Globale Regel im Avatar-Teil: „2 Sätze“/);
  expectOnly(withPrompt(VALID_TEMPLATE.replace("- Tonalität: kurz", "- Kurze Sätze pro Nachricht.\n- Tonalität: kurz")), /Globale Regel im Avatar-Teil: „Sätze pro Nachricht“/);

  // 9 Quick Actions: 4 to 6, from the employee's view
  expectOnly(finished({}, { quickActions: QUICK_ACTIONS.slice(0, 3) }), /3 Quick Actions statt 4 bis 6/);
  expectOnly(finished({}, { quickActions: [...QUICK_ACTIONS, "A", "B", "C"] }), /7 Quick Actions statt 4 bis 6/);
  for (const persona of ["Ich brauche dringend Hilfe", "Mir ist das zu teuer", "Mich nervt das", "Mein Treppenhaus ist kaputt", "Meine Mieter beschweren sich"]) {
    expectOnly(finished({}, { quickActions: [...QUICK_ACTIONS.slice(0, 3), persona] }), /Quick Action aus Sicht der Persona/);
  }
  assert.deepEqual(
    validateAvatarResult(finished({}, { quickActions: [...QUICK_ACTIONS.slice(0, 3), "Meinung zum Angebot einholen"] }), { otherAgentNames: [] }),
    [],
  );

  // 10 the name is not taken by another agent of the organisation (case-insensitive)
  expectOnly(finished(), /„Sandra Becker“ ist bei dieser Organisation schon vergeben/, ["sandra  BECKER"]);

  // The anchor itself: no en or em dash, so it passes rule 4; the default prompt's Vorlage has it as is.
  assert.equal(/[–—]/.test(AVATAR_GLOBAL_PROMPT_ANCHOR), false);
  assert.deepEqual(validateAvatarResult(withPrompt(VALID_TEMPLATE), { otherAgentNames: [] }), []);
  assert.ok(DEFAULT_AVATAR_GENERATOR_PROMPT.includes(AVATAR_GLOBAL_PROMPT_ANCHOR));
  console.log("validation rules 1-10: ok");
}

function testNormalizeAndPrompt() {
  const questions = normalizeAvatarGeneratorResult({
    status: "rueckfragen",
    rueckfragen: [{ block: "WER DU BIST", frage: "In der Zusammenfassung steht 30 bis 40 Jahre. Soll ich 34 nehmen?", vorschlag: "34" }],
  });
  assert.equal(questions.status, "rueckfragen");
  assert.equal(questions.rueckfragen.length, 1);

  const done = normalizeAvatarGeneratorResult({
    status: "fertig",
    prompt_template: VALID_TEMPLATE,
    avatar_data: { name: " Sandra   Becker ", role: "Inhaberin", icon: "🏢", quick_actions: [...QUICK_ACTIONS, ""] },
    meta: META,
  });
  assert.equal(done.status, "fertig");
  assert.equal(done.avatarData.name, "Sandra Becker");
  assert.deepEqual(done.avatarData.quickActions, QUICK_ACTIONS);
  assert.equal(done.meta?.zusatzbloecke[0], "EMOTIONALE LAGE");
  // „rueckfragen“ without a single question is no Rückfrage.
  assert.equal(normalizeAvatarGeneratorResult({ status: "rueckfragen", rueckfragen: [] }).status, "fertig");

  const schema = AVATAR_GENERATOR_TOOL.input_schema as { properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(schema.properties).sort(), ["avatar_data", "meta", "prompt_template", "rueckfragen", "status"]);

  // The saved prompt, or the default when it is empty; the organisation filled in.
  assert.match(resolveAvatarGeneratorPrompt("", "Malerei Hoffmann"), /^Du bist der Avatar-Generator von DigitalTwin für Malerei Hoffmann\./);
  assert.equal(resolveAvatarGeneratorPrompt(null, "Malerei Hoffmann").includes("{{organisation}}"), false);
  assert.equal(resolveAvatarGeneratorPrompt("Eigener Prompt für {{organisation}}.", "Malerei Hoffmann"), "Eigener Prompt für Malerei Hoffmann.");

  const user = buildAvatarGeneratorUserMessage({
    organisationName: "Malerei Hoffmann",
    avatar: avatar(),
    otherTitles: ["Privatkunden mit Altbau"],
    notWanted: "Großkonzerne",
    existingAgentNames: ["SEO-Berater", "Thomas Krämer"],
    ownAgentName: "Thomas Krämer",
    sources: SOURCES,
    anbieterItems: [{ label: "Unternehmen & Kern", current: "Malerbetrieb aus Mülheim" }],
    antworten: [{ block: "ANREDE", frage: "Du oder Sie?", antwort: "Du" }],
    previousErrors: ["Gedankenstrich im Text („–“ oder „—“)."],
  });
  for (const expected of [
    "Organisation: Malerei Hoffmann",
    "Arbeitstitel: Hausverwaltung mit mehreren Objekten",
    "Abgrenzung: Entscheidet mit dem Beirat.",
    "Drei Flure in Mülheim",
    "- Privatkunden mit Altbau",
    "Großkonzerne",
    "- SEO-Berater",
    "Thomas Krämer (das ist dieser Avatar",
    "Privatkunden mit Altbau.",
    "Malerbetrieb aus Mülheim",
    "Antwort: Du",
    "Gedankenstrich im Text",
  ]) {
    assert.ok(user.includes(expected), `user message misses ${expected}`);
  }
  assert.equal(user.includes("ROHTEXT"), false);
  console.log("normalize, prompt, user message: ok");
}

async function testGenerateCall() {
  const fake = fakeCall([{ status: "fertig", prompt_template: VALID_TEMPLATE, avatar_data: { name: "Sandra Becker", role: "Inhaberin", icon: "🏢", quick_actions: QUICK_ACTIONS }, meta: META }]);
  const out = await generateAvatarWith({ system: "SYSTEM", user: "USER", call: fake.call });
  assert.equal(fake.calls[0]?.tool.name, AVATAR_GENERATOR_TOOL.name);
  assert.equal(fake.calls[0]?.system, "SYSTEM");
  assert.equal(out.result.status, "fertig");
  assert.equal(out.model, "test-model");
  console.log("generate call: ok");
}

type RpcCall = { fn: string; args: Record<string, unknown> };

/** A Supabase stand-in: `dt_agents` rows and the two agent RPCs; `deleted` agents are gone from the database. */
function fakeSupabase(agents: Array<{ id: string; name: string; slug: string | null; kind: string }>, options: { deleted?: string[] } = {}) {
  const calls: RpcCall[] = [];
  const deleted = new Set(options.deleted ?? []);
  const client = {
    from(table: string) {
      const rows =
        table === "dt_agents"
          ? agents.filter((agent) => !deleted.has(agent.id)).map((agent) => ({ ...agent, prompt_append: "", organisation_id: "org" }))
          : [];
      const query = {
        select: () => query,
        eq: () => query,
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "dt_create_persona_agent") return { data: "33333333-3333-4333-8333-333333333333", error: null };
      if (fn === "dt_update_agent" && deleted.has(String(args.p_agent_id))) {
        return { data: null, error: { message: "agent_not_found" } };
      }
      return { data: args.p_agent_id ?? null, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ORG_AGENTS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "SEO-Berater", slug: "seo_advisor", kind: "seo_advisor", avatar_data: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "Thomas Krämer", slug: "thomas", kind: "persona", avatar_data: null },
];

async function testApply() {
  const antworten = [{ block: "ANREDE", frage: "Du oder Sie?", antwort: "Du" }];

  // Rückfragen: nothing is written to Agenten.
  const asking = fakeSupabase(ORG_AGENTS);
  const pending = await applyAvatarGeneratorResult({
    supabase: asking.client,
    organisationId: "org",
    avatar: avatar(),
    result: normalizeAvatarGeneratorResult({ status: "rueckfragen", rueckfragen: [{ block: "WER DU BIST", frage: "Soll ich 46 nehmen?", vorschlag: "46" }] }),
    agents: ORG_AGENTS,
    antworten,
    now: "2026-10-16T10:00:00.000Z",
  });
  assert.equal(asking.calls.length, 0);
  assert.equal(pending.outcome.kind, "rueckfragen");
  assert.equal(pending.avatar.agentId, null);
  assert.equal(pending.avatar.generator?.status, "rueckfragen");
  assert.equal(pending.avatar.generator?.rueckfragen[0]?.vorschlag, "46");
  assert.deepEqual(pending.avatar.generator?.antworten, antworten);

  // A broken rule: nothing written, the errors kept for „Erneut erzeugen“.
  const broken = fakeSupabase(ORG_AGENTS);
  const invalid = await applyAvatarGeneratorResult({
    supabase: broken.client,
    organisationId: "org",
    avatar: avatar(),
    result: finished({ promptTemplate: VALID_TEMPLATE.replace("46 Jahre alt", "Anfang 40") }),
    agents: ORG_AGENTS,
    antworten,
  });
  assert.equal(broken.calls.length, 0);
  assert.equal(invalid.outcome.kind, "invalid");
  assert.equal(invalid.avatar.generator?.status, "fehler");
  assert.ok((invalid.avatar.generator?.errors.length ?? 0) >= 2);
  assert.equal(invalid.avatar.agentId, null);

  // The name of another agent: nothing written.
  const taken = fakeSupabase(ORG_AGENTS);
  const clash = await applyAvatarGeneratorResult({
    supabase: taken.client,
    organisationId: "org",
    avatar: avatar(),
    result: finished({}, { name: "thomas krämer" }),
    agents: ORG_AGENTS,
    antworten,
  });
  assert.equal(taken.calls.length, 0);
  assert.equal(clash.outcome.kind, "invalid");

  // Fertig and valid: exactly one new agent, the generator's Quick Actions, meta only in the plan.
  const creating = fakeSupabase(ORG_AGENTS);
  const created = await applyAvatarGeneratorResult({
    supabase: creating.client,
    organisationId: "org",
    avatar: avatar(),
    result: finished(),
    agents: ORG_AGENTS,
    antworten,
  });
  assert.equal(created.outcome.kind, "created");
  const creates = creating.calls.filter((call) => call.fn === "dt_create_persona_agent");
  assert.equal(creates.length, 1);
  const payload = creates[0]!.args.p_payload as Record<string, unknown>;
  assert.equal(payload.name, "Sandra Becker");
  assert.equal(payload.role, "Inhaberin einer Hausverwaltung");
  assert.equal(payload.uses_global_prompt, true);
  const promptAppend = String(payload.prompt_append);
  assert.ok(promptAppend.startsWith("## ANKER: GLOBALER DIGITALTWIN-PROMPT"));
  assert.equal(promptAppend, VALID_TEMPLATE);
  assert.equal(promptAppend.includes("META-GEHEIM"), false);
  const updates = creating.calls.filter((call) => call.fn === "dt_update_agent");
  assert.equal(updates.length, 1);
  assert.equal(updates[0]!.args.p_agent_id, "33333333-3333-4333-8333-333333333333");
  const patch = updates[0]!.args.p_patch as Record<string, unknown>;
  assert.deepEqual(patch.quick_actions, QUICK_ACTIONS);
  assert.equal(patch.uses_global_prompt, true);
  assert.equal(patch.is_enabled, true);
  assert.equal((patch.avatar_data as Record<string, unknown>).icon, "🏢");
  assert.equal(JSON.stringify(creating.calls).includes("META-GEHEIM"), false);
  assert.equal(created.avatar.agentId, "33333333-3333-4333-8333-333333333333");
  assert.equal(created.avatar.generator?.status, "fertig");
  assert.equal(created.avatar.generator?.meta?.fehlende_daten[0], "META-GEHEIM Budgetgrenze");

  // „Avatar aktualisieren“: the agent this avatar has; its own name is no clash, avatar_data is kept.
  const own = { id: "44444444-4444-4444-8444-444444444444", name: "Sandra Becker", slug: "sandra", kind: "persona" };
  const agents = [...ORG_AGENTS, own];
  const updating = fakeSupabase(agents);
  const updated = await applyAvatarGeneratorResult({
    supabase: updating.client,
    organisationId: "org",
    avatar: avatar({ agentId: own.id }),
    result: finished({}, { icon: "🧾" }),
    agents: agents.map((agent) => ({ ...agent, avatar_data: agent.id === own.id ? { source: "transcript", priority: "A", is_primary: true, icon: "🏢" } : null })),
    antworten,
  });
  assert.equal(updated.outcome.kind, "updated");
  assert.equal(updating.calls.length, 1);
  assert.equal(updating.calls[0]!.fn, "dt_update_agent");
  assert.equal(updating.calls[0]!.args.p_agent_id, own.id);
  const updatePatch = updating.calls[0]!.args.p_patch as Record<string, unknown>;
  assert.equal(updatePatch.name, "Sandra Becker");
  assert.equal(updatePatch.prompt_append, VALID_TEMPLATE);
  assert.deepEqual(updatePatch.quick_actions, QUICK_ACTIONS);
  assert.deepEqual(updatePatch.avatar_data, { source: "transcript", priority: "A", is_primary: true, icon: "🧾" });
  assert.equal(updated.avatar.agentId, own.id);

  // The linked agent was deleted between loading and saving: the update misses, a new one is created.
  const gone = fakeSupabase(agents, { deleted: [own.id] });
  const recreated = await applyAvatarGeneratorResult({
    supabase: gone.client,
    organisationId: "org",
    avatar: avatar({ agentId: own.id }),
    result: finished(),
    agents: agents.map((agent) => ({ ...agent, avatar_data: null })),
    antworten,
  });
  assert.equal(recreated.outcome.kind, "created");
  assert.deepEqual(
    gone.calls.map((call) => call.fn),
    ["dt_update_agent", "dt_create_persona_agent", "dt_update_agent"],
  );
  assert.equal(recreated.avatar.agentId, "33333333-3333-4333-8333-333333333333");
  console.log("apply: Rückfragen write nothing, a valid result creates one agent: ok");
}

async function main() {
  await testPlanCountAndInput();
  testValidationRules();
  testNormalizeAndPrompt();
  await testGenerateCall();
  await testApply();
  console.log("avatar generator: all ok");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
