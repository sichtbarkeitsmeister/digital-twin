/**
 * The Anbieter evaluation without the API client, so the tests can drive it with a fake call.
 */

import type Anthropic from "@anthropic-ai/sdk";

import type { WorkshopToolCall } from "@/lib/dt/transcripts/avatar-plan-llm";
import {
  ANBIETER_POINTS,
  type AnbieterItem,
  type AnbieterOpenPoint,
  type AnbieterPointKey,
  type WorkshopSource,
  anbieterPointGroups,
  buildCorpusPrompt,
  describeAnbieterStand,
  formatRevisionBlock,
  mergeRevisedAnbieterItems,
  normalizeAnbieterItems,
  openPointsWithSource,
  pointsNamedInInstruction,
} from "@/lib/dt/transcripts/workshop-model";

const CORPUS_RULES = `Du liest ALLE Gespräche als einen Bestand, in der Reihenfolge von alt nach neu.
Eine einzelne Stelle ist kein Ergebnis. Das Ergebnis ist, was über alle Gespräche hinweg als Letztes gilt.
Wird derselbe Punkt später schärfer oder anders gesagt, gilt nur die spätere Aussage.
Die frühere Aussage kommt ins Feld earlier, die geltende ins Feld current.
Verschiedene Themen ergänzen sich. Nichts erfinden. Was nicht gesagt wurde, bleibt leer.
Jede konkrete Angabe bleibt erhalten: Namen, Zahlen, Preise, Leistungen, Ausnahmen, Abläufe, Zitate.
Nichts kürzen, nichts weglassen, weil es nebensächlich wirkt. Nichts abschneiden.`;

type Usage = { inputTokens: number; outputTokens: number };

export type EvaluateAnbieterInput = {
  organisationName: string;
  sources: WorkshopSource[];
  instruction?: string;
  /** The saved points. With an instruction they make the run a revision: only the touched points change. */
  currentItems?: AnbieterItem[];
  /** Epoch ms after which no further call starts; calls in flight are cut off there. */
  deadline?: number;
  call: WorkshopToolCall;
  now?: () => number;
};

export type EvaluateAnbieterResult = {
  items: AnbieterItem[];
  usage: Usage;
  model: string | null;
  /** How many calls the run made; every call carries its own output limit. */
  calls: number;
};

const ANBIETER_POINT_MAX_TOKENS = 32_000;
/** Below this remaining time a further call is not worth starting. */
const MIN_CALL_MS = 30_000;

function anbieterTool(keys: readonly AnbieterPointKey[], required: boolean): Anthropic.Tool {
  const wanted = new Set(keys);
  const properties = Object.fromEntries(
    ANBIETER_POINTS.filter((point) => wanted.has(point.key)).map((point) => [
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
  return {
    name: "submit_anbieter",
    description: "Aktueller Anbieterstand aus allen Gesprächen. Ein Textfeld pro Checklistenpunkt.",
    input_schema: {
      type: "object",
      properties,
      required: required ? Object.keys(properties) : [],
    },
  };
}

function pointLabels(keys: readonly AnbieterPointKey[]): string {
  const wanted = new Set(keys);
  return ANBIETER_POINTS.filter((point) => wanted.has(point.key))
    .map((point) => `${point.key} (${point.label})`)
    .join(", ");
}

/**
 * The Anbieter checklist out of the whole Bestand. The points are filled in small groups,
 * one call per group, so the length of one field never costs another field its text. A
 * point that comes back empty although a source has a section with its name is asked for
 * once more on its own. With an instruction and saved points the run is a revision: only
 * the points the instruction touches are written anew, all others stay word for word.
 */
export async function evaluateAnbieterCorpusWith(input: EvaluateAnbieterInput): Promise<EvaluateAnbieterResult> {
  const now = input.now ?? Date.now;
  const instruction = input.instruction?.trim() ?? "";
  const currentItems = input.currentItems ?? [];
  const corpus = [`Organisation: ${input.organisationName}`, "", buildCorpusPrompt(input.sources)].join("\n");
  const allKeys = ANBIETER_POINTS.map((point) => point.key);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let calls = 0;

  const remaining = () => (input.deadline == null ? undefined : input.deadline - now());

  const fill = async (
    keys: readonly AnbieterPointKey[],
    options: { required: boolean; extraSystem?: string; extraUser?: string },
  ): Promise<AnbieterItem[]> => {
    const revision = formatRevisionBlock(
      instruction,
      describeAnbieterStand(currentItems.filter((item) => keys.includes(item.key))),
    );
    const system = `${CORPUS_RULES}

Du füllst von der Anbieter-Checkliste NUR diese Felder: ${pointLabels(keys)}.
Die übrigen Punkte der Checkliste füllt ein anderer Lauf. Was nur dorthin gehört, lässt du weg: ${pointLabels(allKeys.filter((key) => !keys.includes(key))) || "keine"}.
Jedes Feld enthält alle belegten Fakten dieses Punkts, nicht nur eine Kurzfassung.
Hat ein Gespräch einen Abschnitt mit der Überschrift eines deiner Felder, gehört dessen ganzer Inhalt in dieses Feld.
Was niemand gesagt hat, bleibt ein leerer String. Erfundene Fakten sind verboten.
${revision ? "Liegt eine Anweisung bei, setzt du sie an den genannten Punkten um. Eine fehlerhafte Transkription verliert gegen diese Anweisung." : ""}
${options.extraSystem ?? ""}`.trim();
    const user = [corpus, revision ? `\n${revision}` : "", options.extraUser ? `\n${options.extraUser}` : ""].join("\n");
    const result = await input.call({
      system,
      user,
      tool: anbieterTool(keys, options.required),
      maxTokens: ANBIETER_POINT_MAX_TOKENS,
      timeoutMs: remaining(),
    });
    calls += 1;
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model ?? model;
    return normalizeAnbieterItems(result.json).filter((item) => keys.includes(item.key));
  };

  const hasSaved = currentItems.some((item) => item.current.trim());

  if (instruction && hasSaved) {
    const named = pointsNamedInInstruction(instruction);
    let revised: AnbieterItem[];
    if (named.length > 0) {
      const groups = await Promise.all(
        anbieterPointGroups(named).map((keys) =>
          fill(keys, {
            required: true,
            extraSystem:
              "Die Anweisung nennt genau diese Felder. Du schreibst sie vollständig neu aus den Gesprächen und dem bisherigen Stand. Alle anderen Punkte bleiben unangetastet und gehen dich nichts an.",
          }),
        ),
      );
      revised = groups.flat();
    } else {
      revised = await fill(allKeys, {
        required: false,
        extraSystem:
          "Das ist eine Änderung, keine neue Auswertung. Du gibst NUR die Felder zurück, die die Anweisung verändert, jeweils vollständig. Jedes andere Feld lässt du ganz weg; es bleibt gespeichert, wie es ist.",
      });
    }
    const returned = named.length > 0 ? named : revised.filter((item) => item.current.trim()).map((item) => item.key);
    return {
      items: mergeRevisedAnbieterItems({ current: currentItems, revised, returned, named }),
      usage,
      model,
      calls,
    };
  }

  const groups = await Promise.all(anbieterPointGroups().map((keys) => fill(keys, { required: true })));
  let items = normalizeAnbieterItems(groups.flat());

  const lost = openPointsWithSource(items, input.sources);
  const left = remaining();
  if (lost.length > 0 && (left == null || left > MIN_CALL_MS)) {
    const again = await Promise.all(
      lost.map((point: AnbieterOpenPoint) =>
        fill([point.key], {
          required: true,
          extraUser: `Das Feld ${point.key} kam leer zurück. In ${point.sources.map((source) => `„${source}“`).join(", ")} steht aber ein Abschnitt mit der Überschrift „${point.label}“. Übernimm dessen Inhalt vollständig in das Feld und ergänze, was die anderen Gespräche dazu sagen.`,
        }).catch(() => [] as AnbieterItem[]),
      ),
    );
    const refilled = new Map(again.flat().filter((item) => item.current.trim()).map((item) => [item.key, item]));
    items = items.map((item) => refilled.get(item.key) ?? item);
  }

  if (!items.some((item) => item.current.trim())) {
    throw new Error("Die KI-Antwort enthielt keine auswertbaren Anbieter-Punkte. Bitte erneut auswerten.");
  }
  return { items, usage, model, calls };
}
