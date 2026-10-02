import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractToolUseInput,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { dtChatFailureUserMessage } from "@/lib/dt/anthropic-chat";
import {
  ANBIETER_POINTS,
  type AnbieterItem,
  type WorkshopAvatar,
  type WorkshopSource,
  buildCorpusPrompt,
  normalizeAnbieterItems,
  normalizeAvatarPlan,
  normalizeDossier,
  normalizePreview,
} from "@/lib/dt/transcripts/workshop-model";

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

async function callTool(input: {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
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
}

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
}): Promise<{ items: AnbieterItem[]; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const pointProperties = Object.fromEntries(
    ANBIETER_POINTS.map((point) => [
      point.key,
      {
        type: "string",
        description: `${point.label}. Alle belegten Fakten im Wortlaut der Gespräche, nichts kürzen. Leer nur, wenn niemand dazu etwas gesagt hat.`,
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
  const user = [`Organisation: ${input.organisationName}`, "", buildCorpusPrompt(input.sources)].join("\n");
  const system = `${CORPUS_RULES}

Du füllst die Anbieter-Checkliste direkt in die Felder ${ANBIETER_POINTS.map((point) => point.key).join(", ")}.
Jedes Feld enthält alle belegten Fakten dieses Punkts, nicht nur eine Kurzfassung.
Was niemand gesagt hat, bleibt ein leerer String. Erfundene Fakten sind verboten.
Eine Angabe, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt.`;
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

export async function proposeAvatarPlan(input: {
  organisationName: string;
  sources: WorkshopSource[];
  previous: WorkshopAvatar[];
}): Promise<{
  notWanted: string;
  avatars: WorkshopAvatar[];
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
}> {
  const tool: Anthropic.Tool = {
    name: "submit_avatar_plan",
    description: "Vorschlag, wie viele Avatare der Bestand braucht.",
    input_schema: {
      type: "object",
      properties: {
        notWanted: {
          type: "string",
          description: "Wen sie nicht als Kunden wollen. Das wird kein Avatar.",
        },
        avatars: {
          type: "array",
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
      required: ["avatars"],
    },
  };
  const { json, usage, model } = await callTool({
    system: `${CORPUS_RULES}

Du schlägst Avatare vor, legst aber keine Texte an.
Regel: Würde das Unternehmen zu beiden Gruppen dieselben Worte sagen? Wenn ja, ein Avatar. Wenn nein, getrennte Avatare.
Fallbeispiele sind Belege unter dem Avatar, niemals eigene Avatare.
Menschen, die sie nicht als Kunden wollen, gehören nach notWanted.
Höchstens sechs Avatare. Titel sind Arbeitstitel der Zielgruppe, keine Personennamen aus einem einzelnen Fall.`,
    user: [`Organisation: ${input.organisationName}`, "", buildCorpusPrompt(input.sources)].join("\n"),
    tool,
    maxTokens: 16_384,
  });
  const record = json as { notWanted?: unknown; avatars?: unknown };
  return {
    notWanted: typeof record.notWanted === "string" ? record.notWanted.trim().slice(0, 8_000) : "",
    avatars: normalizeAvatarPlan(record.avatars, input.previous),
    usage,
    model,
  };
}

export async function buildAvatarDossier(input: {
  organisationName: string;
  sources: WorkshopSource[];
  avatar: WorkshopAvatar;
}): Promise<{ dossier: NonNullable<WorkshopAvatar["dossier"]>; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const tool: Anthropic.Tool = {
    name: "submit_dossier",
    description: "Akte eines Avatars aus dem Gesamtbestand.",
    input_schema: {
      type: "object",
      properties: {
        narrative: { type: "string" },
        pains: { type: "string" },
        outcome: { type: "string" },
        quotes: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
      },
      required: ["narrative"],
    },
  };
  const { json, usage, model } = await callTool({
    system: `${CORPUS_RULES}

Du schreibst die Akte für genau einen Avatar. Nur Belege, die zu diesem Titel gehören.
Jede dazu gehörende Angabe und jedes wörtliche Zitat gehören in die Akte. Nichts kürzen.
quotes sind wörtliche Sätze aus dem Wortlaut. gaps sind Punkte, die für diesen Avatar noch nicht belegt sind.
Nichts aus anderen Zielgruppen hinzumischen. Nichts erfinden.`,
    user: [
      `Organisation: ${input.organisationName}`,
      `Avatar: ${input.avatar.title}`,
      input.avatar.whySeparate ? `Warum getrennt: ${input.avatar.whySeparate}` : "",
      "",
      buildCorpusPrompt(input.sources),
    ]
      .filter(Boolean)
      .join("\n"),
    tool,
    maxTokens: 32_000,
  });
  const dossier = normalizeDossier(json);
  if (!dossier) throw new Error("Die Akte war leer.");
  return { dossier, usage, model };
}

export async function previewAvatarFromDossier(input: {
  organisationName: string;
  avatar: WorkshopAvatar;
}): Promise<{ preview: NonNullable<WorkshopAvatar["preview"]>; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const dossier = input.avatar.dossier;
  if (!dossier) throw new Error("Zuerst die Akte erzeugen.");
  const tool: Anthropic.Tool = {
    name: "submit_preview",
    description: "Avatar-Vorschau aus einer freigegebenen Akte.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        summary: { type: "string" },
        promptAppend: { type: "string" },
      },
      required: ["name", "role", "summary", "promptAppend"],
    },
  };
  const { json, usage, model } = await callTool({
    system: `Du schreibst den avatar-spezifischen Text für einen Wunschkunden.
Nur die Akte verwenden. Lücken nicht füllen. Ich-Perspektive des Interessenten, kein Markenbotschafter.
promptAppend auf Deutsch, ohne den globalen Regelblock zu wiederholen.
Jede Angabe und jedes Zitat aus der Akte muss im Text vorkommen. Nichts streichen.`,
    user: [
      `Organisation: ${input.organisationName}`,
      `Arbeitstitel: ${input.avatar.title}`,
      "",
      dossier.narrative,
      dossier.pains ? `Schmerz: ${dossier.pains}` : "",
      dossier.outcome ? `Outcome: ${dossier.outcome}` : "",
      dossier.quotes.length ? `Zitate:\n${dossier.quotes.map((quote) => `- ${quote}`).join("\n")}` : "",
      dossier.gaps.length ? `Offen, nicht erfinden:\n${dossier.gaps.map((gap) => `- ${gap}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    tool,
    maxTokens: 32_000,
  });
  const preview = normalizePreview(json);
  if (!preview) throw new Error("Die Vorschau war unvollständig.");
  return { preview, usage, model };
}
