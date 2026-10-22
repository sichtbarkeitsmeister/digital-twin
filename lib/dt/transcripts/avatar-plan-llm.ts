/**
 * The model calls of the Avatar-Plan: the plan itself and one generator run per avatar. The
 * call to Anthropic is passed in (`workshop-llm.ts` passes the real one), so the rules here
 * are testable with a fake model and without the server-only chat modules.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  AVATAR_GENERATOR_TOOL,
  applyAvatarFixes,
  avatarRuleViolationLines,
  normalizeAvatarFixes,
  normalizeAvatarGeneratorResult,
  validateAvatarResult,
  type AvatarGeneratorResult,
} from "@/lib/dt/transcripts/avatar-generator";
import {
  AVATAR_PLAN_MAX,
  AVATAR_PLAN_MIN,
  type AnbieterItem,
  type WorkshopAvatar,
  type WorkshopSource,
  buildSummaryCorpusPrompt,
  describeAvatarStand,
  formatRevisionBlock,
  normalizeAvatarPlan,
} from "@/lib/dt/transcripts/workshop-model";

export type WorkshopToolCall = (input: {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}) => Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string | null }>;

export type ProposeAvatarPlanInput = {
  organisationName: string;
  sources: WorkshopSource[];
  /** The saved Anbieter points; they go along with the summaries when any has text. */
  anbieterItems?: AnbieterItem[];
  previous: WorkshopAvatar[];
  /**
   * Exact count when set (clamped to {@link AVATAR_PLAN_MIN}…{@link AVATAR_PLAN_MAX}).
   * Omit or pass `null` so the model chooses how many clear groups the summaries support.
   */
  count?: number | null;
  instruction?: string;
  notWanted?: string;
  call: WorkshopToolCall;
};

export type ProposeAvatarPlanResult = {
  notWanted: string;
  hinweis: string;
  avatars: WorkshopAvatar[];
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
};

function resolveFixedCount(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.min(AVATAR_PLAN_MAX, Math.max(AVATAR_PLAN_MIN, Math.round(raw)));
}

/**
 * The Avatar-Plan from the saved summaries (and the Anbieter points); the raw wording is never
 * sent. With a fixed `count`, exactly that many avatars; without, the model picks a count in
 * {@link AVATAR_PLAN_MIN}…{@link AVATAR_PLAN_MAX}. One retry when the answer is out of range.
 */
export async function proposeAvatarPlanWith(input: ProposeAvatarPlanInput): Promise<ProposeAvatarPlanResult> {
  const fixedCount = resolveFixedCount(input.count);
  const auto = fixedCount == null;
  const call = input.call;
  const minItems = auto ? AVATAR_PLAN_MIN : fixedCount;
  const maxItems = auto ? AVATAR_PLAN_MAX : fixedCount;
  const tool: Anthropic.Tool = {
    name: "submit_avatar_plan",
    description: auto
      ? `Avatar-Plan mit ${AVATAR_PLAN_MIN} bis ${AVATAR_PLAN_MAX} Avataren (Anzahl nach klar getrennten Gruppen).`
      : `Avatar-Plan mit genau ${fixedCount} Avataren.`,
    input_schema: {
      type: "object",
      properties: {
        notWanted: {
          type: "string",
          description: "Wen sie nicht als Kunden wollen. Das wird kein Avatar.",
        },
        hinweis: {
          type: "string",
          description: auto
            ? "Nur wenn du Gruppen zusammengelegt oder knapper getrennt hast als die Zusammenfassungen hergeben: kurz warum. Sonst leer."
            : "Nur wenn die Zusammenfassungen weniger klar getrennte Gruppen hergeben als verlangt: kurz, welche Avatare sich überschneiden und warum. Sonst leer.",
        },
        avatars: {
          type: "array",
          minItems,
          maxItems,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              whySeparate: { type: "string" },
              cases: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    service: { type: "string" },
                    summary: { type: "string" },
                    quotes: { type: "array", items: { type: "string" } },
                  },
                  required: ["summary"],
                },
              },
            },
            required: ["title", "whySeparate"],
          },
        },
      },
      required: ["avatars", "hinweis"],
    },
  };
  const revision = formatRevisionBlock(
    input.instruction ?? "",
    describeAvatarStand({ notWanted: input.notWanted ?? "", avatars: input.previous }),
  );
  const countRule = auto
    ? `Du wählst die Anzahl selbst: so viele Avatare, wie die Zusammenfassungen klar getrennte Gruppen hergeben, mindestens ${AVATAR_PLAN_MIN}, höchstens ${AVATAR_PLAN_MAX}.
Regel für die Aufteilung: Würde das Unternehmen zu zwei Gruppen dieselben Worte sagen? Wenn ja, gehören sie zusammen. Wenn nein, sind es getrennte Avatare.
Keine künstliche Aufteilung nur um mehr Avatare zu füllen. Lieber weniger klare Gruppen als erzwungene Überschneidungen.
Hinweis bleibt leer, außer du hast bewusst knapper getrennt oder zusammengelegt als die Quellen nahelegen.`
    : `Du lieferst genau ${fixedCount} ${fixedCount === 1 ? "Avatar" : "Avatare"}, nicht mehr und nicht weniger.
Regel für die Aufteilung: Würde das Unternehmen zu zwei Gruppen dieselben Worte sagen? Wenn ja, gehören sie zusammen. Wenn nein, sind es getrennte Avatare.
Geben die Zusammenfassungen weniger klar getrennte Gruppen her als ${fixedCount}, lieferst du trotzdem ${fixedCount} Avatare: teile die stärkste Gruppe nach einem echten Unterschied aus den Zusammenfassungen (Anlass, Entscheider, Lage) und schreibe in hinweis, welche Avatare sich überschneiden. Sonst bleibt hinweis leer.`;
  const revisionLine = revision
    ? auto
      ? "Liegt eine Anweisung bei, passt du Titel, Abgrenzung, Fälle und bei Bedarf die Anzahl daran an (weiterhin innerhalb der erlaubten Spanne). Nichts darüber hinaus erfinden."
      : `Liegt eine Anweisung bei, passt du Titel, Abgrenzung und Fälle daran an. Die Anzahl bleibt ${fixedCount}. Nichts darüber hinaus erfinden.`
    : "";
  const system = `Du liest die gespeicherten Zusammenfassungen ALLER Gespräche als einen Bestand, von alt nach neu, dazu den Anbieterstand, wenn er mitgeliefert wird. Das ist deine einzige Quelle.
Wird derselbe Punkt später schärfer oder anders gesagt, gilt nur die spätere Aussage. Nichts erfinden.

Du schlägst Avatare vor, legst aber keine Texte an.
${countRule}
Fallbeispiele sind Belege unter dem Avatar, niemals eigene Avatare.
Menschen, die sie nicht als Kunden wollen, gehören nach notWanted.
Schmerz, Traumergebnis, Dringlichkeit, Hürde, Aufwand und Zeit schreibst du hier nicht aus.
Titel sind Arbeitstitel der Zielgruppe, keine Personennamen aus einem einzelnen Fall.
${revisionLine}`;
  const user = [
    `Organisation: ${input.organisationName}`,
    auto
      ? `Anzahl Avatare: selbst wählen (${AVATAR_PLAN_MIN}–${AVATAR_PLAN_MAX}, nach klar getrennten Gruppen)`
      : `Anzahl Avatare: ${fixedCount}`,
    "",
    buildSummaryCorpusPrompt(input.sources, input.anbieterItems ?? []),
    revision ? `\n${revision}` : "",
  ].join("\n");

  const usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let json: unknown = null;
  let avatars: WorkshopAvatar[] = [];
  const inRange = (n: number) => n >= AVATAR_PLAN_MIN && n <= AVATAR_PLAN_MAX;
  const ok = (n: number) => (auto ? inRange(n) : n === fixedCount);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await call({
      system,
      user:
        attempt === 0
          ? user
          : auto
            ? `${user}\n\nDer letzte Vorschlag hatte ${avatars.length} Avatare. Liefere zwischen ${AVATAR_PLAN_MIN} und ${AVATAR_PLAN_MAX}, passend zu klar getrennten Gruppen.`
            : `${user}\n\nDer letzte Vorschlag hatte ${avatars.length} statt ${fixedCount} Avatare. Liefere genau ${fixedCount}.`,
      tool,
      maxTokens: 16_384,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model ?? model;
    json = result.json;
    const normalized = normalizeAvatarPlan((json as { avatars?: unknown }).avatars, input.previous);
    avatars = auto ? normalized.slice(0, AVATAR_PLAN_MAX) : normalized.slice(0, fixedCount);
    if (ok(avatars.length)) break;
  }
  if (!ok(avatars.length)) {
    if (auto) {
      throw new Error(
        `Der Vorschlag hatte ${avatars.length} Avatare (erlaubt: ${AVATAR_PLAN_MIN}–${AVATAR_PLAN_MAX}). Bitte erneut vorschlagen.`,
      );
    }
    throw new Error(
      `Der Vorschlag hatte ${avatars.length} statt ${fixedCount} ${fixedCount === 1 ? "Avatar" : "Avatare"}. Bitte erneut vorschlagen.`,
    );
  }
  const record = json as { notWanted?: unknown; hinweis?: unknown };
  return {
    notWanted: typeof record.notWanted === "string" ? record.notWanted.trim().slice(0, 8_000) : "",
    hinweis: typeof record.hinweis === "string" ? record.hinweis.trim().slice(0, 2_000) : "",
    avatars,
    usage,
    model,
  };
}

/**
 * One run of the avatar generator for one avatar of the plan: the saved „Anbieter-Avatare“
 * prompt as system, the summaries and the plan as user message, the ERGEBNIS schema as tool.
 * Returns the normalised result; validation and saving happen in `avatar-generator.ts`.
 */
export type GenerateAvatarResult = {
  result: AvatarGeneratorResult;
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
};

export async function generateAvatarWith(input: {
  system: string;
  user: string;
  call: WorkshopToolCall;
}): Promise<GenerateAvatarResult> {
  const { json, usage, model } = await input.call({
    system: input.system,
    user: input.user,
    tool: AVATAR_GENERATOR_TOOL,
    maxTokens: 32_000,
  });
  return { result: normalizeAvatarGeneratorResult(json), usage, model };
}

/** Targeted corrections for a result that broke a rule; much shorter than a new run. */
export const AVATAR_FIX_TOOL: Anthropic.Tool = {
  name: "submit_avatar_fixes",
  description: "Korrekturen nur an den Stellen, die eine Regel verletzen. Alles andere bleibt.",
  input_schema: {
    type: "object",
    properties: {
      ersetzungen: {
        type: "array",
        items: {
          type: "object",
          properties: {
            alt: {
              type: "string",
              description: "Wörtlich kopierter Ausschnitt aus dem bisherigen Avatar-Text, kurz, aber eindeutig.",
            },
            neu: { type: "string", description: "Der korrigierte Ausschnitt." },
          },
          required: ["alt", "neu"],
        },
      },
      name: { type: "string", description: "Nur wenn der Name gegen eine Regel verstößt: der neue Name. Sonst leer." },
      quick_actions: {
        type: "array",
        items: { type: "string" },
        description: "Nur wenn die Quick Actions gegen eine Regel verstoßen: die vollständige neue Liste. Sonst leer.",
      },
    },
    required: ["ersetzungen"],
  },
};

export function buildAvatarFixMessage(input: { user: string; result: AvatarGeneratorResult; errors: readonly string[] }): string {
  const lines = avatarRuleViolationLines(input.result.promptTemplate);
  return [
    input.user,
    "# Dein letztes Ergebnis wurde nicht gespeichert",
    "## Avatar-Teil",
    input.result.promptTemplate,
    `## Name\n${input.result.avatarData.name || "(leer)"}`,
    `## Quick Actions\n${input.result.avatarData.quickActions.map((action) => `- ${action}`).join("\n") || "(keine)"}`,
    ["## Diese Regeln sind verletzt", ...input.errors.map((error) => `- ${error}`)].join("\n"),
    lines.length > 0 ? ["## Betroffene Zeilen", ...lines.map((line) => `- ${line}`)].join("\n") : "",
    [
      "## Auftrag",
      "Korrigiere nur diese Stellen. Für jede Stelle eine Ersetzung: alt ist ein wörtlich kopierter Ausschnitt aus dem Avatar-Teil oben, neu der korrigierte Ausschnitt.",
      "Ein Absicherungswort ersetzt du durch eine klare Aussage. Ein Platzhalter bekommt die Angabe aus den Quellen oben.",
      "Fehlt ein Pflichtblock, fügst du ihn mit einer Ersetzung an der richtigen Stelle ein.",
      "Name und Quick Actions nur, wenn eine Regel dazu verletzt ist. Alles andere bleibt Wort für Wort.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * One generator run with the check in code: the result is tidied and checked; while a rule is
 * broken and time is left, the model gets the broken lines back and returns only the fixes
 * (at most `maxFixRounds`). Returns the last result and the errors still open (empty when it
 * passes); saving happens in `applyAvatarGeneratorResult`.
 */
export async function generateCheckedAvatarWith(input: {
  system: string;
  user: string;
  call: WorkshopToolCall;
  otherAgentNames: readonly string[];
  maxFixRounds?: number;
  /** No fix round starts after this time (ms since epoch); keeps the request within its limit. */
  deadline?: number;
  now?: () => number;
}): Promise<GenerateAvatarResult & { errors: string[]; fixRounds: number }> {
  const now = input.now ?? Date.now;
  const first = await generateAvatarWith({ system: input.system, user: input.user, call: input.call });
  const usage = { ...first.usage };
  let model = first.model;
  let result = first.result;
  if (result.status === "rueckfragen") return { result, usage, model, errors: [], fixRounds: 0 };

  let errors = validateAvatarResult(result, { otherAgentNames: input.otherAgentNames });
  let fixRounds = 0;
  while (errors.length > 0 && fixRounds < (input.maxFixRounds ?? 2) && (input.deadline == null || now() < input.deadline)) {
    fixRounds += 1;
    const fix = await input.call({
      system: input.system,
      user: buildAvatarFixMessage({ user: input.user, result, errors }),
      tool: AVATAR_FIX_TOOL,
      maxTokens: 8_000,
    });
    usage.inputTokens += fix.usage.inputTokens;
    usage.outputTokens += fix.usage.outputTokens;
    model = fix.model ?? model;
    const fixed = applyAvatarFixes(result, normalizeAvatarFixes(fix.json));
    if (fixed.applied === 0) break;
    result = fixed.result;
    errors = validateAvatarResult(result, { otherAgentNames: input.otherAgentNames });
  }
  return { result, usage, model, errors, fixRounds };
}
