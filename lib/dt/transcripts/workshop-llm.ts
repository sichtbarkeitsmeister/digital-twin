import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractToolUseInput,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { generateCheckedMixWith, type CheckedMix, type MixSource } from "@/lib/dt/agents/mix-generator";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { dtChatFailureUserMessage } from "@/lib/dt/anthropic-chat";
import {
  generateCheckedAvatarWith,
  proposeAvatarPlanWith,
  type GenerateAvatarResult,
  type ProposeAvatarPlanInput,
  type ProposeAvatarPlanResult,
  type WorkshopToolCall,
} from "@/lib/dt/transcripts/avatar-plan-llm";
import {
  ANBIETER_POINTS,
  type AnbieterItem,
  type AnbieterPointKey,
  type WorkshopSource,
  buildCorpusPrompt,
  describeAnbieterStand,
  formatRevisionBlock,
  normalizeAnbieterItems,
} from "@/lib/dt/transcripts/workshop-model";

export type { WorkshopToolCall };

export function workshopFailureMessage(err: unknown, fallback: string): string {
  if (err instanceof WorkshopTimeoutError) return err.message;
  const mapped = dtChatFailureUserMessage(err);
  if (mapped !== "KI-Antwort fehlgeschlagen. Bitte erneut versuchen.") return mapped;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

const CORPUS_RULES = `Du liest ALLE Gespräche als einen Bestand, in der Reihenfolge von alt nach neu.
Eine einzelne Stelle ist kein Ergebnis. Das Ergebnis ist, was über alle Gespräche hinweg als Letztes gilt.
Wird derselbe Punkt später schärfer oder anders gesagt, gilt nur die spätere Aussage.
Die frühere Aussage kommt ins Feld earlier, die geltende ins Feld current.
Verschiedene Themen ergänzen sich. Nichts erfinden. Was nicht gesagt wurde, bleibt leer.
Jede konkrete Angabe bleibt erhalten: Namen, Zahlen, Preise, Leistungen, Ausnahmen, Abläufe, Zitate.
Nichts kürzen, nichts weglassen, weil es nebensächlich wirkt. Nichts abschneiden.`;

/** Thrown when the stream was cut by the timeout; the partial tool JSON is never used. */
export const WORKSHOP_TIMEOUT_MESSAGE =
  "Die KI-Antwort wurde wegen Zeitüberschreitung abgebrochen, bevor alle Angaben drin waren. Es wurde nichts gespeichert. Bitte erneut versuchen.";

export class WorkshopTimeoutError extends Error {
  constructor() {
    super(WORKSHOP_TIMEOUT_MESSAGE);
    this.name = "WorkshopTimeoutError";
  }
}

const WORKSHOP_CALL_TIMEOUT_MS = 270_000;

/** Checks one answer of `callAnthropicFirstAvailable`: a cut or truncated answer throws. */
export function readWorkshopToolResult(
  result: { response: Anthropic.Messages.Message; model: string; timedOut?: boolean } | null,
  toolName: string,
): { json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string | null } {
  if (!result) throw new Error("Kein verfügbares Modell.");
  if (result.timedOut) throw new WorkshopTimeoutError();
  const usage = sumAnthropicUsage(result.response.usage);
  const json = extractToolUseInput(result.response, toolName);
  if (!json) throw new Error("Die KI-Antwort war unvollständig.");
  if (result.response.stop_reason === "max_tokens") {
    throw new Error(
      "Die KI-Antwort wurde abgeschnitten, bevor alle Angaben drin waren. Bitte erneut auswerten.",
    );
  }
  return { json, usage, model: result.model };
}

const callTool: WorkshopToolCall = async (input) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY fehlt.");
  const anthropic = new Anthropic({ apiKey });
  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: resolveSurveyActionModels(),
    maxTokens: input.maxTokens ?? 16_384,
    timeoutMs: input.timeoutMs ?? WORKSHOP_CALL_TIMEOUT_MS,
    stream: true,
    system: input.system,
    tools: [input.tool],
    toolChoice: { type: "tool", name: input.tool.name },
    messages: [{ role: "user", content: input.user }],
  });
  return readWorkshopToolResult(result, input.tool.name);
};

export async function summarizeTranscript(input: {
  organisationName: string;
  title: string;
  text: string;
}): Promise<{ summary: string; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const tool: Anthropic.Tool = {
    name: "submit_summary",
    description: "Sachliche Zusammenfassung eines Gesprächs.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Zusammenfassung auf Deutsch, 8–20 Sätze. Nur was gesagt wurde.",
        },
      },
      required: ["summary"],
    },
  };
  const { json, usage, model } = await callTool({
    system:
      "Du fasst ein Kundengespräch für das Projektteam zusammen. Nichts glätten, nichts erfinden. Wörtliche Formulierungen zu Zielgruppe, Angebot und Abgrenzung behalten.",
    user: [`Organisation: ${input.organisationName}`, `Titel: ${input.title}`, "", input.text].join("\n"),
    tool,
  });
  const summary = typeof (json as { summary?: unknown }).summary === "string"
    ? (json as { summary: string }).summary.trim()
    : "";
  if (summary.length < 40) throw new Error("Die Zusammenfassung war zu kurz.");
  return { summary, usage, model };
}

function anbieterPayloadHint(value: unknown): string {
  if (Array.isArray(value)) return `Liste mit ${value.length} Einträgen`;
  if (!value || typeof value !== "object") return typeof value;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 ? `Felder: ${keys.slice(0, 8).join(", ")}` : "leeres Objekt";
}

/**
 * The checklist is asked in three groups (in parallel, same corpus and rules) so that no single
 * answer runs into the timeout on a large corpus. Points still empty after the merge get one
 * more call, if it still fits into the route's time.
 */
export const ANBIETER_GROUPS: readonly (readonly AnbieterPointKey[])[] = [
  ["unternehmen", "gruendung", "leistungen", "ablauf"],
  ["alleinstellung", "wettbewerb", "team", "werte", "beweise"],
  ["sprache", "preis", "kanaele", "ziele"],
];

/** Budget from the start of the evaluation; the rest of the route's 300 s is for loading and saving. */
export const ANBIETER_BUDGET_MS = 280_000;
export const ANBIETER_GROUP_TIMEOUT_MS = 200_000;
export const ANBIETER_REFILL_MAX_MS = 80_000;
/** A refill with less time than this is skipped. */
export const ANBIETER_REFILL_MIN_MS = 20_000;

const REFILL_EMPTY_RULE = "Leer nur, wenn wirklich niemand etwas dazu gesagt hat.";

function anbieterPointDescription(key: AnbieterPointKey, label: string, refill: boolean): string {
  if (key === "ablauf") {
    return refill
      ? `Ablauf & Mitwirkung. Weg vom ersten Kontakt bis zum spürbaren Ergebnis: Schritte, genannte Dauern, was der Kunde tun muss. Eine zugesagte Nachlieferung bleibt als offener Punkt stehen. ${REFILL_EMPTY_RULE}`
      : "Ablauf & Mitwirkung. Weg vom ersten Kontakt bis zum spürbaren Ergebnis: Schritte, genannte Dauern, was der Kunde tun muss. Eine zugesagte Nachlieferung bleibt als offener Punkt stehen. Leer nur, wenn der Ablauf nicht beschrieben wurde.";
  }
  return `${label}. Alle belegten Fakten im Wortlaut der Gespräche, nichts kürzen. ${
    refill ? REFILL_EMPTY_RULE : "Leer nur, wenn niemand dazu etwas gesagt hat."
  }`;
}

function anbieterTool(keys: readonly AnbieterPointKey[], refill: boolean): Anthropic.Tool {
  const points = ANBIETER_POINTS.filter((point) => keys.includes(point.key));
  return {
    name: "submit_anbieter",
    description: "Aktueller Anbieterstand aus allen Gesprächen. Ein Textfeld pro Checklistenpunkt.",
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        points.map((point) => [
          point.key,
          { type: "string", description: anbieterPointDescription(point.key, point.label, refill) },
        ]),
      ),
      required: points.map((point) => point.key),
    },
  };
}

function anbieterRequest(input: {
  organisationName: string;
  corpus: string;
  keys: readonly AnbieterPointKey[];
  instruction: string;
  currentItems: AnbieterItem[];
  refill: boolean;
}): { system: string; user: string; tool: Anthropic.Tool } {
  const revision = formatRevisionBlock(
    input.instruction,
    describeAnbieterStand(input.currentItems.filter((item) => input.keys.includes(item.key))),
  );
  const user = [
    `Organisation: ${input.organisationName}`,
    "",
    input.corpus,
    revision ? `\n${revision}` : "",
  ].join("\n");
  const others = ANBIETER_POINTS.filter((point) => !input.keys.includes(point.key));
  const system = `${CORPUS_RULES}

Du füllst die Anbieter-Checkliste direkt in die Felder ${input.keys.join(", ")}.
Jedes Feld enthält alle belegten Fakten dieses Punkts, nicht nur eine Kurzfassung.
Was niemand gesagt hat, bleibt ein leerer String. Erfundene Fakten sind verboten.
Eine Angabe, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt.
${others.length > 0 ? `Die übrigen Punkte (${others.map((point) => point.label).join(", ")}) füllt ein eigener Durchgang. Angaben, die genau dorthin gehören, lässt du hier weg.\n` : ""}${input.refill ? `${REFILL_EMPTY_RULE}\n` : ""}${revision ? "Liegt eine Anweisung bei, setzt du sie an den genannten Punkten um. Eine fehlerhafte Transkription verliert gegen diese Anweisung." : ""}`;
  return { system, user, tool: anbieterTool(input.keys, input.refill) };
}

/** Only the rows of `keys` from one answer; anything the model put elsewhere is dropped. */
function anbieterRowsFor(json: unknown, keys: readonly AnbieterPointKey[]): AnbieterItem[] {
  return normalizeAnbieterItems(json).filter((item) => keys.includes(item.key));
}

export async function evaluateAnbieterCorpusWith(input: {
  organisationName: string;
  sources: WorkshopSource[];
  instruction?: string;
  currentItems?: AnbieterItem[];
  call: WorkshopToolCall;
  now?: () => number;
}): Promise<{ items: AnbieterItem[]; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const corpus = buildCorpusPrompt(input.sources);
  const instruction = input.instruction ?? "";
  const currentItems = input.currentItems ?? [];
  const request = (keys: readonly AnbieterPointKey[], refill: boolean) =>
    anbieterRequest({ organisationName: input.organisationName, corpus, keys, instruction, currentItems, refill });

  // Any failed group fails the whole evaluation; nothing partial is returned.
  const groups = await Promise.all(
    ANBIETER_GROUPS.map((keys) =>
      input.call({ ...request(keys, false), maxTokens: 32_000, timeoutMs: ANBIETER_GROUP_TIMEOUT_MS }),
    ),
  );
  const usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  for (const group of groups) {
    usage.inputTokens += group.usage.inputTokens;
    usage.outputTokens += group.usage.outputTokens;
    model = model ?? group.model;
  }
  let items = normalizeAnbieterItems(
    groups.flatMap((group, index) => anbieterRowsFor(group.json, ANBIETER_GROUPS[index]!)),
  );
  let lastPayload: unknown = groups.map((group) => group.json);

  const empty = items.filter((item) => !item.current.trim()).map((item) => item.key);
  const left = startedAt + ANBIETER_BUDGET_MS - now();
  const refillTimeout = Math.min(ANBIETER_REFILL_MAX_MS, left);
  if (empty.length > 0 && refillTimeout >= ANBIETER_REFILL_MIN_MS) {
    try {
      const refill = await input.call({ ...request(empty, true), maxTokens: 32_000, timeoutMs: refillTimeout });
      usage.inputTokens += refill.usage.inputTokens;
      usage.outputTokens += refill.usage.outputTokens;
      model = model ?? refill.model;
      lastPayload = refill.json;
      // Only the empty points take the refill; a point that stays empty stays empty.
      const filled = new Map(
        anbieterRowsFor(refill.json, empty)
          .filter((item) => item.current.trim())
          .map((item) => [item.key, item]),
      );
      items = items.map((item) => filled.get(item.key) ?? item);
    } catch (err) {
      // The groups answered completely; a failed refill leaves those points empty.
      console.warn("Anbieter refill failed", err);
    }
  }

  if (!items.some((item) => item.current.trim())) {
    throw new Error(
      `Die KI-Antwort enthielt keine auswertbaren Anbieter-Punkte (${anbieterPayloadHint(lastPayload)}). Bitte erneut auswerten.`,
    );
  }
  return { items, usage, model };
}

export function evaluateAnbieterCorpus(input: {
  organisationName: string;
  sources: WorkshopSource[];
  instruction?: string;
  currentItems?: AnbieterItem[];
}): Promise<{ items: AnbieterItem[]; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  return evaluateAnbieterCorpusWith({ ...input, call: callTool });
}

export function proposeAvatarPlan(input: Omit<ProposeAvatarPlanInput, "call">): Promise<ProposeAvatarPlanResult> {
  return proposeAvatarPlanWith({ ...input, call: callTool });
}

/** A generator run with the rules checked and up to two rounds of fixes; see `generateCheckedAvatarWith`. */
export function generateCheckedAvatar(input: {
  system: string;
  user: string;
  otherAgentNames: readonly string[];
  deadline?: number;
}): Promise<GenerateAvatarResult & { errors: string[]; fixRounds: number }> {
  return generateCheckedAvatarWith({ ...input, call: callTool });
}

/** The Mix under Agenten, on the same helper and models as the avatar generator; see `generateCheckedMixWith`. */
export function generateCheckedMix(input: {
  system: string;
  sources: readonly MixSource[];
  deadline?: number;
}): Promise<CheckedMix> {
  return generateCheckedMixWith({ ...input, call: callTool });
}
