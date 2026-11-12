/**
 * The Anbieter evaluation without the API client, so the tests can drive it with a fake call.
 *
 * Two stages and a check:
 * 1. Extraction: every source is read piece by piece; each piece yields its statements.
 * 2. Assignment: the numbered statements are sorted into the 13 points, a few points per call.
 * 3. Check, in code: every statement ID must sit in a point, every fact of the Bestand must
 *    show in the result. What does not, is reported. Nothing is dropped silently.
 */

import type Anthropic from "@anthropic-ai/sdk";

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
  type WorkshopSource,
  anbieterPointGroups,
  formatRevisionBlock,
  mergeRevisedAnbieterItems,
  normalizeAnbieterItems,
  openPointsWithSource,
  orderWorkshopSources,
  pointsNamedInInstruction,
  sourceLabel,
} from "@/lib/dt/transcripts/workshop-model";

type Usage = { inputTokens: number; outputTokens: number };

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
  const batch = left != null && left < MIN_CALL_MS ? [] : pending.slice(0, input.concurrency ?? 6);
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
        const extracted = normalizeExtractionChunk(result.json, chunk.text);
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

const ASSIGNMENT_RULES = `Du erhältst ALLE Aussagen aus allen Gesprächen, nummeriert, nach Quelle sortiert von alt nach neu.
Die Aussagen sind deine einzige Quelle. Nichts erfinden.

Für jedes deiner Felder lieferst du:
- text: der Punkttext. Er enthält den Inhalt JEDER zugeordneten Aussage: jede Zahl, jeden Betrag, jedes Datum, jeden Namen, jede Ausnahme, jedes Zitat. Nichts kürzen, nichts weglassen, weil es nebensächlich wirkt.
- ids: die ID jeder Aussage, deren Inhalt im text steht. Jede ID einzeln, keine Bereiche.
- widersprueche: nur wenn sich Aussagen zum selben Sachverhalt widersprechen.

Zuordnen und zusammenführen:
- Die Quellen sind oft Rohtranskripte. Du ordnest jede Aussage dem Punkt zu, zu dem sie inhaltlich gehört, egal wo sie stand.
- Inhaltlich identische Aussagen führst du zu einer Formulierung zusammen und nennst alle ihre IDs.
- Eine Aussage darf in mehreren Punkten stehen.
- Eine Aussage über den Anbieter, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt.
- Sagt niemand etwas zu einem Feld, ist text ein leerer String und ids leer.

Widersprüche:
- Nennen zwei Aussagen zum selben Sachverhalt Verschiedenes (andere Zahl, anderer Preis, anderer Name, anderer Ablauf, ja gegen nein), wählst du NICHT aus. Auch nicht die neuere.
- Beide Angaben kommen nach widersprueche, jede mit ihrem text und ihren ids. Sie stehen nicht im text des Punkts.
- Eine spätere Aussage, die eine frühere nur genauer macht oder ergänzt, ist kein Widerspruch.`;

const POINT_SCHEMA = (label: string, hint: string) => ({
  type: "object",
  description: `${label}. ${hint}`,
  properties: {
    text: { type: "string", description: "Punkttext mit dem Inhalt aller zugeordneten Aussagen." },
    ids: { type: "array", items: { type: "string" }, description: "IDs aller Aussagen im text, z. B. 2.14." },
    widersprueche: {
      type: "array",
      description: "Nur bei widersprüchlichen Aussagen zum selben Sachverhalt.",
      items: {
        type: "object",
        properties: {
          thema: { type: "string", description: "Worum es geht, kurz." },
          angaben: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                ids: { type: "array", items: { type: "string" } },
              },
              required: ["text", "ids"],
            },
          },
        },
        required: ["thema", "angaben"],
      },
    },
  },
  required: ["text", "ids"],
});

function assignmentTool(keys: readonly AnbieterPointKey[], options: { required: boolean; revision: boolean }): Anthropic.Tool {
  const wanted = new Set(keys);
  const properties: Record<string, unknown> = Object.fromEntries(
    ANBIETER_POINTS.filter((point) => wanted.has(point.key)).map((point) => [
      point.key,
      POINT_SCHEMA(
        point.label,
        point.key === "ablauf"
          ? "Weg vom ersten Kontakt bis zum spürbaren Ergebnis: Schritte, genannte Dauern, was der Kunde tun muss. Eine zugesagte Nachlieferung bleibt als offener Punkt stehen."
          : "Alle belegten Fakten dieses Punkts.",
      ),
    ]),
  );
  const required = options.required ? Object.keys(properties) : [];
  if (options.revision) {
    properties.entfernt_ids = {
      type: "array",
      items: { type: "string" },
      description:
        "IDs der Aussagen, die die Anweisung ausdrücklich streicht. Leer, wenn die Anweisung nichts löscht.",
    };
  }
  return {
    name: "submit_anbieter",
    description: "Anbieterstand aus den nummerierten Aussagen. Pro Checklistenpunkt Text, Aussagen-IDs und Widersprüche.",
    input_schema: { type: "object", properties, required },
  };
}

const LEFTOVER_TOOL: Anthropic.Tool = {
  name: "submit_zuordnung",
  description: "Zuordnung jeder übrigen Aussage zu einem Checklistenpunkt.",
  input_schema: {
    type: "object",
    properties: {
      zuordnung: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            punkt: { type: "string", enum: [...ALL_KEYS, "keiner"] },
          },
          required: ["id", "punkt"],
        },
      },
    },
    required: ["zuordnung"],
  },
};

const GUARDRAIL_TOOL: Anthropic.Tool = {
  name: "submit_leitplanken",
  description: "Verbote für Website-Texte, abgeleitet aus internen Hinweisen.",
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
- Nichts erfinden: kein Verbot ohne Hinweis.`;

function pointLabels(keys: readonly AnbieterPointKey[]): string {
  const wanted = new Set(keys);
  return ANBIETER_POINTS.filter((point) => wanted.has(point.key))
    .map((point) => `${point.key} (${point.label})`)
    .join(", ");
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
      const text = typeof claim?.text === "string" ? claim.text.trim() : "";
      const ids = parseStatementIds(claim?.ids, known);
      if (!text || ids.length === 0) continue;
      const statements = ids.map((id) => byId.get(id)).filter((s): s is Statement => s != null);
      const latest = statements.reduce((a, b) => (b.sourceNo > a.sourceNo ? b : a));
      claims.push({
        text,
        ids,
        source: [...new Set(statements.map((s) => s.source))].join("; "),
        date: latest.date,
        dateOrigin: latest.dateOrigin,
        newest: false,
        order: latest.sourceNo,
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

/** The points one tool answer returned, each with text, statement IDs and contradictions. */
function readPoints(
  json: unknown,
  keys: readonly AnbieterPointKey[],
  byId: ReadonlyMap<string, Statement>,
): AnbieterItem[] {
  const record = asRecord(json) ?? {};
  const known = new Set(byId.keys());
  const texts = new Map(normalizeAnbieterItems(json).map((item) => [item.key, item]));
  const out: AnbieterItem[] = [];
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = asRecord(record[key]);
    const base = texts.get(key);
    if (!base) continue;
    const conflicts = readConflicts(value?.widersprueche, byId);
    const ids = new Set([
      ...parseStatementIds(value?.ids, known),
      ...conflicts.flatMap((conflict) => conflict.claims.flatMap((claim) => claim.ids)),
    ]);
    // A text field that only holds the nested object's largest string must stay the text itself.
    const text = typeof value?.text === "string" ? value.text.trim() : typeof record[key] === "string" ? base.current : "";
    out.push({ ...base, current: text, earlier: null, statementIds: [...ids], conflicts });
  }
  return out;
}

function describePoints(items: AnbieterItem[], keys: readonly AnbieterPointKey[]): string {
  return items
    .filter((item) => keys.includes(item.key) && (item.current.trim() || (item.statementIds ?? []).length > 0))
    .map((item) =>
      [
        `## ${item.label}`,
        item.current.trim() || "(leer)",
        (item.statementIds ?? []).length > 0 ? `Bisher zugeordnete Aussagen: ${(item.statementIds ?? []).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
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
}): AnbieterReview {
  const dismissed = input.dismissedIds ?? [];
  const internal = input.statements.filter((statement) => statement.internal);
  // Internal statements are accounted for in their own area; they are never „unassigned“.
  const unassigned = unassignedStatements(
    input.statements.filter((statement) => !statement.internal),
    assignedIds(input.items),
    dismissed,
  );
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
      resultText: resultText(input.items, [...unassigned, ...internal]),
    }),
    internal: internal
      .slice(0, REVIEW_UNASSIGNED_MAX)
      .map((statement) => ({ id: statement.id, text: statement.text, source: statement.source })),
    guardrails: input.guardrails ?? [],
    dismissedIds: dismissed,
    lostInRevision: input.lostInRevision ?? [],
  };
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
 * Stage 2 and the check. The points are filled in small groups, one call per group, so the
 * length of one field never costs another field its text. Statements no group took are
 * assigned once more; what still fits nowhere stays visible as „Nicht zugeordnet“.
 */
export async function evaluateAnbieterCorpusWith(input: EvaluateAnbieterInput): Promise<EvaluateAnbieterResult> {
  const now = input.now ?? Date.now;
  const instruction = input.instruction?.trim() ?? "";
  const sources = statementSources(input.sources);
  if (pendingChunks(sources, input.store).length > 0) {
    throw new Error("Die Aussagen sind noch nicht aus allen Quellen gezogen. Bitte die Auswertung neu starten.");
  }
  const statements = numberStatements(sources, input.store);
  if (statements.length === 0) throw new Error("Aus dem Bestand kam keine einzige Aussage. Bitte erneut auswerten.");
  // Internal statements never reach the assignment: no point can take them as a fact.
  const open = statements.filter((statement) => !statement.internal);
  const internal = statements.filter((statement) => statement.internal);
  if (open.length === 0) throw new Error("Der Bestand enthält nur interne Hinweise. Daraus entsteht kein Anbieterstand.");
  const byId = new Map(open.map((statement) => [statement.id, statement]));
  const known = new Set(byId.keys());
  const corpus = [`Organisation: ${input.organisationName}`, "", "# Aussagen", formatStatements(open)].join("\n");
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
    return result.json;
  };

  const fill = async (
    keys: readonly AnbieterPointKey[],
    options: { required: boolean; revision?: AnbieterItem[]; extraSystem?: string; extraUser?: string },
  ): Promise<{ items: AnbieterItem[]; removed: string[] }> => {
    const others = ALL_KEYS.filter((key) => !keys.includes(key));
    const note = formatRevisionBlock(instruction, options.revision ? describePoints(options.revision, keys) : "");
    const system = [
      ASSIGNMENT_RULES,
      "",
      `Du füllst von der Anbieter-Checkliste NUR diese Felder: ${pointLabels(keys)}.`,
      others.length > 0
        ? `Die übrigen Punkte füllt ein anderer Lauf: ${pointLabels(others)}. Aussagen, die nur dorthin gehören, lässt du liegen.`
        : "",
      note ? "Liegt eine Anweisung bei, setzt du sie an den genannten Punkten um. Eine Aussage verliert gegen diese Anweisung." : "",
      options.extraSystem ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    const json = await run({
      system,
      user: [corpus, note ? `\n${note}` : "", options.extraUser ? `\n${options.extraUser}` : ""].join("\n"),
      tool: assignmentTool(keys, { required: options.required, revision: Boolean(options.revision) }),
      maxTokens: 32_000,
    });
    return {
      items: readPoints(json, keys, byId),
      removed: options.revision ? parseStatementIds(asRecord(json)?.entfernt_ids, known) : [],
    };
  };

  /** The internal notes as prohibitions. A rule that carries a number is dropped: it would leak the note. */
  const guard = async (): Promise<AnbieterReview["guardrails"]> => {
    if (internal.length === 0) return [];
    const internalIds = new Set(internal.map((statement) => statement.id));
    const json = await run({
      system: GUARDRAIL_SYSTEM,
      user: formatStatements(internal),
      tool: GUARDRAIL_TOOL,
      maxTokens: 16_000,
    });
    const rows = Array.isArray(asRecord(json)?.leitplanken) ? (asRecord(json)?.leitplanken as unknown[]) : [];
    const rules = new Map<string, Set<string>>();
    for (const row of rows) {
      const record = asRecord(row);
      const rule = typeof record?.regel === "string" ? record.regel.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      const ids = parseStatementIds(record?.ids, internalIds);
      if (!rule || ids.length === 0 || extractFacts(rule).length > 0) continue;
      rules.set(rule, new Set([...(rules.get(rule) ?? []), ...ids]));
    }
    return [...rules].map(([rule, ids]) => ({ rule, ids: [...ids] }));
  };

  const done = (
    items: AnbieterItem[],
    extra: {
      guardrails?: AnbieterReview["guardrails"];
      dismissedIds?: string[];
      lostInRevision?: AnbieterReview["lostInRevision"];
    } = {},
  ) => ({
    items,
    review: buildAnbieterReview({ sources, store: input.store, statements, items, ...extra }),
    usage,
    model,
    calls,
  });

  // --- Revision: only the points the instruction touches -------------------
  const saved = input.current;
  if (instruction && saved?.review && saved.items.some((item) => item.current.trim())) {
    const named = pointsNamedInInstruction(instruction);
    const revision = "Das ist eine Änderung, keine neue Auswertung.";
    const answers =
      named.length > 0
        ? await Promise.all(
            anbieterPointGroups(named).map((keys) =>
              fill(keys, {
                required: true,
                revision: saved.items,
                extraSystem: `${revision} Die Anweisung nennt genau diese Felder. Du schreibst sie vollständig neu aus den Aussagen und dem bisherigen Stand. Was bisher im Feld stand und nicht ausdrücklich gestrichen wird, bleibt mit seiner ID drin.`,
              }),
            ),
          )
        : [
            await fill(ALL_KEYS, {
              required: false,
              revision: saved.items,
              extraSystem: `${revision} Du gibst NUR die Felder zurück, die die Anweisung verändert, jeweils vollständig mit allen bisherigen und neuen IDs. Jedes andere Feld lässt du ganz weg; es bleibt gespeichert, wie es ist.`,
            }),
          ];
    const revised = answers.flatMap((answer) => answer.items);
    const returned = named.length > 0 ? named : revised.filter((item) => item.current.trim()).map((item) => item.key);
    const items = mergeRevisedAnbieterItems({ current: saved.items, revised, returned, named });

    const deletes = instructionDeletes(instruction);
    const before = new Map(saved.items.map((item) => [item.key, item]));
    const changed = items.filter((item) => item !== before.get(item.key));
    const removed = new Set(deletes ? answers.flatMap((answer) => answer.removed) : []);
    // A named point the instruction empties takes its statements with it.
    if (deletes) {
      for (const item of changed) {
        if (named.includes(item.key) && !item.current.trim()) {
          for (const id of before.get(item.key)?.statementIds ?? []) removed.add(id);
        }
      }
    }
    const stillAssigned = assignedIds(items);
    for (const id of [...removed]) if (stillAssigned.has(id)) removed.delete(id);
    const dismissedIds = [...new Set([...(saved.review.dismissedIds ?? []), ...removed])].filter(
      (id) => known.has(id) && !stillAssigned.has(id),
    );

    // The same coverage check, against the stand before: what was in and is gone now.
    const lost: AnbieterReview["lostInRevision"] = [];
    const dismissed = new Set(dismissedIds);
    for (const item of changed) {
      const prev = before.get(item.key);
      for (const id of prev?.statementIds ?? []) {
        if (stillAssigned.has(id) || dismissed.has(id)) continue;
        const statement = byId.get(id);
        if (statement) lost.push({ id, text: statement.text, source: statement.source, point: item.label });
      }
    }
    const after = resultText(items, []);
    const spared = [instruction, ...[...dismissed].map((id) => byId.get(id)?.text ?? "")].join("\n");
    for (const item of changed) {
      for (const fact of droppedFacts(before.get(item.key)?.current ?? "", after, spared)) {
        lost.push({ id: null, text: `${FACT_KIND_LABEL[fact.kind]} ${fact.value}`, source: "", point: item.label });
      }
    }
    const internalIds = new Set(internal.map((statement) => statement.id));
    const guardrails = (saved.review.guardrails ?? [])
      .map((guardrail) => ({ ...guardrail, ids: guardrail.ids.filter((id) => internalIds.has(id)) }))
      .filter((guardrail) => guardrail.ids.length > 0);
    return done(items, { guardrails, dismissedIds, lostInRevision: lost });
  }

  // --- Full run -------------------------------------------------------------
  const guardrailsRun = guard().catch(() => [] as AnbieterReview["guardrails"]);
  const groups = await Promise.all(anbieterPointGroups().map((keys) => fill(keys, { required: true })));
  let items = normalizeAnbieterItems([]).map((empty) => groups.flatMap((g) => g.items).find((item) => item.key === empty.key) ?? empty);

  // A point that came back empty although a source has a section with its name: once more, alone.
  const lostPoints = openPointsWithSource(items, input.sources);
  const leftover = unassignedStatements(open, assignedIds(items));
  const [again, zuordnung] = await Promise.all([
    hasTime()
      ? Promise.all(
          lostPoints.map((point) =>
            fill([point.key], {
              required: true,
              extraUser: `Das Feld ${point.key} kam leer zurück. In ${point.sources.map((source) => `„${source}“`).join(", ")} steht aber ein Abschnitt mit der Überschrift „${point.label}“. Ordne die Aussagen daraus und alles Passende aus den anderen Quellen zu.`,
            }).catch(() => ({ items: [] as AnbieterItem[], removed: [] })),
          ),
        )
      : Promise.resolve([]),
    leftover.length > 0 && hasTime()
      ? run({
          system: `Diese Aussagen aus Kundengesprächen hat noch kein Punkt der Anbieter-Checkliste aufgenommen. Ordne JEDE einem Punkt zu.
Punkte: ${pointLabels(ALL_KEYS)}.
Eine Aussage über den Anbieter, die zu keinem Punkt perfekt passt, kommt in den nächsten passenden Punkt.
„keiner“ nur, wenn die Aussage nichts über den Anbieter, sein Angebot, seine Arbeitsweise, seinen Markt oder seine Pläne sagt.`,
          user: formatStatements(leftover),
          tool: LEFTOVER_TOOL,
          maxTokens: 32_000,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const refilled = new Map(again.flatMap((answer) => answer.items).filter((item) => item.current.trim()).map((item) => [item.key, item]));
  items = items.map((item) => refilled.get(item.key) ?? item);

  // Statements placed afterwards go into their point word for word; the text is not rewritten for them.
  const rows = Array.isArray(asRecord(zuordnung)?.zuordnung) ? (asRecord(zuordnung)?.zuordnung as unknown[]) : [];
  const late = new Map<AnbieterPointKey, Statement[]>();
  const taken = assignedIds(items);
  for (const row of rows) {
    const record = asRecord(row);
    const statement = byId.get(parseStatementIds(record?.id, known)[0] ?? "");
    const key = ALL_KEYS.find((candidate) => candidate === record?.punkt);
    if (!statement || !key || taken.has(statement.id)) continue;
    taken.add(statement.id);
    late.set(key, [...(late.get(key) ?? []), statement]);
  }
  items = items.map((item) => {
    const extra = late.get(item.key);
    if (!extra) return item;
    return {
      ...item,
      current: [item.current.trim(), ...extra.map((statement) => statement.text)].filter(Boolean).join("\n"),
      statementIds: [...(item.statementIds ?? []), ...extra.map((statement) => statement.id)],
    };
  });

  if (!items.some((item) => item.current.trim())) {
    throw new Error("Die KI-Antwort enthielt keine auswertbaren Anbieter-Punkte. Bitte erneut auswerten.");
  }
  return done(items, { guardrails: await guardrailsRun });
}
