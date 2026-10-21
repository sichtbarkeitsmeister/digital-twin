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
  type WorkshopSource,
  buildCorpusPrompt,
  describeAnbieterStand,
  formatRevisionBlock,
  normalizeAnbieterItems,
} from "@/lib/dt/transcripts/workshop-model";

export type { WorkshopToolCall };

export function workshopFailureMessage(err: unknown, fallback: string): string {
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

const callTool: WorkshopToolCall = async (input) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY fehlt.");
  const anthropic = new Anthropic({ apiKey });
  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: resolveSurveyActionModels(),
    maxTokens: input.maxTokens ?? 16_384,
    timeoutMs: 270_000,
    stream: true,
    system: input.system,
    tools: [input.tool],
    toolChoice: { type: "tool", name: input.tool.name },
    messages: [{ role: "user", content: input.user }],
  });
  if (!result) throw new Error("Kein verfügbares Modell.");
  const usage = sumAnthropicUsage(result.response.usage);
  const json = extractToolUseInput(result.response, input.tool.name);
  if (!json) throw new Error("Die KI-Antwort war unvollständig.");
  if (result.response.stop_reason === "max_tokens") {
    throw new Error(
      "Die KI-Antwort wurde abgeschnitten, bevor alle Angaben drin waren. Bitte erneut auswerten.",
    );
  }
  return { json, usage, model: result.model };
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

export async function evaluateAnbieterCorpus(input: {
  organisationName: string;
  sources: WorkshopSource[];
  instruction?: string;
  currentItems?: AnbieterItem[];
}): Promise<{ items: AnbieterItem[]; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const pointProperties = Object.fromEntries(
    ANBIETER_POINTS.map((point) => [
      point.key,
      {
        type: "string",
        description:
          point.key === "ablauf"
            ? "Ablauf & Mitwirkung. Weg vom ersten Kontakt bis zum spürbaren Ergebnis: Schritte, genannte Dauern, was der Kunde tun muss. Eine zugesagte Nachlieferung bleibt als offener Punkt stehen. Leer nur, wenn der Ablauf nicht beschrieben wurde."
            : `${point.label}. Alle belegten Fakten im Wortlaut der Gespräche, nichts kürzen. Leer nur, wenn niemand dazu etwas gesagt hat.`,
      },
    ]),
  );
  const tool: Anthropic.Tool = {
    name: "submit_anbieter",
    description: "Aktueller Anbieterstand aus allen Gesprächen. Ein Textfeld pro Checklistenpunkt.",
    input_schema: {
      type: "object",
      properties: pointProperties,
      required: ANBIETER_POINTS.map((point) => point.key),
    },
  };
  const revision = formatRevisionBlock(
    input.instruction ?? "",
    describeAnbieterStand(input.currentItems ?? []),
  );
  const user = [
    `Organisation: ${input.organisationName}`,
    "",
    buildCorpusPrompt(input.sources),
    revision ? `\n${revision}` : "",
  ].join("\n");
  const system = `${CORPUS_RULES}

Du füllst die Anbieter-Checkliste direkt in die Felder ${ANBIETER_POINTS.map((point) => point.key).join(", ")}.
Jedes Feld enthält alle belegten Fakten dieses Punkts, nicht nur eine Kurzfassung.
Was niemand gesagt hat, bleibt ein leerer String. Erfundene Fakten sind verboten.
Eine Angabe, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt.
${revision ? "Liegt eine Anweisung bei, setzt du sie an den genannten Punkten um. Eine fehlerhafte Transkription verliert gegen diese Anweisung." : ""}`;
  const first = await callTool({ system, user, tool, maxTokens: 32_000 });
  let items = normalizeAnbieterItems(first.json);
  let usage = first.usage;
  let model = first.model;
  let lastPayload: unknown = first.json;
  if (!items.some((item) => item.current.trim())) {
    const second = await callTool({
      system: `Lies die Gespräche vollständig. Schreibe für jeden dieser Schlüssel den kompletten belegten Text: ${ANBIETER_POINTS.map((point) => point.key).join(", ")}.
Nichts kürzen. Nicht erfinden. Unbelegte Schlüssel bleiben "".`,
      user,
      tool,
      maxTokens: 32_000,
    });
    lastPayload = second.json;
    const secondItems = normalizeAnbieterItems(second.json);
    if (secondItems.some((item) => item.current.trim())) items = secondItems;
    usage = {
      inputTokens: usage.inputTokens + second.usage.inputTokens,
      outputTokens: usage.outputTokens + second.usage.outputTokens,
    };
    model = second.model ?? model;
  }
  if (!items.some((item) => item.current.trim())) {
    throw new Error(
      `Die KI-Antwort enthielt keine auswertbaren Anbieter-Punkte (${anbieterPayloadHint(lastPayload)}). Bitte erneut auswerten.`,
    );
  }
  return { items, usage, model };
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
