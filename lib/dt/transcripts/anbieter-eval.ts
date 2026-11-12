/**
 * The Anbieter evaluation without the API client, so the tests can drive it with a fake call.
 *
 * Two stages and a check:
 * 1. Extraction: every source is read piece by piece; each piece yields its statements.
 * 2. Assignment: the numbered statements are sorted into the 13 points, a few points per call.
 * 3. Check, in code: every statement ID must sit in a point, every fact of the Bestand must
 *    show in the result. What does not, is reported. Nothing is dropped silently.
 */

import { createHash } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";

import { reviveStringifiedToolInput } from "@/lib/ai/tolerant-json";
import {
  type ExtractionStore,
  type Statement,
  type StatementSource,
  FACT_KIND_LABEL,
  droppedFacts,
  extractFacts,
  formatStatements,
  instructionDeletes,
  missingFacts,
  normalizeExtractionChunk,
  numberStatements,
  parseStatementIds,
  pendingChunks,
  pruneExtraction,
  resolveSourceDate,
  sourceChunks,
  sourceTextHash,
  unassignedStatements,
} from "@/lib/dt/transcripts/anbieter-statements";
import type { WorkshopToolCall } from "@/lib/dt/transcripts/avatar-plan-llm";
import {
  ANBIETER_POINTS,
  REVIEW_UNASSIGNED_MAX,
  type AnbieterClaim,
  type AnbieterConflict,
  type AnbieterItem,
  type AnbieterPointKey,
  type AnbieterReview,
  type AnbieterSync,
  type WorkshopSource,
  formatRevisionBlock,
  mergeRevisedAnbieterItems,
  orderWorkshopSources,
  pointsNamedInInstruction,
  sourceLabel,
} from "@/lib/dt/transcripts/workshop-model";

type Usage = { inputTokens: number; outputTokens: number };
type SchemaArg = Parameters<typeof reviveStringifiedToolInput>[1];

/** Below this remaining time a further call is not worth starting. */
const MIN_CALL_MS = 30_000;
const ALL_KEYS = ANBIETER_POINTS.map((point) => point.key);

/**
 * The text each source contributes (the wording of a raw transcript, else the summary), in
 * the order that decides „newer“: by the date of the conversation or the document, the
 * upload date only where neither is known.
 */
export function statementSources(sources: WorkshopSource[]): StatementSource[] {
  return orderWorkshopSources(sources)
    .map((source, index) => {
      const raw = source.rawText.trim();
      const summary = source.summary?.trim() ?? "";
      const text = source.sourceKind === "raw" && raw ? raw : summary || raw;
      const { date, origin } = resolveSourceDate({
        spokenOn: source.spokenOn,
        text,
        filename: source.filename,
        title: source.title,
        createdAt: source.createdAt,
      });
      return { id: source.id, label: sourceLabel(source, index), date, dateOrigin: origin, text, createdAt: source.createdAt };
    })
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.createdAt.localeCompare(b.createdAt))
    .map(({ createdAt: _createdAt, ...source }) => {
      void _createdAt;
      return source;
    });
}

// ---------------------------------------------------------------------------
// Stage 1: extraction
// ---------------------------------------------------------------------------

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "submit_aussagen",
  description: "Alle einzelnen Aussagen dieses Textstücks und alle Eigennamen darin.",
  input_schema: {
    type: "object",
    properties: {
      aussagen: {
        type: "array",
        description: "Eine Aussage pro Eintrag, in der Reihenfolge des Textes.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Die Aussage, für sich verständlich." },
            intern: {
              type: "boolean",
              description: "true, wenn die Aussage laut Text nicht in Website-Texte oder nicht nach außen darf.",
            },
          },
          required: ["text", "intern"],
        },
      },
      eigennamen: {
        type: "array",
        items: { type: "string" },
        description:
          "Jeder Eigenname genau so, wie er im Text steht: Personen, Firmen, Marken, Produkte, Tarife, Orte, Verbände, Vereine, Abkürzungen.",
      },
    },
    required: ["aussagen", "eigennamen"],
  },
};

const EXTRACTION_SYSTEM = `Du zerlegst ein Textstück aus einem Kundengespräch oder einer Zusammenfassung in einzelne Aussagen.
Du bewertest nichts und lässt nichts weg. Ob eine Aussage wichtig ist, entscheidet ein späterer Schritt.

Regeln:
- Eine Aussage pro Eintrag. Ein Satz mit drei Angaben ergibt drei Einträge.
- Jede Aussage steht für sich: Wer oder was gemeint ist, steht im Eintrag selbst, nicht „er“, „das“ oder „dort“.
- Der Wortlaut bleibt. Jede Zahl, jeder Betrag, jede Prozentangabe, jedes Datum, jede Jahreszahl, jede URL, jede E-Mail-Adresse, jede Telefonnummer und jeder Name steht unverändert im Eintrag.
- Wörtliche Zitate bleiben wörtlich, in Anführungszeichen.
- Auch Einschränkungen, Ausnahmen, Verbote, Wünsche, Pläne, offene Fragen und zugesagte Nachlieferungen sind Aussagen.
- Sagt dasselbe Textstück etwas zweimal mit gleichem Inhalt, reicht ein Eintrag.
- Kein Eintrag ist nur reine Gesprächsorganisation ohne Inhalt: Begrüßung, Technikprobe, „hörst du mich“, Verabschiedung. Im Zweifel ist es ein Eintrag.
- Nichts zusammenfassen, nichts deuten, nichts ergänzen.

Intern:
- intern ist true, wenn der Text selbst sagt, dass der Inhalt nicht nach außen darf: „nur intern“, „nicht verwenden“, „nicht in Website-Texte“, „nicht veröffentlichen“, „nicht nennen“, „vertraulich“, „bleibt unter uns“ oder gleichbedeutend.
- Steht ein solcher Vermerk in einer Überschrift oder über einer Liste, gilt er für jede Aussage darunter, bis die nächste Überschrift gleicher Ebene kommt.
- Der Vermerk bleibt im Eintrag stehen („… (nur intern)“), damit man sieht, warum er intern ist.
- Eine Vorgabe zur Sprache der Texte („das Wort ‚günstig‘ nicht verwenden“, „keine Superlative“) ist KEIN interner Inhalt. Sie ist eine normale Aussage, intern ist false.
- Ohne solchen Vermerk ist intern false. Du entscheidest nicht selbst, was heikel sein könnte.`;

export type ExtractStatementsInput = {
  sources: WorkshopSource[];
  store: ExtractionStore;
  call: WorkshopToolCall;
  /** Epoch ms after which no further call starts. */
  deadline?: number;
  now?: () => number;
  /** How many pieces one request reads at once. */
  concurrency?: number;
};

export type ExtractStatementsResult = {
  store: ExtractionStore;
  /** Pieces still without statements after this round. */
  pending: number;
  total: number;
  usage: Usage;
  model: string | null;
  calls: number;
  /** The first failure of this round, when a piece could not be read. */
  error: string | null;
};

/**
 * One round of stage 1: reads up to `concurrency` pieces that have no statements yet. The
 * caller repeats it until `pending` is 0. Pieces whose text did not change are never read twice.
 */
export async function extractPendingStatements(input: ExtractStatementsInput): Promise<ExtractStatementsResult> {
  const now = input.now ?? Date.now;
  const sources = statementSources(input.sources);
  const store = pruneExtraction(sources, input.store);
  const total = new Set(sourceChunks(sources).map((chunk) => chunk.hash)).size;
  const pending = pendingChunks(sources, store);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let calls = 0;
  let error: string | null = null;
  const left = input.deadline == null ? undefined : input.deadline - now();
  const batch = left != null && left < MIN_CALL_MS ? [] : pending.slice(0, input.concurrency ?? 8);
  await Promise.all(
    batch.map(async (chunk) => {
      try {
        const result = await input.call({
          system: EXTRACTION_SYSTEM,
          user: [
            `Quelle: ${chunk.source}${chunk.parts > 1 ? ` (Teil ${chunk.part} von ${chunk.parts})` : ""}`,
            chunk.internal
              ? `Dieses ganze Textstück steht unter der Überschrift „${chunk.heading ?? "intern"}“ und ist damit als intern gekennzeichnet. Jede Aussage daraus ist intern.`
              : "",
            "",
            chunk.text,
          ]
            .filter((line, index) => line || index >= 2)
            .join("\n"),
          tool: EXTRACTION_TOOL,
          maxTokens: 32_000,
          timeoutMs: input.deadline == null ? undefined : input.deadline - now(),
        });
        calls += 1;
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        model = result.model ?? model;
        // Long lists sometimes arrive as one JSON string instead of an array.
        const extracted = normalizeExtractionChunk(
          reviveStringifiedToolInput(result.json, EXTRACTION_TOOL.input_schema as SchemaArg),
          chunk.text,
        );
        if (extracted.statements.length === 0) {
          throw new Error(`Aus „${chunk.source}“ kam keine einzige Aussage zurück.`);
        }
        store[chunk.hash] = extracted;
      } catch (err) {
        error ??= err instanceof Error && err.message.trim() ? err.message.trim() : "Ein Textstück konnte nicht gelesen werden.";
      }
    }),
  );
  return { store, pending: pendingChunks(sources, store).length, total, usage, model, calls, error };
}

// ---------------------------------------------------------------------------
// Stage 2: assignment
// ---------------------------------------------------------------------------

/** What belongs into which point; the sorting step reads this. */
const POINT_HINTS: Record<AnbieterPointKey, string> = {
  unternehmen: "wer der Anbieter ist: Name, Rechtsform, Standorte, Größe, Region, Kerngeschäft, Zugehörigkeit",
  gruendung: "Werdegang und Geschichte: Ausbildung, frühere Stationen, Gründung, Übernahmen, Entwicklung bis heute",
  leistungen: "Angebot: Sparten, Produkte, Tarife, Schwerpunkte, Zielbranchen des Angebots, was ausdrücklich nicht angeboten wird",
  ablauf: "Weg vom ersten Kontakt bis zum Ergebnis: Schritte, Dauern, Unterlagen, was der Kunde tun muss, Betreuung danach",
  alleinstellung: "was den Anbieter von anderen unterscheidet: Stärken, Besonderheiten, Versprechen",
  wettbewerb: "Wettbewerber, Marktumfeld, Abgrenzung zu anderen Anbietern und Vertriebswegen",
  team: "Personen, Rollen, Qualifikationen, Partner, Netzwerk, Kooperationen",
  werte: "Haltung, Überzeugungen, Grundsätze der Beratung, was dem Anbieter wichtig ist",
  beweise: "Belege: Zahlen, Fälle, Praxisbeispiele, Referenzen, Bewertungen, Siegel, Mitgliedschaften, Auszeichnungen",
  sprache: "Vorgaben für Texte: Anrede, Ton, Begriffe, Formulierungen, No-Gos, Kundensprache, Autorenschaft",
  preis: "Preise, Beiträge, Vergütung, Kostenlogik, Preispositionierung",
  kanaele: "Kontaktwege, Terminbuchung, Erreichbarkeit, woher Anfragen kommen, Website und ihre Seiten als Weg zur Anfrage",
  ziele: "Ziele, Pläne, Wachstum, geplante Angebote, was die Website erreichen soll, offene Punkte für später",
};

const CLASSIFY_BATCH = 250;
const CUSTOMER_KEY = "kunden";
const NONE_KEY = "keiner";
const BLOCKED_KEY = "gesperrt";

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "submit_zuordnung",
  description: "Jede Aussage genau den Punkten zugeordnet, zu denen sie gehört.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      [
        ...ANBIETER_POINTS.map((point) => [point.key, `${point.label}: ${POINT_HINTS[point.key]}`] as const),
        [CUSTOMER_KEY, "Aussagen nur über Kunden, Zielgruppen oder Wunschkunden, ohne Aussage über den Anbieter"] as const,
        [NONE_KEY, "Aussagen, die weder den Anbieter noch seine Kunden betreffen"] as const,
        [BLOCKED_KEY, "Seltene Ausnahme: Aussagen, die genau den Inhalt offenlegen, den eine Leitplanke verbietet"] as const,
      ].map(([key, description]) => [key, { type: "array", items: { type: "string" }, description: `IDs. ${description}` }]),
    ),
    required: [],
  },
};

const CLASSIFY_SYSTEM = `Du sortierst nummerierte Aussagen aus Kundengesprächen in die Punkte einer Anbieter-Checkliste. Du schreibst keinen Text, du nennst nur IDs.

Punkte:
${ANBIETER_POINTS.map((point) => `- ${point.key} (${point.label}): ${POINT_HINTS[point.key]}`).join("\n")}
- ${CUSTOMER_KEY}: die Aussage beschreibt nur Kunden, Zielgruppen oder Wunschkunden (ihre Lage, Fragen, Einwände, Profile, Seitenzuordnung von Personas) und sagt nichts über den Anbieter selbst.
- ${NONE_KEY}: die Aussage betrifft weder den Anbieter noch seine Kunden, etwa Projektorganisation der Agentur.

Regeln:
- JEDE ID steht in mindestens einer Liste. Keine ID fehlt.
- Eine Aussage über den Anbieter, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt, nicht nach ${NONE_KEY}.
- Eine Aussage darf in mehreren Punkten stehen, wenn sie zu mehreren gehört.
- Sagt eine Aussage etwas über den Anbieter UND über Kunden, gehört sie in den Anbieter-Punkt.
- Jede ID einzeln, keine Bereiche.`;

/** With guard rails in hand the sorting also pulls out what they forbid, wherever a source says it unmarked. */
function classifySystem(rules: string[]): string {
  if (rules.length === 0) return CLASSIFY_SYSTEM;
  return `${CLASSIFY_SYSTEM}

Leitplanken (Inhalte, die nicht in Website-Texte dürfen):
${rules.map((rule) => `- ${rule}`).join("\n")}

- ${BLOCKED_KEY} ist die seltene Ausnahme. Dorthin kommt eine Aussage nur, wenn sie sonst in einen Anbieter-Punkt käme UND genau den Inhalt offenlegt, den eine Leitplanke verbietet: die konkrete gesperrte Zahl, den konkreten gesperrten Namen, den konkreten gesperrten Vorgang. Sie steht dann NUR in ${BLOCKED_KEY}, auch wenn diese Quelle sie nicht als intern markiert.
- Nicht gesperrt ist eine Aussage, die nur zum selben Themenfeld gehört, ohne den gesperrten Inhalt selbst zu nennen. Ein Thema ist nicht gesperrt, nur weil es dazu eine Leitplanke gibt.
- Nicht gesperrt ist eine Aussage, die selbst ein Verbot oder eine Vorgabe ausspricht („X nicht nennen“, „erst nach Freigabe verwenden“); sie gehört in ihren Punkt.
- Aussagen über Kunden, Zielgruppen und Avatare bleiben in ${CUSTOMER_KEY}, Aussagen über Aufbau und Stand der Dokumente in ${NONE_KEY}. Sie werden nie nach ${BLOCKED_KEY} sortiert.
- Im Zweifel ist eine Aussage nicht gesperrt.`;
}

const CONFLICT_SCHEMA = {
  type: "array",
  description: "Nur bei widersprüchlichen Aussagen zum selben Sachverhalt.",
  items: {
    type: "object",
    properties: {
      thema: { type: "string", description: "Worum es geht, kurz und ohne die strittigen Angaben selbst." },
      angaben: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
          required: ["text", "ids"],
        },
      },
    },
    required: ["thema", "angaben"],
  },
};

const CONFLICT_RULES = `Widersprüche:
- Nennen zwei Aussagen zum selben Sachverhalt Verschiedenes (andere Zahl, anderer Preis, anderer Name, anderes Werkzeug, anderer Ablauf, ja gegen nein, „wird angeboten“ gegen „wird nicht angeboten“), wählst du NICHT aus. Auch nicht die neuere.
- Beide Angaben kommen nach widersprueche, jede mit ihrem text und ihren ids. Sie stehen nicht im text des Punkts.
- Auch eine Aussage, die selbst einen offenen Abgleich nennt („Formulierung A vs. B“, „noch zu klären“), ist ein Widerspruch zwischen A und B.
- Eine spätere Aussage, die eine frühere nur genauer macht oder ergänzt, ist kein Widerspruch.`;

const WRITE_RULES = `Du schreibst EINEN Punkt einer Anbieter-Checkliste aus den nummerierten Aussagen, die diesem Punkt zugeordnet wurden. Die Aussagen sind nach Quelle sortiert, von alt nach neu. Sie sind deine einzige Quelle. Nichts erfinden.

text:
- Der Punkttext enthält den Inhalt JEDER Aussage: jede Zahl, jeden Betrag, jedes Datum, jeden Namen, jede URL, jede Ausnahme, jedes Zitat. Nichts kürzen, nichts weglassen, weil es nebensächlich wirkt.
- Inhaltlich identische Aussagen führst du zu einer Formulierung zusammen.
- Die Quellen sind oft Rohtranskripte. Du ordnest und gliederst, du deutest nicht.
- Gehört eine Aussage erkennbar nicht in diesen Punkt, nimmst du sie trotzdem auf, kurz am Ende.
- Im text stehen keine Aussagen-IDs und keine Quellenverweise in Klammern. Die IDs gehören nur in widersprueche.

${CONFLICT_RULES}`;

function writeTool(options: { revision: boolean; pool: boolean }): Anthropic.Tool {
  const ids = { type: "array", items: { type: "string" } };
  return {
    name: "submit_punkt",
    description: "Der Text eines Checklistenpunkts und seine Widersprüche.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Punkttext mit dem Inhalt aller Aussagen." },
        widersprueche: CONFLICT_SCHEMA,
        ...(options.pool
          ? { neu_ids: { ...ids, description: "IDs der Aussagen aus „Noch nicht zugeordnet“, die du in den text aufgenommen hast." } }
          : {}),
        ...(options.revision
          ? { entfernt_ids: { ...ids, description: "IDs der Aussagen, die die Anweisung ausdrücklich streicht. Leer, wenn sie nichts löscht." } }
          : {}),
      },
      required: ["text"],
    },
  };
}

/** A revision that names no point: the model returns only the points it changes. */
function changeTool(): Anthropic.Tool {
  const ids = { type: "array", items: { type: "string" } };
  return {
    name: "submit_aenderung",
    description: "Nur die Punkte, die die Anweisung verändert, jeweils vollständig.",
    input_schema: {
      type: "object",
      properties: {
        ...Object.fromEntries(
          ANBIETER_POINTS.map((point) => [
            point.key,
            {
              type: "object",
              description: point.label,
              properties: {
                text: { type: "string", description: "Der vollständige neue Text des Punkts." },
                neu_ids: { ...ids, description: "IDs der Aussagen aus „Noch nicht zugeordnet“, die jetzt im text stehen." },
              },
              required: ["text"],
            },
          ]),
        ),
        entfernt_ids: { ...ids, description: "IDs der Aussagen, die die Anweisung ausdrücklich streicht." },
      },
      required: [],
    },
  };
}

const GUARDRAIL_TOOL: Anthropic.Tool = {
  name: "submit_leitplanken",
  description: "Verbote für Website-Texte, abgeleitet aus internen Hinweisen, und Widersprüche unter den Hinweisen.",
  input_schema: {
    type: "object",
    properties: {
      leitplanken: {
        type: "array",
        items: {
          type: "object",
          properties: {
            regel: { type: "string", description: "Ein Verbot in einem kurzen Satz, z. B. „Kundenbestand nicht nennen.“" },
            ids: { type: "array", items: { type: "string" }, description: "IDs der Hinweise, die diese Regel abdeckt." },
          },
          required: ["regel", "ids"],
        },
      },
      widersprueche: CONFLICT_SCHEMA,
    },
    required: ["leitplanken"],
  },
};

const GUARDRAIL_SYSTEM = `Du erhältst interne Hinweise aus Kundengesprächen. Sie dürfen in keinem Website-Text stehen.
Du machst daraus Leitplanken für die Person, die Texte schreibt: reine Verbote. Sie erfährt dadurch, WORÜBER sie nicht schreiben darf, aber nicht den internen Inhalt selbst.

Regeln:
- Jede Leitplanke ist ein kurzes Verbot: „Kundenbestand nicht nennen.“ „Keine Stiftung-Warentest-Ergebnisse verwenden.“ „Buchungssoftware nicht namentlich nennen.“ „Wettbewerber nicht namentlich nennen.“
- Die Leitplanke nennt das Thema, nicht den Inhalt. Keine Zahlen, keine Beträge, keine Jahreszahlen, keine internen Einzelheiten.
- Namen von Personen, Wettbewerbern, Kunden und Werkzeugen stehen nicht in der Leitplanke; nenne die Gattung („Wettbewerber“, „Buchungssoftware“). Ausnahme: Ein Name, ohne den das Verbot nicht befolgt werden kann, etwa eine Institution, deren Ergebnisse nicht zitiert werden dürfen.
- Mehrere Hinweise zum selben Thema ergeben eine Leitplanke mit allen ihren IDs.
- Jede ID steht in mindestens einer Leitplanke.
- Nichts erfinden: kein Verbot ohne Hinweis.

Zusätzlich meldest du Widersprüche unter den Hinweisen (widersprueche), zum Beispiel wenn zwei Hinweise verschiedene Werkzeuge für dieselbe Aufgabe nennen:
${CONFLICT_RULES.split("\n").slice(1).join("\n").replace("Sie stehen nicht im text des Punkts.", "")}`;

const MERGE_RULES = `Es gibt einen bestehenden Punkt eines Anbieterstands. Eine neue Quelle ist dazugekommen. Du arbeitest NUR ihre Aussagen ein, die diesem Punkt zugeordnet wurden.
Der bestehende Text bleibt Wort für Wort, wie er ist. Du schreibst ihn nicht um, kürzt ihn nicht und wiederholst ihn nicht.

Du lieferst:
- ergaenzung: nur der neue Inhalt, als Text, der unter den bestehenden gesetzt wird. Er enthält jede Zahl, jeden Betrag, jedes Datum, jeden Namen und jede Ausnahme der neuen Aussagen. Was der bestehende Text inhaltlich schon sagt, steht NICHT noch einmal darin. Leer, wenn nichts Neues dazukommt.
- enthalten_ids: die ID jeder neuen Aussage, deren Inhalt der bestehende Text schon vollständig enthält. Sie wird nicht doppelt eingefügt.
- widersprueche: wenn eine neue Aussage zum selben Sachverhalt etwas anderes sagt als der bestehende Text (andere Zahl, anderer Preis, anderer Name, anderer Ablauf, ja gegen nein). Dann kommt sie NICHT in ergaenzung. Du nennst thema, bestehend (die Stelle aus dem bestehenden Text, wörtlich), neu (die neue Angabe) und ids. Du entscheidest nicht, wer recht hat, auch nicht zugunsten der neueren Quelle.

Jede neue Aussage landet in genau einem der drei: ergaenzung, enthalten_ids oder widersprueche.
Eine neue Aussage, die den bestehenden Text nur genauer macht oder ergänzt, ist kein Widerspruch; sie kommt in ergaenzung. Nichts erfinden.`;

const MERGE_TOOL: Anthropic.Tool = {
  name: "submit_einarbeitung",
  description: "Ergänzung aus den neuen Aussagen für einen Checklistenpunkt. Der bestehende Text wird nicht zurückgegeben.",
  input_schema: {
    type: "object",
    properties: {
      ergaenzung: { type: "string", description: "Nur der neue Inhalt. Leer, wenn nichts Neues dazukommt." },
      enthalten_ids: {
        type: "array",
        items: { type: "string" },
        description: "IDs neuer Aussagen, die der bestehende Text schon enthält.",
      },
      widersprueche: {
        type: "array",
        items: {
          type: "object",
          properties: {
            thema: { type: "string" },
            bestehend: { type: "string", description: "Die Stelle aus dem bestehenden Text, wörtlich." },
            neu: { type: "string", description: "Die neue Angabe." },
            ids: { type: "array", items: { type: "string" } },
          },
          required: ["thema", "bestehend", "neu", "ids"],
        },
      },
    },
    required: ["ergaenzung"],
  },
};

/** Statement IDs the model put into a text as references: „… verwenden [5.712].“ They are no content. */
function stripIdRefs(text: string): string {
  return text
    .replace(/[ \t]*[\[(](?:Aussagen?\s+)?\d{1,3}\.\d{1,4}(?:\s*[,;–-]\s*\d{1,3}\.\d{1,4})*[\])]/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}

/** The rules of one answer. A rule that carries a number is dropped: it would leak the note it stands for. */
function readGuardrails(raw: unknown, ids: ReadonlySet<string>): AnbieterReview["guardrails"] {
  const rules = new Map<string, Set<string>>();
  for (const row of Array.isArray(raw) ? raw : []) {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    const rule = typeof record?.regel === "string" ? record.regel.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const covered = parseStatementIds(record?.ids, ids);
    if (!rule || covered.length === 0 || extractFacts(rule).length > 0) continue;
    rules.set(rule, new Set([...(rules.get(rule) ?? []), ...covered]));
  }
  return [...rules].map(([rule, covered]) => ({ rule, ids: [...covered] }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The claims of one contradiction, each with source and date; the one from the latest source is marked. */
function readConflicts(raw: unknown, byId: ReadonlyMap<string, Statement>): AnbieterConflict[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(byId.keys());
  const conflicts: AnbieterConflict[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const rows = Array.isArray(record?.angaben) ? record.angaben : [];
    const claims: Array<AnbieterClaim & { order: number }> = [];
    for (const row of rows) {
      const claim = asRecord(row);
      const text = typeof claim?.text === "string" ? stripIdRefs(claim.text) : "";
      const ids = parseStatementIds(claim?.ids, known);
      if (!text || ids.length === 0) continue;
      const statements = ids.map((id) => byId.get(id)).filter((s): s is Statement => s != null);
      const latest = statements.reduce((a, b) => (b.order > a.order ? b : a));
      claims.push({
        text,
        ids,
        source: [...new Set(statements.map((s) => s.source))].join("; "),
        date: latest.date,
        dateOrigin: latest.dateOrigin,
        newest: false,
        order: latest.order,
      });
    }
    if (claims.length < 2) continue;
    const top = Math.max(...claims.map((claim) => claim.order));
    const several = new Set(claims.map((claim) => claim.order)).size > 1;
    conflicts.push({
      topic: typeof record?.thema === "string" ? record.thema.trim() : "",
      claims: claims.map(({ order, ...claim }) => ({ ...claim, newest: several && order === top })),
    });
  }
  return conflicts;
}

function resultText(items: AnbieterItem[], unassigned: Statement[]): string {
  return [
    ...items.map((item) => item.current),
    ...items.flatMap((item) => (item.conflicts ?? []).flatMap((conflict) => conflict.claims.map((claim) => claim.text))),
    ...unassigned.map((statement) => statement.text),
  ].join("\n");
}

function assignedIds(items: AnbieterItem[]): Set<string> {
  return new Set(items.flatMap((item) => item.statementIds ?? []));
}

/** The check in code: coverage of every statement ID and the fact comparison against the Bestand. */
export function buildAnbieterReview(input: {
  sources: StatementSource[];
  store: ExtractionStore;
  statements: Statement[];
  items: AnbieterItem[];
  guardrails?: AnbieterReview["guardrails"];
  dismissedIds?: string[];
  lostInRevision?: AnbieterReview["lostInRevision"];
  /** Source numbers of the statement IDs; without them the sources count from old to new. */
  numbers?: Record<string, number>;
  nextSourceNo?: number;
  /** Statements that only describe customers; they belong to the avatars, not to the Anbieter. */
  customerIds?: Iterable<string>;
  internalConflicts?: AnbieterConflict[];
  /** Public statements a guard rail forbids; they are shown with the internal notes. */
  blockedIds?: Iterable<string>;
}): AnbieterReview {
  const dismissed = input.dismissedIds ?? [];
  const live = new Set(input.sources.map((source) => source.id));
  const sourceNumbers = Object.fromEntries(
    Object.entries(input.numbers ?? Object.fromEntries(input.sources.map((source, index) => [source.id, index + 1]))).filter(
      ([id]) => live.has(id),
    ),
  );
  const assigned = assignedIds(input.items);
  const blocked = new Set([...(input.blockedIds ?? [])].filter((id) => !assigned.has(id)));
  const internal = input.statements.filter((statement) => statement.internal || blocked.has(statement.id));
  // Internal statements are accounted for in their own area; they are never „unassigned“.
  const leftover = unassignedStatements(
    input.statements.filter((statement) => !statement.internal && !blocked.has(statement.id)),
    assigned,
    dismissed,
  );
  const customers = new Set(input.customerIds ?? []);
  const unassigned = leftover.filter((statement) => !customers.has(statement.id));
  const customerIds = leftover.filter((statement) => customers.has(statement.id)).map((statement) => statement.id);
  return {
    statementCount: input.statements.length,
    sourceCount: input.sources.length,
    unassigned: unassigned
      .slice(0, REVIEW_UNASSIGNED_MAX)
      .map((statement) => ({ id: statement.id, text: statement.text, source: statement.source })),
    unassignedCount: unassigned.length,
    missingFacts: missingFacts({
      sources: input.sources,
      store: input.store,
      resultText: resultText(input.items, [...leftover, ...internal]),
    }),
    internal: internal
      .slice(0, REVIEW_UNASSIGNED_MAX)
      .map((statement) => ({
        id: statement.id,
        text: statement.text,
        source: statement.source,
        ...(statement.internal ? {} : { blocked: true }),
      })),
    blockedIds: [...blocked].filter((id) => input.statements.some((statement) => statement.id === id)),
    guardrails: input.guardrails ?? [],
    internalConflicts: input.internalConflicts ?? [],
    customerIds,
    dismissedIds: dismissed,
    lostInRevision: input.lostInRevision ?? [],
    sourceNumbers,
    sourceHashes: Object.fromEntries(input.sources.map((source) => [source.id, sourceTextHash(source)])),
    nextSourceNo: Math.max(input.nextSourceNo ?? 1, ...Object.values(sourceNumbers).map((n) => n + 1), 1),
  };
}

/** What changed in the Bestand since the stand was written: new, changed and removed sources. */
export function anbieterSyncPlan(review: AnbieterReview | null, sources: WorkshopSource[]): AnbieterSync {
  if (!review || Object.keys(review.sourceNumbers).length === 0) return { added: [], changed: [], removed: 0 };
  const current = statementSources(sources);
  const live = new Set(current.map((source) => source.id));
  return {
    added: current.filter((source) => !(source.id in review.sourceNumbers)).map((source) => source.label),
    changed: current
      .filter((source) => source.id in review.sourceNumbers && review.sourceHashes[source.id] !== sourceTextHash(source))
      .map((source) => source.label),
    removed: Object.keys(review.sourceNumbers).filter((id) => !live.has(id)).length,
  };
}

/**
 * A source was deleted and its content shall stay in the stand: the review forgets the
 * source, the texts stay word for word. Its number is never given to another source.
 */
export function forgetRemovedSources(review: AnbieterReview, sources: WorkshopSource[]): AnbieterReview {
  const live = new Set(sources.map((source) => source.id));
  const keep = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => live.has(id)));
  const gone = new Set(
    Object.entries(review.sourceNumbers)
      .filter(([id]) => !live.has(id))
      .map(([, n]) => `${n}.`),
  );
  const stays = (id: string) => ![...gone].some((prefix) => id.startsWith(prefix));
  return {
    ...review,
    sourceNumbers: keep(review.sourceNumbers),
    sourceHashes: keep(review.sourceHashes),
    sourceCount: Object.keys(keep(review.sourceNumbers)).length,
    unassigned: review.unassigned.filter((statement) => stays(statement.id)),
    internal: review.internal.filter((statement) => stays(statement.id)),
    customerIds: review.customerIds.filter(stays),
    blockedIds: review.blockedIds.filter(stays),
  };
}

export type AnbieterRunMode = "full" | "merge" | "remove";

/** The guard rails out of the internal notes, prepared before the run so the sorting can use them. */
export type AnbieterGuard = {
  /** Fits exactly one set of internal statements. */
  key: string;
  guardrails: AnbieterReview["guardrails"];
  conflicts: AnbieterConflict[];
};

function guardKey(internal: Statement[]): string {
  return createHash("sha256")
    .update(internal.map((statement) => `${statement.id}|${statement.text}`).join("\n"))
    .digest("hex")
    .slice(0, 24);
}

/** The source numbers a run uses: a saved stand keeps its numbers, a full run counts from old to new. */
function planNumbers(
  sources: StatementSource[],
  savedReview: AnbieterReview | null,
  incremental: boolean,
): { numbers: Record<string, number>; nextSourceNo: number; fresh: StatementSource[] } {
  let nextSourceNo = savedReview?.nextSourceNo ?? 1;
  const numbers: Record<string, number> = {};
  const fresh: StatementSource[] = [];
  sources.forEach((source, index) => {
    const known = incremental ? savedReview?.sourceNumbers[source.id] : undefined;
    if (known != null) numbers[source.id] = known;
    else if (incremental) {
      numbers[source.id] = nextSourceNo;
      nextSourceNo += 1;
      fresh.push(source);
    } else numbers[source.id] = index + 1;
  });
  return { numbers, nextSourceNo: incremental ? nextSourceNo : sources.length + 1, fresh };
}

function isIncremental(input: Pick<EvaluateAnbieterInput, "mode" | "instruction" | "current">): boolean {
  if (input.mode === "full" || !input.current?.review) return false;
  return input.mode === "merge" || input.mode === "remove" || Boolean(input.instruction?.trim());
}

export type EvaluateAnbieterInput = {
  organisationName: string;
  sources: WorkshopSource[];
  /** The statements of stage 1. Every piece of every source must be in it. */
  store: ExtractionStore;
  instruction?: string;
  /**
   * The saved stand. With an instruction it makes the run a revision: only the touched
   * points are written anew, and the result is checked against this stand.
   */
  current?: { items: AnbieterItem[]; review: AnbieterReview | null };
  /**
   * „merge“ works only the new sources into the saved stand, „remove“ takes the content of
   * deleted sources out of it. Both need a saved stand with its check. Default: a full run.
   */
  mode?: AnbieterRunMode;
  /** Guard rails prepared ahead by `prepareAnbieterGuard`; used when they fit the statements of this run. */
  guard?: AnbieterGuard | null;
  /** Epoch ms after which no further call starts; calls in flight are cut off there. */
  deadline?: number;
  call: WorkshopToolCall;
  now?: () => number;
};

export type EvaluateAnbieterResult = {
  items: AnbieterItem[];
  review: AnbieterReview;
  usage: Usage;
  model: string | null;
  calls: number;
};

/**
 * Stage 2 and the check.
 *
 * A full run sorts the statements into the points first (IDs only, in small batches), then
 * writes each point from its own statements, one call per point. So no call reads the whole
 * Bestand, no long field costs another field its text, and which statement sits in which
 * point is known from the sorting, not from a list the model has to repeat.
 */
export async function evaluateAnbieterCorpusWith(input: EvaluateAnbieterInput): Promise<EvaluateAnbieterResult> {
  const now = input.now ?? Date.now;
  const instruction = input.instruction?.trim() ?? "";
  const sources = statementSources(input.sources);
  if (pendingChunks(sources, input.store).length > 0) {
    throw new Error("Die Aussagen sind noch nicht aus allen Quellen gezogen. Bitte die Auswertung neu starten.");
  }
  // A saved stand keeps its source numbers, so the statement IDs in its points stay valid.
  const saved = input.current;
  const { numbers, nextSourceNo, fresh } = planNumbers(sources, saved?.review ?? null, isIncremental(input));
  const statements = numberStatements(sources, input.store, numbers);
  if (statements.length === 0) throw new Error("Aus dem Bestand kam keine einzige Aussage. Bitte erneut auswerten.");
  // Internal statements never reach the assignment: no point can take them as a fact.
  const open = statements.filter((statement) => !statement.internal);
  const internal = statements.filter((statement) => statement.internal);
  if (open.length === 0) throw new Error("Der Bestand enthält nur interne Hinweise. Daraus entsteht kein Anbieterstand.");
  const byId = new Map(open.map((statement) => [statement.id, statement]));
  const known = new Set(byId.keys());
  const internalById = new Map(internal.map((statement) => [statement.id, statement]));
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | null = null;
  let calls = 0;

  const remaining = () => (input.deadline == null ? undefined : input.deadline - now());
  const hasTime = () => {
    const left = remaining();
    return left == null || left > MIN_CALL_MS;
  };
  const run = async (call: Parameters<WorkshopToolCall>[0]) => {
    const result = await input.call({ ...call, timeoutMs: remaining() });
    calls += 1;
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model ?? model;
    return asRecord(reviveStringifiedToolInput(result.json, call.tool.input_schema as SchemaArg)) ?? {};
  };
  const label = (key: AnbieterPointKey) => ANBIETER_POINTS.find((point) => point.key === key)?.label ?? key;
  const emptyItem = (key: AnbieterPointKey): AnbieterItem => ({ key, label: label(key), current: "", earlier: null, sources: "" });
  /** IDs that still belong to a public statement of the Bestand. */
  const liveIds = (ids: string[] | undefined) => (ids ?? []).filter((id) => known.has(id));
  const pick = (ids: Iterable<string>) => [...new Set(ids)].map((id) => byId.get(id)).filter((s): s is Statement => s != null);

  /** Sorting: every statement into its points. A batch that leaves IDs out is asked once more for them. */
  const classify = async (
    list: Statement[],
    rules: string[],
  ): Promise<{ byKey: Map<AnbieterPointKey, Set<string>>; customers: Set<string>; blocked: Set<string> }> => {
    const byKey = new Map<AnbieterPointKey, Set<string>>(ALL_KEYS.map((key) => [key, new Set<string>()]));
    const customers = new Set<string>();
    const blocked = new Set<string>();
    const sortBatch = async (batch: Statement[]): Promise<Set<string>> => {
      const ids = new Set(batch.map((statement) => statement.id));
      const json = await run({
        system: classifySystem(rules),
        user: [`Organisation: ${input.organisationName}`, "", formatStatements(batch)].join("\n"),
        tool: CLASSIFY_TOOL,
        maxTokens: 16_000,
      });
      const seen = new Set<string>();
      // Customers and document notes never reach a point, so a guard rail has nothing to keep them out of.
      const aside = new Set([...parseStatementIds(json[CUSTOMER_KEY], ids), ...parseStatementIds(json[NONE_KEY], ids)]);
      const inPoint = new Set(ALL_KEYS.flatMap((key) => parseStatementIds(json[key], ids)));
      // What a guard rail forbids goes into no point, whatever other list names it too.
      for (const id of parseStatementIds(json[BLOCKED_KEY], ids)) {
        if (aside.has(id) && !inPoint.has(id)) continue;
        blocked.add(id);
        seen.add(id);
      }
      for (const key of ALL_KEYS) {
        for (const id of parseStatementIds(json[key], ids)) {
          if (!blocked.has(id)) byKey.get(key)!.add(id);
          seen.add(id);
        }
      }
      for (const id of parseStatementIds(json[CUSTOMER_KEY], ids)) {
        if (!seen.has(id)) customers.add(id);
        seen.add(id);
      }
      for (const id of aside) seen.add(id);
      return seen;
    };
    const batches: Statement[][] = [];
    for (let i = 0; i < list.length; i += CLASSIFY_BATCH) batches.push(list.slice(i, i + CLASSIFY_BATCH));
    const missed = (
      await Promise.all(
        batches.map(async (batch) => {
          const seen = await sortBatch(batch);
          return batch.filter((statement) => !seen.has(statement.id));
        }),
      )
    ).flat();
    if (missed.length > 0 && hasTime()) {
      const again: Statement[][] = [];
      for (let i = 0; i < missed.length; i += CLASSIFY_BATCH) again.push(missed.slice(i, i + CLASSIFY_BATCH));
      await Promise.all(again.map((batch) => sortBatch(batch).catch(() => new Set<string>())));
    }
    for (const id of blocked) {
      customers.delete(id);
      for (const ids of byKey.values()) ids.delete(id);
    }
    return { byKey, customers, blocked };
  };

  /** One point, written from its own statements. Its IDs are the statements it was given. */
  const write = async (
    key: AnbieterPointKey,
    own: Statement[],
    options: { revision?: AnbieterItem; pool?: Statement[] } = {},
  ): Promise<{ item: AnbieterItem; removed: string[] }> => {
    const pool = options.pool ?? [];
    if (own.length === 0 && pool.length === 0 && !options.revision) return { item: emptyItem(key), removed: [] };
    const note = options.revision
      ? formatRevisionBlock(instruction, `## ${label(key)}\n${options.revision.current.trim() || "(leer)"}`)
      : "";
    const json = await run({
      system: [
        WRITE_RULES,
        "",
        `Der Punkt: ${key} (${label(key)}). Hierhin gehört: ${POINT_HINTS[key]}.`,
        options.revision
          ? "Das ist eine Änderung, keine neue Auswertung. Du setzt die Anweisung um. Was bisher im Punkt stand und nicht ausdrücklich gestrichen wird, bleibt drin. Eine Aussage verliert gegen die Anweisung."
          : "",
        pool.length > 0
          ? "Unter „Noch nicht zugeordnet“ stehen Aussagen, die bisher in keinem Punkt sind. Du nimmst davon nur auf, was die Anweisung verlangt oder was eindeutig in diesen Punkt gehört, und nennst ihre IDs in neu_ids."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      user: [
        `Organisation: ${input.organisationName}`,
        "",
        `# Aussagen des Punkts „${label(key)}“`,
        own.length > 0 ? formatStatements(own) : "(keine)",
        pool.length > 0 ? `\n# Noch nicht zugeordnet\n${formatStatements(pool)}` : "",
        note ? `\n${note}` : "",
      ].join("\n"),
      tool: writeTool({ revision: Boolean(options.revision), pool: pool.length > 0 }),
      maxTokens: 32_000,
    });
    const ownIds = new Set(own.map((statement) => statement.id));
    const poolIds = new Set(pool.map((statement) => statement.id));
    const removed = options.revision ? parseStatementIds(json.entfernt_ids, new Set([...ownIds, ...poolIds])) : [];
    const ids = new Set([...ownIds, ...parseStatementIds(json.neu_ids, poolIds)]);
    for (const id of removed) ids.delete(id);
    return {
      item: {
        ...emptyItem(key),
        current: typeof json.text === "string" ? stripIdRefs(json.text) : "",
        statementIds: [...ids],
        conflicts: readConflicts(json.widersprueche, byId),
      },
      removed,
    };
  };

  /** The internal notes as prohibitions, and what they contradict each other on. A rule that carries a number is dropped: it would leak the note. */
  const guard = async (
    notes: Statement[] = internal,
  ): Promise<{ guardrails: AnbieterReview["guardrails"]; conflicts: AnbieterConflict[] }> => {
    if (notes.length === 0) return { guardrails: [], conflicts: [] };
    const noteIds = new Set(notes.map((statement) => statement.id));
    const json = await run({
      system: GUARDRAIL_SYSTEM,
      user: formatStatements(notes),
      tool: GUARDRAIL_TOOL,
      maxTokens: 16_000,
    });
    return {
      guardrails: readGuardrails(json.leitplanken, noteIds),
      conflicts: readConflicts(json.widersprueche, internalById),
    };
  };
  const noGuard = { guardrails: [] as AnbieterReview["guardrails"], conflicts: [] as AnbieterConflict[] };

  const done = (
    items: AnbieterItem[],
    extra: {
      guardrails?: AnbieterReview["guardrails"];
      internalConflicts?: AnbieterConflict[];
      customerIds?: Iterable<string>;
      blockedIds?: Iterable<string>;
      dismissedIds?: string[];
      lostInRevision?: AnbieterReview["lostInRevision"];
    } = {},
  ) => ({
    items,
    review: buildAnbieterReview({ sources, store: input.store, statements, items, numbers, nextSourceNo, ...extra }),
    usage,
    model,
    calls,
  });

  const keptGuardrails = (review: AnbieterReview) =>
    review.guardrails
      .map((guardrail) => ({ ...guardrail, ids: guardrail.ids.filter((id) => internalById.has(id)) }))
      .filter((guardrail) => guardrail.ids.length > 0);
  const keptInternalConflicts = (review: AnbieterReview) =>
    review.internalConflicts
      .map((conflict) => ({ ...conflict, claims: conflict.claims.filter((claim) => claim.ids.some((id) => internalById.has(id))) }))
      .filter((conflict) => conflict.claims.length >= 2);
  const carried = (review: AnbieterReview) => ({
    guardrails: keptGuardrails(review),
    internalConflicts: keptInternalConflicts(review),
    customerIds: liveIds(review.customerIds),
    blockedIds: liveIds(review.blockedIds),
    dismissedIds: liveIds(review.dismissedIds),
  });
  /** Guard rails prepared ahead count only for exactly these internal statements. */
  const prepared = input.guard && input.guard.key === guardKey(internal) ? input.guard : null;

  // --- Remove: the content of deleted sources leaves the stand ------------------
  if (input.mode === "remove") {
    if (!saved?.review) {
      throw new Error("Dieser Stand hat noch keine Aussagen-Zuordnung. Bitte komplett neu auswerten.");
    }
    // Only the points that held a statement of a deleted source are written anew, from what is left of them.
    const affected = saved.items.filter((item) => (item.statementIds ?? []).some((id) => !known.has(id)));
    const rewritten = new Map(
      (await Promise.all(affected.map((item) => write(item.key, pick(liveIds(item.statementIds)))))).map((answer) => [
        answer.item.key,
        answer.item,
      ]),
    );
    return done(
      saved.items.map((item) => rewritten.get(item.key) ?? item),
      carried(saved.review),
    );
  }

  // --- Merge: only the new sources are worked into the stand --------------------
  if (input.mode === "merge") {
    const review = saved?.review;
    if (!saved || !review || !saved.items.some((item) => item.current.trim())) {
      throw new Error("Es gibt noch keinen geprüften Anbieterstand zum Einarbeiten. Bitte komplett neu auswerten.");
    }
    const changedSources = sources.filter(
      (source) => source.id in review.sourceNumbers && review.sourceHashes[source.id] !== sourceTextHash(source),
    );
    if (changedSources.length > 0) {
      throw new Error(
        `Eine bestehende Quelle wurde geändert (${changedSources.map((source) => source.label).join(", ")}). Das lässt sich nicht einarbeiten. Bitte komplett neu auswerten.`,
      );
    }
    const freshNumbers = new Set(fresh.map((source) => numbers[source.id]));
    const added = open.filter((statement) => freshNumbers.has(statement.sourceNo));
    const addedInternal = internal.filter((statement) => freshNumbers.has(statement.sourceNo));
    if (added.length === 0 && addedInternal.length === 0) {
      throw new Error("Es ist keine neue Quelle dazugekommen. Es gibt nichts einzuarbeiten.");
    }
    const newestOrder = Math.max(...statements.map((statement) => statement.order));
    const kept = carried(review);
    // The sorting needs the guard rails, so they come first: prepared ahead, or the saved ones plus the new notes.
    const guarded = prepared
      ? { guardrails: prepared.guardrails, conflicts: prepared.conflicts }
      : await (addedInternal.length > 0 ? guard(addedInternal) : Promise.resolve(noGuard))
          .catch(() => noGuard)
          .then((extra) => ({
            guardrails: [...kept.guardrails, ...extra.guardrails],
            conflicts: [...kept.internalConflicts, ...extra.conflicts],
          }));
    const sorted = await classify(
      added,
      guarded.guardrails.map((guardrail) => guardrail.rule),
    );

    const mergeOne = async (prev: AnbieterItem): Promise<AnbieterItem> => {
      const own = pick(sorted.byKey.get(prev.key) ?? []);
      if (own.length === 0) return prev;
      const ownIds = new Set(own.map((statement) => statement.id));
      const json = await run({
        system: [MERGE_RULES, "", `Der Punkt: ${prev.key} (${prev.label}). Hierhin gehört: ${POINT_HINTS[prev.key]}.`].join("\n"),
        user: [
          `Organisation: ${input.organisationName}`,
          "",
          `# Bestehender Text des Punkts „${prev.label}“ (bleibt wörtlich)`,
          prev.current.trim() || "(leer)",
          "",
          "# Neue Aussagen",
          formatStatements(own),
        ].join("\n"),
        tool: MERGE_TOOL,
        maxTokens: 32_000,
      });
      const contained = new Set(parseStatementIds(json.enthalten_ids, ownIds));
      const conflicts: AnbieterConflict[] = [];
      for (const row of Array.isArray(json.widersprueche) ? json.widersprueche : []) {
        const record = asRecord(row);
        const claimIds = parseStatementIds(record?.ids, ownIds);
        const existing = typeof record?.bestehend === "string" ? record.bestehend.trim() : "";
        const claimed = typeof record?.neu === "string" ? record.neu.trim() : "";
        if (!existing || !claimed || claimIds.length === 0) continue;
        const from = pick(claimIds).reduce((a, b) => (b.order > a.order ? b : a));
        conflicts.push({
          topic: typeof record?.thema === "string" ? record.thema.trim() : "",
          claims: [
            { text: existing, source: "Bisheriger Anbieterstand", date: null, newest: false, ids: [] },
            { text: claimed, source: from.source, date: from.date, dateOrigin: from.dateOrigin, newest: from.order === newestOrder, ids: claimIds },
          ],
        });
      }
      const conflicting = new Set(conflicts.flatMap((conflict) => conflict.claims.flatMap((claim) => claim.ids)));
      const addition = typeof json.ergaenzung === "string" ? stripIdRefs(json.ergaenzung) : "";
      const rest = own.filter((statement) => !contained.has(statement.id) && !conflicting.has(statement.id));
      // No text although statements are left over: they go in word for word. Nothing is lost here.
      const text = addition || rest.map((statement) => statement.text).join("\n");
      return {
        ...prev,
        current: [prev.current.trim(), rest.length > 0 ? text : ""].filter(Boolean).join("\n\n"),
        statementIds: [...new Set([...(prev.statementIds ?? []), ...ownIds])],
        conflicts: [...(prev.conflicts ?? []), ...conflicts],
      };
    };
    const items = await Promise.all(saved.items.map((item) => mergeOne(item)));
    return done(items, {
      ...kept,
      guardrails: guarded.guardrails,
      internalConflicts: guarded.conflicts,
      customerIds: [...kept.customerIds, ...sorted.customers],
      blockedIds: [...kept.blockedIds, ...sorted.blocked],
    });
  }

  // --- Revision: only the points the instruction touches -------------------
  if (instruction && saved?.review && saved.items.some((item) => item.current.trim())) {
    const review = saved.review;
    const named = pointsNamedInInstruction(instruction);
    const before = new Map(saved.items.map((item) => [item.key, item]));
    // Statements that sit in no point yet; an instruction may ask for them.
    const taken = new Set([...assignedIds(saved.items), ...review.customerIds, ...review.dismissedIds, ...review.blockedIds]);
    const pool = open.filter((statement) => !taken.has(statement.id));
    let revised: AnbieterItem[];
    let removedIds: string[];
    if (named.length > 0) {
      const answers = await Promise.all(
        named.map((key) => {
          const prev = before.get(key) ?? emptyItem(key);
          return write(key, pick(liveIds(prev.statementIds)), { revision: prev, pool });
        }),
      );
      revised = answers.map((answer) => answer.item);
      removedIds = answers.flatMap((answer) => answer.removed);
    } else {
      const poolIds = new Set(pool.map((statement) => statement.id));
      const json = await run({
        system: `Es gibt einen Anbieterstand mit 13 Punkten und eine Anweisung der prüfenden Person. Das ist eine Änderung, keine neue Auswertung.
Du gibst NUR die Punkte zurück, die die Anweisung verändert, jeweils mit ihrem vollständigen neuen Text. Jeden anderen Punkt lässt du ganz weg; er bleibt gespeichert, wie er ist.
Im geänderten Punkt bleibt alles stehen, was die Anweisung nicht betrifft, Wort für Wort.
Unter „Noch nicht zugeordnet“ stehen Aussagen, die bisher in keinem Punkt sind. Nimmst du eine auf, nennst du ihre ID in neu_ids.
Streicht die Anweisung ausdrücklich etwas, nennst du die IDs der betroffenen Aussagen in entfernt_ids. Nichts erfinden.`,
        user: [
          `Organisation: ${input.organisationName}`,
          "",
          "# Anbieterstand",
          ...saved.items.map((item) => `## ${item.key} (${item.label})\n${item.current.trim() || "(leer)"}`),
          pool.length > 0 ? `\n# Noch nicht zugeordnet\n${formatStatements(pool)}` : "",
          `\n${formatRevisionBlock(instruction, "")}`,
        ].join("\n"),
        tool: changeTool(),
        maxTokens: 32_000,
      });
      revised = [];
      for (const key of ALL_KEYS) {
        const value = asRecord(json[key]);
        const prev = before.get(key) ?? emptyItem(key);
        if (!value || typeof value.text !== "string") continue;
        revised.push({
          ...prev,
          current: stripIdRefs(value.text),
          statementIds: [...new Set([...liveIds(prev.statementIds), ...parseStatementIds(value.neu_ids, poolIds)])],
        });
      }
      removedIds = parseStatementIds(json.entfernt_ids, known);
    }
    const returned = named.length > 0 ? named : revised.filter((item) => item.current.trim()).map((item) => item.key);
    let items = mergeRevisedAnbieterItems({ current: saved.items, revised, returned, named });

    const deletes = instructionDeletes(instruction);
    const changed = items.filter((item) => item !== before.get(item.key));
    const removed = new Set(deletes ? removedIds : []);
    // A named point the instruction empties takes its statements with it.
    if (deletes) {
      for (const item of changed) {
        if (named.includes(item.key) && !item.current.trim()) {
          for (const id of before.get(item.key)?.statementIds ?? []) removed.add(id);
        }
      }
    }
    // A statement the instruction did not strike stays with its point, whatever the model returned.
    items = items.map((item) => {
      const prev = before.get(item.key);
      if (item === prev) return item;
      const ids = new Set([...(item.statementIds ?? []), ...liveIds(prev?.statementIds)]);
      for (const id of removed) ids.delete(id);
      return { ...item, statementIds: [...ids] };
    });
    const stillAssigned = assignedIds(items);
    const dismissedIds = [...new Set([...liveIds(review.dismissedIds), ...removed])].filter((id) => !stillAssigned.has(id));

    // The check against the stand before: every fact that was in a changed point and is gone now.
    const lost: AnbieterReview["lostInRevision"] = [];
    const after = resultText(items, []);
    const spared = [instruction, ...dismissedIds.map((id) => byId.get(id)?.text ?? "")].join("\n");
    for (const item of changed) {
      const prev = before.get(item.key);
      // Struck without the instruction asking for it: reported, statement by statement.
      for (const id of deletes ? [] : removedIds) {
        const statement = byId.get(id);
        if (statement && (prev?.statementIds ?? []).includes(id)) {
          lost.push({ id, text: statement.text, source: statement.source, point: item.label });
        }
      }
      for (const fact of droppedFacts(prev?.current ?? "", after, spared)) {
        lost.push({ id: null, text: `${FACT_KIND_LABEL[fact.kind]} ${fact.value}`, source: "", point: item.label });
      }
    }
    return done(items, { ...carried(review), dismissedIds, lostInRevision: lost });
  }

  // --- Full run -------------------------------------------------------------
  const guarded = prepared ? { guardrails: prepared.guardrails, conflicts: prepared.conflicts } : await guard().catch(() => noGuard);
  const sorted = await classify(
    open,
    guarded.guardrails.map((guardrail) => guardrail.rule),
  );
  const written = await Promise.all(ALL_KEYS.map((key) => write(key, pick(sorted.byKey.get(key) ?? []))));
  const items = written.map((answer) => answer.item);
  if (!items.some((item) => item.current.trim())) {
    throw new Error("Die KI-Antwort enthielt keine auswertbaren Anbieter-Punkte. Bitte erneut auswerten.");
  }
  return done(items, {
    guardrails: guarded.guardrails,
    internalConflicts: guarded.conflicts,
    customerIds: sorted.customers,
    blockedIds: sorted.blocked,
  });
}

/**
 * The guard rails for a run, made ahead of it: the last round of stage 1 calls this, so the
 * run itself can sort with them and stays inside the time limit of a request.
 */
export async function prepareAnbieterGuard(
  input: Pick<EvaluateAnbieterInput, "sources" | "store" | "mode" | "instruction" | "current" | "call" | "deadline" | "now"> & {
    cached?: AnbieterGuard | null;
  },
): Promise<{ guard: AnbieterGuard | null; usage: Usage; model: string | null; calls: number }> {
  const sources = statementSources(input.sources);
  const none = { guard: null, usage: { inputTokens: 0, outputTokens: 0 }, model: null, calls: 0 };
  if (pendingChunks(sources, input.store).length > 0) return none;
  const { numbers } = planNumbers(sources, input.current?.review ?? null, isIncremental(input));
  const internal = numberStatements(sources, input.store, numbers).filter((statement) => statement.internal);
  const key = guardKey(internal);
  if (input.cached?.key === key) return { ...none, guard: input.cached };
  if (internal.length === 0) return { ...none, guard: { key, guardrails: [], conflicts: [] } };
  const byId = new Map(internal.map((statement) => [statement.id, statement]));
  const ids = new Set(byId.keys());
  const now = input.now ?? Date.now;
  const result = await input.call({
    system: GUARDRAIL_SYSTEM,
    user: formatStatements(internal),
    tool: GUARDRAIL_TOOL,
    maxTokens: 16_000,
    timeoutMs: input.deadline == null ? undefined : input.deadline - now(),
  });
  const json = asRecord(reviveStringifiedToolInput(result.json, GUARDRAIL_TOOL.input_schema as SchemaArg)) ?? {};
  return {
    guard: { key, guardrails: readGuardrails(json.leitplanken, ids), conflicts: readConflicts(json.widersprueche, byId) },
    usage: result.usage,
    model: result.model,
    calls: 1,
  };
}
