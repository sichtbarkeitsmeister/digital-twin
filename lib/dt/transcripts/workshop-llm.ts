import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractToolUseInput,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { dtChatFailureUserMessage } from "@/lib/dt/anthropic-chat";
import { AVATAR_VALUE_FIELDS, avatarFirstName, buildAvatarPrompt } from "@/lib/dt/transcripts/avatar-value";
import {
  ANBIETER_POINTS,
  type AnbieterItem,
  type AvatarDossier,
  type WorkshopAvatar,
  type WorkshopSource,
  buildCorpusPrompt,
  describeAnbieterStand,
  describeAvatarStand,
  formatRevisionBlock,
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

export async function proposeAvatarPlan(input: {
  organisationName: string;
  sources: WorkshopSource[];
  previous: WorkshopAvatar[];
  instruction?: string;
  notWanted?: string;
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
  const revision = formatRevisionBlock(
    input.instruction ?? "",
    describeAvatarStand({ notWanted: input.notWanted ?? "", avatars: input.previous }),
  );
  const { json, usage, model } = await callTool({
    system: `${CORPUS_RULES}

Du schlägst Avatare vor, legst aber keine Texte an.
Regel: Würde das Unternehmen zu beiden Gruppen dieselben Worte sagen? Wenn ja, ein Avatar. Wenn nein, getrennte Avatare.
Eine andere Leistung oder eine andere Größe allein erzeugt keinen zweiten Avatar.
Fallbeispiele sind Belege unter dem Avatar, niemals eigene Avatare.
Menschen, die sie nicht als Kunden wollen, gehören nach notWanted.
Schmerz, Traumergebnis, Dringlichkeit, Hürde, Aufwand und Zeit schreibst du hier nicht aus.
Höchstens sechs Avatare. Titel sind Arbeitstitel der Zielgruppe, keine Personennamen aus einem einzelnen Fall.
${revision ? "Liegt eine Anweisung bei, passt du Anzahl, Titel, Abgrenzung und Fälle daran an. Nichts darüber hinaus erfinden." : ""}`,
    user: [
      `Organisation: ${input.organisationName}`,
      "",
      buildCorpusPrompt(input.sources),
      revision ? `\n${revision}` : "",
    ].join("\n"),
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
        narrative: {
          type: "string",
          description: "Alle Belege zu diesem Avatar im Wortlaut. Nichts kürzen.",
        },
        schmerz: { type: "string", description: "Was jetzt weh tut, in den Worten des Kunden. Leer, wenn nicht gesagt." },
        traumergebnis: { type: "string", description: "Der Zustand danach, aus Sicht des Kunden. Leer, wenn nicht gesagt." },
        dringlichkeit: { type: "string", description: "Warum jetzt und nicht später. Leer, wenn kein echter Zeitdruck genannt wurde." },
        huerde: { type: "string", description: "Was vor der ersten Meldung oder vor dem Ja zurückhält. Leer, wenn nicht gesagt." },
        aufwand: { type: "string", description: "Was der Kunde tun, zahlen oder aushalten muss. Leer, wenn nicht gesagt." },
        zeit: { type: "string", description: "Weg vom ersten Kontakt bis zum spürbaren Ergebnis, mit den genannten Dauern. Leer, wenn nicht gesagt." },
        wahrscheinlichkeit: { type: "string", description: "Was glauben lässt, dass es bei diesem Kunden klappt. Leer, wenn nicht gesagt." },
        quotes: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
      },
      required: [
        "narrative",
        "schmerz",
        "traumergebnis",
        "dringlichkeit",
        "huerde",
        "aufwand",
        "zeit",
        "wahrscheinlichkeit",
        "quotes",
        "gaps",
      ],
    },
  };
  const { json, usage, model } = await callTool({
    system: `${CORPUS_RULES}

Du schreibst die Akte für genau einen Avatar. Nur Belege, die zu diesem Titel gehören.
narrative enthält jede dazu gehörende Angabe. Nichts kürzen.
Die Wertgleichung füllst du nur mit dem, was belegt ist: schmerz, traumergebnis, dringlichkeit, huerde, aufwand, zeit, wahrscheinlichkeit.
Was niemand gesagt hat, bleibt ein leerer String. Branchenwissen ist verboten.
quotes sind Sätze, die so gesagt oder geschrieben wurden. Eine Übersetzung oder eine Glättung ist kein Zitat.
gaps sind Punkte, die für diesen Avatar offen sind, auch eine zugesagte Nachlieferung.
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

function formatDossierForPrompt(dossier: AvatarDossier): string {
  const valueLines = AVATAR_VALUE_FIELDS.map((field) => {
    const text = dossier[field.key].trim();
    return text ? `${field.label}: ${text}` : `${field.label}: offen, nicht erfinden`;
  });
  return [
    dossier.narrative.trim() ? `Belege:\n${dossier.narrative.trim()}` : "",
    ...valueLines,
    dossier.quotes.length
      ? `Zitate, nur diese übernehmen:\n${dossier.quotes.map((quote) => `- ${quote}`).join("\n")}`
      : "Zitate: keine belegt, keine ergänzen",
    dossier.gaps.length
      ? `Offen, nicht erfinden:\n${dossier.gaps.map((gap) => `- ${gap}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
        name: {
          type: "string",
          description: "Genau ein erfundener Vorname, zum Beispiel Lea. Kein Nachname, keine Berufsbezeichnung.",
        },
        role: { type: "string", description: "Kurze Definition in höchstens sechs Wörtern, zum Beispiel Geschäftsführer ohne eigene IT." },
        summary: { type: "string", description: "Ein Satz, wer die Person ist. Keine neuen Fakten." },
      },
      required: ["name", "role", "summary"],
    },
  };
  const { json, usage, model } = await callTool({
    system: `Du benennst einen Wunschkunden. Den Prompt schreibst du nicht.
name ist genau ein erfundener Vorname, der zur Person passt. Kein Nachname. Kein Name aus dem Bestand. Nicht der Arbeitstitel und keine Berufsbezeichnung wie Geschäftsführer.
role ist eine kurze Definition in höchstens sechs Wörtern, ohne Satz und ohne Mitarbeiterzahl.
summary ist ein Satz zur Person, nur aus der Akte, ohne neue Zahlen oder Vergleiche.`,
    user: [
      `Organisation: ${input.organisationName}`,
      `Arbeitstitel: ${input.avatar.title}`,
      "",
      formatDossierForPrompt(dossier),
    ].join("\n"),
    tool,
    maxTokens: 4_000,
  });
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const name = avatarFirstName(typeof record.name === "string" ? record.name : "");
  const preview = normalizePreview({
    name,
    role: record.role,
    summary: record.summary,
    promptAppend: name ? buildAvatarPrompt(name, dossier) : "",
  });
  if (!preview) {
    throw new Error("Die Vorschau braucht einen erfundenen Vornamen und einen kurzen Rollentext.");
  }
  return { preview, usage, model };
}
