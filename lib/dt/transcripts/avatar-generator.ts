/**
 * Avatar generator of the Transkripte step „Avatar-Plan“: one run per avatar of the approved
 * plan writes the avatar-specific part of its prompt („Anbieter-Avatare“ in Globale Prompte).
 *
 * The model answers with exactly one ERGEBNIS: either Rückfragen (nothing goes to Agenten
 * while they are open) or the finished prompt with avatar_data and meta. Typography the model
 * keeps getting wrong (dashes, a code fence) is fixed in code first; then the prompt is checked
 * against the rules. A broken rule is first handed back to the model as a short list of fixes
 * (`avatar-plan-llm.ts`); if it still fails, nothing is written, the errors and the rejected
 * draft stay with the avatar so the team can correct it or run it again. meta stays in the
 * workshop JSON for the team and never reaches the prompt. Supabase only in
 * `applyAvatarGeneratorResult`, so the rules are testable without it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createConfirmedTranscriptPersonas } from "@/lib/dt/transcripts/apply-knowledge";
import {
  AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING,
  ensureAvatarGlobalPromptAnchor,
} from "@/lib/dt/prompts/avatar-global-prompt-anchor";
import {
  type AnbieterItem,
  type AvatarAntwort,
  type AvatarGeneratorDraft,
  type AvatarGeneratorMeta,
  type AvatarGeneratorState,
  type AvatarRueckfrage,
  type WorkshopAvatar,
  type WorkshopSource,
  buildSummaryCorpusPrompt,
  isMissingAgentError,
  normalizeGeneratorMeta,
  normalizeRueckfragen,
} from "@/lib/dt/transcripts/workshop-model";

/** The blocks every avatar part has, in this order (others may stand in between). */
export const AVATAR_REQUIRED_HEADINGS = [
  "ANKER: GLOBALER DIGITALTWIN-PROMPT",
  "WER DU BIST",
  "DEINE SITUATION UND DER AUSLÖSER",
  "DEIN TRAUMZIEL",
  "WAS DICH BELASTET",
  "WAS DICH VOM ANFRAGEN ABHÄLT",
  "DEINE FRAGEN UND FORMULIERUNGEN",
  "DEINE EINWÄNDE UND BEDENKEN",
  "ZEIT UND EIGENER AUFWAND",
  "WAS DICH ÜBERZEUGT",
  "DEIN ENTSCHEIDUNGSPROZESS",
  "DEINE ALTERNATIVEN",
  "DEINE INFORMATIONSQUELLEN VOR DEM KONTAKT",
  "DEINE KUNDENREISE",
  "NACHBETREUUNG UND WEITEREMPFEHLUNG",
  "BARRIEREN UND HERAUSFORDERUNGEN",
  "DEINE SPRACHE",
  "DEIN NÄCHSTER SCHRITT",
] as const;

export const AVATAR_HEDGE_WORDS = [
  "vermutlich",
  "eventuell",
  "möglicherweise",
  "meistens",
  "manchmal",
  "unklar",
] as const;

export const AVATAR_QUICK_ACTIONS_MIN = 4;
export const AVATAR_QUICK_ACTIONS_MAX = 6;

export type AvatarGeneratorData = {
  name: string;
  role: string;
  icon: string;
  quickActions: string[];
};

export type AvatarGeneratorResult = {
  status: "rueckfragen" | "fertig";
  rueckfragen: AvatarRueckfrage[];
  promptTemplate: string;
  avatarData: AvatarGeneratorData;
  meta: AvatarGeneratorMeta | null;
};

/** The ERGEBNIS of the default prompt as a tool. */
export const AVATAR_GENERATOR_TOOL: Anthropic.Tool = {
  name: "submit_avatar_result",
  description:
    "Genau ein Ergebnis: status „rueckfragen“ mit der Liste rueckfragen, oder status „fertig“ mit prompt_template, avatar_data und meta.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["rueckfragen", "fertig"] },
      rueckfragen: {
        type: "array",
        description: "Nur bei status „rueckfragen“: alle Rückfragen gesammelt, jede kurz und mit einem konkreten Vorschlag.",
        items: {
          type: "object",
          properties: {
            block: { type: "string", description: "Der Block, zu dem die Frage gehört, z. B. WER DU BIST." },
            frage: { type: "string" },
            vorschlag: { type: "string" },
          },
          required: ["block", "frage", "vorschlag"],
        },
      },
      prompt_template: {
        type: "string",
        description: "Nur bei status „fertig“: der Avatar-Teil als Markdown, beginnend mit ## ANKER: GLOBALER DIGITALTWIN-PROMPT.",
      },
      avatar_data: {
        type: "object",
        description: "Nur bei status „fertig“.",
        properties: {
          name: { type: "string", description: "Vorname und Nachname, bei dieser Organisation noch nicht vergeben." },
          role: { type: "string", description: "Höchstens sechs Wörter." },
          icon: { type: "string", description: "Ein Emoji." },
          quick_actions: {
            type: "array",
            minItems: AVATAR_QUICK_ACTIONS_MIN,
            maxItems: AVATAR_QUICK_ACTIONS_MAX,
            items: { type: "string" },
            description: "4 bis 6, aus Sicht des Mitarbeiters. Keine beginnt mit Ich, Mir, Mich oder Mein.",
          },
        },
        required: ["name", "role", "icon", "quick_actions"],
      },
      meta: {
        type: "object",
        description: "Nur bei status „fertig“. Sieht nur das Team, nie der Avatar.",
        properties: {
          abgeleitet: {
            type: "array",
            items: {
              type: "object",
              properties: {
                block: { type: "string" },
                aussage: { type: "string" },
                grund: { type: "string" },
              },
              required: ["block", "aussage", "grund"],
            },
          },
          fehlende_daten: { type: "array", items: { type: "string" } },
          zusatzbloecke: { type: "array", items: { type: "string" } },
          offene_fragen: { type: "array", items: { type: "string" } },
        },
        required: ["abgeleitet", "fehlende_daten", "zusatzbloecke", "offene_fragen"],
      },
    },
    required: ["status"],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeAvatarGeneratorResult(raw: unknown): AvatarGeneratorResult {
  const record = asRecord(raw) ?? {};
  const data = asRecord(record.avatar_data ?? record.avatarData) ?? {};
  const rueckfragen = normalizeRueckfragen(record.rueckfragen);
  const promptTemplate = tidyAvatarPromptTemplate(text(record.prompt_template ?? record.promptTemplate, 60_000));
  const quick = data.quick_actions ?? data.quickActions;
  const status: AvatarGeneratorResult["status"] =
    record.status === "rueckfragen" && rueckfragen.length > 0
      ? "rueckfragen"
      : record.status === "fertig" || promptTemplate || rueckfragen.length === 0
        ? "fertig"
        : "rueckfragen";
  return {
    status,
    rueckfragen: status === "rueckfragen" ? rueckfragen : [],
    promptTemplate,
    avatarData: {
      name: text(data.name, 80).replace(/\s+/g, " "),
      role: text(data.role, 200),
      icon: text(data.icon, 16),
      quickActions: Array.isArray(quick) ? quick.map((item) => text(item, 160)).filter(Boolean).slice(0, 12) : [],
    },
    meta: normalizeGeneratorMeta(record.meta),
  };
}

/**
 * Typography fixed in code before the rules are checked, so a stray character does not cost a
 * whole new run: a code fence around the text and anything before the anchor heading go, a
 * dash between numbers becomes „bis“, a dash used as a pause becomes a comma, a dash as list
 * marker or inside a word a hyphen. Idempotent.
 */
export function tidyAvatarPromptTemplate(value: string): string {
  let out = value.replace(/\r\n/g, "\n").trim();
  const fenced = out.match(/^```[\w-]*[ \t]*\n([\s\S]*?)\n?```$/);
  if (fenced) out = (fenced[1] ?? "").trim();
  const anchor = out.search(/^[ \t]*##[ \t]*ANKER:/m);
  if (anchor > 0) out = out.slice(anchor).trim();
  return out
    .replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, "$1 bis $2")
    .replace(/^([ \t]*)[–—](?=[ \t])/gm, "$1-")
    .replace(/[ \t]+[–—][ \t]*$/gm, "")
    .replace(/[ \t]+[–—][ \t]+/g, ", ")
    .replace(/[–—]/g, "-")
    .replace(/,[ \t]*([,.!?;:])/g, "$1");
}

function headingKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleUpperCase("de-DE");
}

/** The `## ` headings of the text, in order. */
export function avatarPromptHeadings(prompt: string): string[] {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*##\s+(.+?)\s*$/)?.[1] ?? null)
    .filter((heading): heading is string => Boolean(heading))
    .map(headingKey);
}

/** The text under a `## ` heading, up to the next heading. */
export function avatarPromptBlock(prompt: string, heading: string): string {
  const want = headingKey(heading);
  const lines = prompt.split(/\r?\n/);
  const start = lines.findIndex((line) => headingKey(line.match(/^\s*##\s+(.+?)\s*$/)?.[1] ?? "") === want);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*##\s+/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

const PLACEHOLDER_RE = /\[[^\]]+\]/g;
const DASH_RE = /[–—]/;
const HEDGE_RE = new RegExp(`(?<![\\p{L}\\p{N}_])(${AVATAR_HEDGE_WORDS.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
const EXACT_AGE_RE = /(?<!\d)\d{2}\s+Jahre(?!\p{L})/u;
const AGE_SPAN_RES = [
  /(?<!\p{L})(?:Anfang|Mitte|Ende)\s+(?:der\s+)?\d{2}(?!\d)/u,
  /(?<!\d)\d{2}\s*(?:bis|-)\s*\d{2}(?!\d)\s*Jahre/u,
];
// „Sätze“ next to a digit is the global length rule („höchstens 3 Sätze“); „in zwei Sätzen
// erklärt bekommen“ describes the avatar and stays.
const GLOBAL_RULE_RES: Array<{ re: RegExp; label: string }> = [
  { re: /markdown/i, label: "Markdown" },
  { re: /emoji/i, label: "Emoji" },
  { re: /(?<!\d)\d+\s*Sätzen?(?!\p{L})/iu, label: "Satzanzahl" },
  { re: /(?<!\p{L})Sätzen?\s*[:(]?\s*\d+(?!\d)/iu, label: "Satzanzahl" },
  { re: /(?<!\p{L})Sätzen?\s+pro\s+(?:Antwort|Nachricht)/iu, label: "Sätze pro Antwort" },
];
const PERSONA_START_RE = /^[\s"'„“‚‘»«(]*(ich|mir|mich|mein|meine|meinen|meinem|meiner|meines)(?!\p{L})/iu;

function quoted(value: string): string {
  return `„${value.length > 80 ? `${value.slice(0, 79)}…` : value}“`;
}

/** The line around a match, at most 100 characters, so the team (and a fix) finds the spot. */
function excerptAt(prompt: string, index: number, length: number): string {
  const start = prompt.lastIndexOf("\n", index) + 1;
  const endBreak = prompt.indexOf("\n", index + length);
  const line = prompt.slice(start, endBreak < 0 ? prompt.length : endBreak).trim();
  if (line.length <= 100) return `„${line}“`;
  const at = Math.max(0, index - start - 40);
  const cut = line.slice(at, at + 100).trim();
  return `„${at > 0 ? "…" : ""}${cut}${at + 100 < line.length ? "…" : ""}“`;
}

function nameKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("de-DE");
}

/**
 * The rules a finished avatar part must pass before it is saved. Returns the errors in
 * German, one per broken rule (empty when everything holds).
 *  1 starts with the anchor heading
 *  2 the required headings in their order
 *  3 no placeholder in brackets
 *  4 no „–“ or „—“
 *  5 no hedge word (vermutlich, eventuell, möglicherweise, meistens, manchmal, unklar)
 *  6 WER DU BIST names an exact age („34 Jahre“)
 *  7 no age span („Mitte 40“, „30 bis 40 Jahre“)
 *  8 no global rule (Markdown, Emojis, number of sentences)
 *  9 4 to 6 Quick Actions, none from the persona's view (Ich, Mir, Mich, Mein)
 * 10 the name is not taken by another agent of the organisation
 */
export function validateAvatarResult(
  result: Pick<AvatarGeneratorResult, "promptTemplate" | "avatarData">,
  context: { otherAgentNames: readonly string[] },
): string[] {
  const errors: string[] = [];
  const prompt = result.promptTemplate.trim();
  if (!prompt) return ["Die KI hat keinen Avatar-Text (prompt_template) geliefert."];

  // 1
  if (!prompt.startsWith(AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING)) {
    errors.push(`Der Avatar-Text beginnt nicht mit „${AVATAR_GLOBAL_PROMPT_ANCHOR_HEADING}“.`);
  }

  // 2
  const headings = avatarPromptHeadings(prompt);
  let lastFound: { heading: string; index: number } | null = null;
  for (const required of AVATAR_REQUIRED_HEADINGS) {
    const index = headings.indexOf(headingKey(required));
    if (index < 0) {
      errors.push(`Pflichtblock fehlt: „## ${required}“.`);
      continue;
    }
    if (lastFound && index < lastFound.index) {
      errors.push(`„## ${required}“ steht vor „## ${lastFound.heading}“. Die Reihenfolge der Pflichtblöcke ist fest.`);
    }
    lastFound = { heading: required, index };
  }

  // 3
  const placeholders = [...new Set(prompt.match(PLACEHOLDER_RE) ?? [])];
  if (placeholders.length > 0) {
    errors.push(`Platzhalter in eckigen Klammern: ${placeholders.slice(0, 5).map(quoted).join(", ")}${placeholders.length > 5 ? " …" : ""}.`);
  }

  // 4
  if (DASH_RE.test(prompt)) errors.push("Gedankenstrich im Text („–“ oder „—“).");

  // 5
  const hedgeMatches = [...prompt.matchAll(HEDGE_RE)];
  const hedges = [...new Set(hedgeMatches.map((match) => match[1]!.toLocaleLowerCase("de-DE")))];
  if (hedges.length > 0) {
    const first = hedgeMatches[0]!;
    errors.push(
      `Absicherungswort im Text: ${hedges.map(quoted).join(", ")}, zum Beispiel in ${excerptAt(prompt, first.index ?? 0, first[0].length)}.`,
    );
  }

  // 6
  const whoBlock = avatarPromptBlock(prompt, "WER DU BIST");
  if (whoBlock && !EXACT_AGE_RE.test(whoBlock)) {
    errors.push("„## WER DU BIST“ nennt kein exaktes Alter (zum Beispiel „34 Jahre“).");
  }

  // 7
  for (const re of AGE_SPAN_RES) {
    const span = prompt.match(re)?.[0];
    if (span) errors.push(`Altersspanne statt exaktem Alter: ${quoted(span)}.`);
  }

  // 8
  const globalRules = new Map<string, RegExpMatchArray>();
  for (const { re, label } of GLOBAL_RULE_RES) {
    const found = prompt.match(re);
    if (found && !globalRules.has(label)) globalRules.set(label, found);
  }
  for (const found of globalRules.values()) {
    errors.push(
      `Globale Regel im Avatar-Teil: ${quoted(found[0])} in ${excerptAt(prompt, found.index ?? 0, found[0].length)}. Das steht nur im globalen Prompt.`,
    );
  }

  // 9
  const actions = result.avatarData.quickActions;
  if (actions.length < AVATAR_QUICK_ACTIONS_MIN || actions.length > AVATAR_QUICK_ACTIONS_MAX) {
    errors.push(`${actions.length} Quick Actions statt ${AVATAR_QUICK_ACTIONS_MIN} bis ${AVATAR_QUICK_ACTIONS_MAX}.`);
  }
  for (const action of actions) {
    if (PERSONA_START_RE.test(action)) {
      errors.push(`Quick Action aus Sicht der Persona: ${quoted(action)}. Quick Actions sind aus Sicht des Mitarbeiters.`);
    }
  }

  // 10
  const name = result.avatarData.name.trim();
  if (!name) {
    errors.push("Der Avatar hat keinen Namen (avatar_data.name).");
  } else if (context.otherAgentNames.some((other) => nameKey(other) === nameKey(name))) {
    errors.push(`Der Name ${quoted(name)} ist bei dieser Organisation schon vergeben.`);
  }

  return errors;
}

/** The lines of the text that break a rule about wording, so a fix can name them exactly. */
export function avatarRuleViolationLines(prompt: string): string[] {
  const checks: RegExp[] = [
    PLACEHOLDER_RE,
    DASH_RE,
    HEDGE_RE,
    ...AGE_SPAN_RES,
    ...GLOBAL_RULE_RES.map((rule) => rule.re),
  ];
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      checks.some((re) => {
        re.lastIndex = 0;
        const hit = re.test(line);
        re.lastIndex = 0;
        return hit;
      }),
    );
  return [...new Set(lines)].slice(0, 40);
}

/** Targeted corrections for a result that broke a rule. */
export type AvatarFixes = {
  ersetzungen: Array<{ alt: string; neu: string }>;
  name: string;
  quickActions: string[];
};

export function normalizeAvatarFixes(raw: unknown): AvatarFixes {
  const record = asRecord(raw) ?? {};
  const rows = Array.isArray(record.ersetzungen) ? record.ersetzungen : [];
  const ersetzungen = rows
    .map((row) => {
      const item = asRecord(row);
      const alt = typeof item?.alt === "string" ? item.alt : "";
      const neu = typeof item?.neu === "string" ? item.neu : "";
      return alt.trim() ? { alt, neu } : null;
    })
    .filter((row): row is { alt: string; neu: string } => Boolean(row))
    .slice(0, 80);
  const quick = Array.isArray(record.quick_actions) ? record.quick_actions : [];
  return {
    ersetzungen,
    name: text(record.name, 80).replace(/\s+/g, " "),
    quickActions: quick.map((item) => text(item, 160)).filter(Boolean).slice(0, 12),
  };
}

/**
 * Applies the corrections: each `alt` that occurs in the text is replaced everywhere (also
 * with surrounding spaces trimmed when the exact snippet is not there); an `alt` that is not
 * in the text is skipped. Name and Quick Actions are replaced only when the fix brings them.
 */
export function applyAvatarFixes(
  result: AvatarGeneratorResult,
  fixes: AvatarFixes,
): { result: AvatarGeneratorResult; applied: number } {
  let prompt = result.promptTemplate;
  let applied = 0;
  for (const { alt, neu } of fixes.ersetzungen) {
    const needle = prompt.includes(alt) ? alt : prompt.includes(alt.trim()) ? alt.trim() : null;
    if (!needle) continue;
    prompt = prompt.split(needle).join(needle === alt ? neu : neu.trim());
    applied += 1;
  }
  return {
    result: {
      ...result,
      promptTemplate: tidyAvatarPromptTemplate(prompt),
      avatarData: {
        ...result.avatarData,
        name: fixes.name || result.avatarData.name,
        quickActions: fixes.quickActions.length > 0 ? fixes.quickActions : result.avatarData.quickActions,
      },
    },
    applied: applied + (fixes.name ? 1 : 0) + (fixes.quickActions.length > 0 ? 1 : 0),
  };
}

/** The names a new or updated avatar must not take: every other agent of the organisation. */
export function otherAgentNamesFor(agents: readonly OrgAgentRow[], ownAgentId: string | null): string[] {
  return agents.filter((agent) => agent.id !== ownAgentId).map((agent) => agent.name);
}

/** The rules checked in code, told to the generator up front so the first result passes. */
const CHECKED_RULES = [
  "Der Text beginnt mit „## ANKER: GLOBALER DIGITALTWIN-PROMPT“, die Pflichtblöcke stehen in der festen Reihenfolge.",
  "Kein Platzhalter in eckigen Klammern.",
  "Kein Gedankenstrich („–“ oder „—“). Statt eines Gedankenstrichs ein Komma, einen Punkt oder „bis“.",
  `Nie diese Wörter: ${AVATAR_HEDGE_WORDS.join(", ")}.`,
  "„## WER DU BIST“ nennt ein exaktes Alter wie „34 Jahre“, keine Spanne wie „Mitte 40“ oder „30 bis 40 Jahre“.",
  "Keine globalen Regeln: nicht Markdown, nicht Emojis, keine Satzanzahl wie „3 Sätze“ oder „Sätze pro Antwort“.",
  "4 bis 6 Quick Actions aus Sicht des Mitarbeiters, keine beginnt mit Ich, Mir, Mich oder Mein.",
  "Der Name ist bei dieser Organisation noch nicht vergeben.",
];

/** Everything the generator gets besides its system prompt. */
export function buildAvatarGeneratorUserMessage(input: {
  organisationName: string;
  avatar: Pick<WorkshopAvatar, "title" | "whySeparate" | "cases">;
  otherTitles: readonly string[];
  notWanted: string;
  existingAgentNames: readonly string[];
  /** Name of the agent this run updates; it may keep that name. */
  ownAgentName?: string | null;
  sources: WorkshopSource[];
  anbieterItems: Array<Pick<AnbieterItem, "label" | "current">>;
  antworten: readonly AvatarAntwort[];
  previousErrors?: readonly string[];
}): string {
  const cases = input.avatar.cases.map((item) => {
    const head = `- ${item.service ? `${item.service}: ` : ""}${item.summary}`;
    return [head, ...item.quotes.map((quote) => `  "${quote}"`)].join("\n");
  });
  const own = input.ownAgentName ? nameKey(input.ownAgentName) : null;
  const names = input.existingAgentNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (own && nameKey(name) === own ? `- ${name} (das ist dieser Avatar, er darf seinen Namen behalten)` : `- ${name}`));
  const sections = [
    `Organisation: ${input.organisationName}`,
    [
      "# Dieser Avatar (aus dem freigegebenen Avatar-Plan)",
      `Arbeitstitel: ${input.avatar.title}`,
      input.avatar.whySeparate.trim() ? `Abgrenzung: ${input.avatar.whySeparate.trim()}` : "",
      cases.length > 0 ? `Fälle:\n${cases.join("\n")}` : "Fälle: keine",
    ]
      .filter(Boolean)
      .join("\n"),
    ["# Die anderen Avatare im Plan", input.otherTitles.length > 0 ? input.otherTitles.map((title) => `- ${title}`).join("\n") : "Keine."].join("\n"),
    ["# Nicht als Kunden gewollt", input.notWanted.trim() || "Nichts festgehalten."].join("\n"),
    ["# Avatare und Agenten, die es bei dieser Organisation schon gibt (Namen nicht erneut vergeben)", names.length > 0 ? names.join("\n") : "Keine."].join("\n"),
    buildSummaryCorpusPrompt(input.sources, input.anbieterItems),
    input.antworten.length > 0
      ? [
          "# Antworten der prüfenden Person auf deine Rückfragen (sie gelten vor den Zusammenfassungen)",
          ...input.antworten.map((item) => `- ${item.block ? `${item.block}: ` : ""}${item.frage}\n  Antwort: ${item.antwort}`),
        ].join("\n")
      : "",
    ["# Diese Regeln prüft das System vor dem Speichern. Ein Verstoß wird nicht gespeichert.", ...CHECKED_RULES.map((rule) => `- ${rule}`)].join("\n"),
    input.previousErrors && input.previousErrors.length > 0
      ? [
          "# Das letzte Ergebnis wurde nicht gespeichert. Diese Regeln waren verletzt, behebe sie:",
          ...input.previousErrors.map((error) => `- ${error}`),
        ].join("\n")
      : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

export type OrgAgentRow = { id: string; name: string; avatar_data: unknown };

export type AvatarGeneratorOutcome =
  | { kind: "rueckfragen" }
  | { kind: "invalid"; errors: string[] }
  | { kind: "created"; agentId: string }
  | { kind: "updated"; agentId: string };

function generatorState(
  avatar: WorkshopAvatar,
  patch: Pick<AvatarGeneratorState, "status"> & Partial<AvatarGeneratorState>,
  antworten: AvatarAntwort[],
  now: string,
): AvatarGeneratorState {
  return {
    rueckfragen: [],
    errors: [],
    draft: null,
    // The meta of the text that is in Agenten stays until a new text replaces it.
    meta: avatar.generator?.meta ?? null,
    ...patch,
    antworten,
    updatedAt: now,
  };
}

/**
 * Applies one generator result to one avatar of the plan. Rückfragen and a result that fails
 * a rule write nothing to Agenten; a valid result creates the agent (or updates the one this
 * avatar already has). Returns the avatar with its new generator state and agent link; the
 * caller stores it in the plan.
 */
export async function applyAvatarGeneratorResult(input: {
  supabase: SupabaseClient;
  organisationId: string;
  avatar: WorkshopAvatar;
  result: AvatarGeneratorResult;
  /** Every dt_agents row of the organisation. */
  agents: readonly OrgAgentRow[];
  antworten: AvatarAntwort[];
  now?: string;
}): Promise<{ avatar: WorkshopAvatar; outcome: AvatarGeneratorOutcome }> {
  const now = input.now ?? new Date().toISOString();
  const { avatar, antworten } = input;
  const result: AvatarGeneratorResult = {
    ...input.result,
    promptTemplate: tidyAvatarPromptTemplate(input.result.promptTemplate),
  };
  const draft: AvatarGeneratorDraft = {
    promptTemplate: result.promptTemplate,
    name: result.avatarData.name,
    role: result.avatarData.role,
    icon: result.avatarData.icon,
    quickActions: result.avatarData.quickActions,
    meta: result.meta,
  };
  const fail = (errors: string[]) => ({
    avatar: {
      ...avatar,
      generator: generatorState(avatar, { status: "fehler", errors, draft: draft.promptTemplate ? draft : null }, antworten, now),
    },
    outcome: { kind: "invalid", errors } as AvatarGeneratorOutcome,
  });

  if (result.status === "rueckfragen") {
    return {
      avatar: {
        ...avatar,
        generator: generatorState(avatar, { status: "rueckfragen", rueckfragen: result.rueckfragen }, antworten, now),
      },
      outcome: { kind: "rueckfragen" },
    };
  }

  const existing = avatar.agentId ? (input.agents.find((agent) => agent.id === avatar.agentId) ?? null) : null;
  const errors = validateAvatarResult(result, {
    otherAgentNames: otherAgentNamesFor(input.agents, existing?.id ?? null),
  });
  if (errors.length > 0) return fail(errors);

  const data = result.avatarData;
  const promptAppend = ensureAvatarGlobalPromptAnchor(result.promptTemplate);
  const done = (agentId: string, kind: "created" | "updated") => ({
    avatar: {
      ...avatar,
      agentId,
      generator: generatorState(avatar, { status: "fertig", meta: result.meta }, antworten, now),
    },
    outcome: { kind, agentId } as AvatarGeneratorOutcome,
  });

  if (existing) {
    const previousData = asRecord(existing.avatar_data) ?? {};
    const { error } = await input.supabase.rpc("dt_update_agent", {
      p_agent_id: existing.id,
      p_patch: {
        name: data.name,
        role: data.role,
        prompt_append: promptAppend,
        quick_actions: data.quickActions,
        avatar_data: { ...previousData, ...(data.icon ? { icon: data.icon } : {}) },
        uses_global_prompt: true,
        is_enabled: true,
      },
    });
    if (!error) return done(existing.id, "updated");
    if (!isMissingAgentError(error.message)) return fail([`Avatar konnte nicht gespeichert werden: ${error.message}`]);
  }

  const created = await createConfirmedTranscriptPersonas({
    supabase: input.supabase,
    organisationId: input.organisationId,
    names: [data.name],
    personas: [
      {
        name: data.name,
        role: data.role || null,
        priority: "A",
        isPrimary: true,
        description: avatar.title,
        goals: null,
        pains: null,
        objections: null,
        language: null,
        buyingTriggers: null,
        promptAppend,
      },
    ],
  });
  const agentId = created.createdPersonaIds[0];
  if (!agentId) return fail([created.warnings[0] ?? "Avatar konnte nicht angelegt werden."]);

  const { error } = await input.supabase.rpc("dt_update_agent", {
    p_agent_id: agentId,
    p_patch: {
      quick_actions: data.quickActions,
      avatar_data: {
        source: "transcript",
        priority: "A",
        is_primary: true,
        ...(data.icon ? { icon: data.icon } : {}),
      },
      uses_global_prompt: true,
      is_enabled: true,
    },
  });
  if (error) {
    // The agent exists; keep the link so „Avatar aktualisieren“ can finish it.
    return {
      avatar: {
        ...avatar,
        agentId,
        generator: generatorState(
          avatar,
          { status: "fehler", meta: result.meta, errors: [`Avatar angelegt, Quick Actions nicht gespeichert: ${error.message}`] },
          antworten,
          now,
        ),
      },
      outcome: { kind: "invalid", errors: [`Avatar angelegt, Quick Actions nicht gespeichert: ${error.message}`] },
    };
  }
  return done(agentId, "created");
}
