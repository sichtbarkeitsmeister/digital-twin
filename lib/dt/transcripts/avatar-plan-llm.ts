/**
 * The model calls of the Avatar-Plan: the plan itself and one generator run per avatar. The
 * call to Anthropic is passed in (`workshop-llm.ts` passes the real one), so the rules here
 * are testable with a fake model and without the server-only chat modules.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  AVATAR_GENERATOR_TOOL,
  normalizeAvatarGeneratorResult,
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
  /** Exactly this many avatars (1 to 6). */
  count: number;
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

/**
 * The Avatar-Plan: exactly `count` avatars from the saved summaries (and the Anbieter points);
 * the raw wording is never sent. One retry when the model returns another number.
 */
export async function proposeAvatarPlanWith(input: ProposeAvatarPlanInput): Promise<ProposeAvatarPlanResult> {
  const count = Math.min(AVATAR_PLAN_MAX, Math.max(AVATAR_PLAN_MIN, Math.round(input.count)));
  const call = input.call;
  const tool: Anthropic.Tool = {
    name: "submit_avatar_plan",
    description: `Avatar-Plan mit genau ${count} Avataren.`,
    input_schema: {
      type: "object",
      properties: {
        notWanted: {
          type: "string",
          description: "Wen sie nicht als Kunden wollen. Das wird kein Avatar.",
        },
        hinweis: {
          type: "string",
          description:
            "Nur wenn die Zusammenfassungen weniger klar getrennte Gruppen hergeben als verlangt: kurz, welche Avatare sich überschneiden und warum. Sonst leer.",
        },
        avatars: {
          type: "array",
          minItems: count,
          maxItems: count,
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
  const system = `Du liest die gespeicherten Zusammenfassungen ALLER Gespräche als einen Bestand, von alt nach neu, dazu den Anbieterstand, wenn er mitgeliefert wird. Das ist deine einzige Quelle.
Wird derselbe Punkt später schärfer oder anders gesagt, gilt nur die spätere Aussage. Nichts erfinden.

Du schlägst Avatare vor, legst aber keine Texte an.
Du lieferst genau ${count} ${count === 1 ? "Avatar" : "Avatare"}, nicht mehr und nicht weniger.
Regel für die Aufteilung: Würde das Unternehmen zu zwei Gruppen dieselben Worte sagen? Wenn ja, gehören sie zusammen. Wenn nein, sind es getrennte Avatare.
Geben die Zusammenfassungen weniger klar getrennte Gruppen her als ${count}, lieferst du trotzdem ${count} Avatare: teile die stärkste Gruppe nach einem echten Unterschied aus den Zusammenfassungen (Anlass, Entscheider, Lage) und schreibe in hinweis, welche Avatare sich überschneiden. Sonst bleibt hinweis leer.
Fallbeispiele sind Belege unter dem Avatar, niemals eigene Avatare.
Menschen, die sie nicht als Kunden wollen, gehören nach notWanted.
Schmerz, Traumergebnis, Dringlichkeit, Hürde, Aufwand und Zeit schreibst du hier nicht aus.
Titel sind Arbeitstitel der Zielgruppe, keine Personennamen aus einem einzelnen Fall.
${revision ? "Liegt eine Anweisung bei, passt du Titel, Abgrenzung und Fälle daran an. Die Anzahl bleibt " + count + ". Nichts darüber hinaus erfinden." : ""}`;
  const user = [
    `Organisation: ${input.organisationName}`,
    `Anzahl Avatare: ${count}`,
    "",
    buildSummaryCorpusPrompt(input.sources, input.anbieterItems ?? []),
    revision ? `\n${revision}` : "",
  ].join("\n");

  const usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let json: unknown = null;
  let avatars: WorkshopAvatar[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await call({
      system,
      user:
        attempt === 0
          ? user
          : `${user}\n\nDer letzte Vorschlag hatte ${avatars.length} statt ${count} Avatare. Liefere genau ${count}.`,
      tool,
      maxTokens: 16_384,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model ?? model;
    json = result.json;
    avatars = normalizeAvatarPlan((json as { avatars?: unknown }).avatars, input.previous).slice(0, count);
    if (avatars.length === count) break;
  }
  if (avatars.length !== count) {
    throw new Error(
      `Der Vorschlag hatte ${avatars.length} statt ${count} ${count === 1 ? "Avatar" : "Avatare"}. Bitte erneut vorschlagen.`,
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
