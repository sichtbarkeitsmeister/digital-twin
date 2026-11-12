/**
 * The control layer of the Anbieter evaluation: statements with IDs, the coverage check
 * and the fact comparison. All of it is plain code. No prompt decides what was lost.
 */

import { createHash } from "node:crypto";

export const STATEMENT_CHUNK_CHARS = 20_000;
/** Raised when the extraction rules change, so stored extractions are not reused. */
const EXTRACTION_VERSION = "v1";

export type ExtractionChunk = { statements: string[]; names: string[] };
/** Extracted statements per chunk of source text, keyed by the hash of that text. */
export type ExtractionStore = Record<string, ExtractionChunk>;

export type StatementSource = {
  id: string;
  /** „12.03.2026 · Workshop 2“ */
  label: string;
  /** ISO date of the conversation, when known. */
  date: string | null;
  text: string;
};

export type Statement = {
  /** „3.17“: source 3 (old to new), statement 17. */
  id: string;
  text: string;
  sourceNo: number;
  source: string;
  date: string | null;
};

export function chunkHash(text: string): string {
  return createHash("sha256").update(`${EXTRACTION_VERSION}\n${text}`).digest("hex").slice(0, 32);
}

/** Cuts a text at line ends into pieces of at most {@link STATEMENT_CHUNK_CHARS}. */
export function chunkSourceText(text: string, max = STATEMENT_CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const line of clean.split("\n")) {
    let rest = line;
    while (rest.length > max) {
      push();
      const cut = Math.max(rest.lastIndexOf(" ", max), Math.floor(max / 2));
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    if (current.length + rest.length + 1 > max) push();
    current += `${rest}\n`;
  }
  push();
  return chunks;
}

export type PendingChunk = { hash: string; text: string; source: string; part: number; parts: number };

/** Every chunk of every source, with the ones that still lack an extraction marked. */
export function sourceChunks(sources: StatementSource[]): PendingChunk[] {
  return sources.flatMap((source) => {
    const chunks = chunkSourceText(source.text);
    return chunks.map((text, index) => ({
      hash: chunkHash(text),
      text,
      source: source.label,
      part: index + 1,
      parts: chunks.length,
    }));
  });
}

export function pendingChunks(sources: StatementSource[], store: ExtractionStore): PendingChunk[] {
  const seen = new Set<string>();
  return sourceChunks(sources).filter((chunk) => {
    if (store[chunk.hash] || seen.has(chunk.hash)) return false;
    seen.add(chunk.hash);
    return true;
  });
}

/** Drops extractions whose text is no longer part of the Bestand. */
export function pruneExtraction(sources: StatementSource[], store: ExtractionStore): ExtractionStore {
  const live = new Set(sourceChunks(sources).map((chunk) => chunk.hash));
  return Object.fromEntries(Object.entries(store).filter(([hash]) => live.has(hash)));
}

function cleanStatement(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 2_000) : "";
}

/** One chunk's tool answer. Names count only when the chunk really contains them. */
export function normalizeExtractionChunk(raw: unknown, chunkText: string): ExtractionChunk {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const statements = [
    ...new Set(
      list(record.aussagen ?? record.statements)
        .map((entry) =>
          cleanStatement(
            entry && typeof entry === "object" ? ((entry as Record<string, unknown>).text ?? "") : entry,
          ),
        )
        .filter(Boolean),
    ),
  ].slice(0, 600);
  const haystack = chunkText.toLowerCase();
  const names = [
    ...new Set(
      list(record.eigennamen ?? record.names)
        .map((entry) => cleanStatement(entry).slice(0, 120))
        .filter((name) => name.length >= 2 && haystack.includes(name.toLowerCase())),
    ),
  ].slice(0, 200);
  return { statements, names };
}

/** All statements of the Bestand, numbered per source from old to new. Sources must come in that order. */
export function numberStatements(sources: StatementSource[], store: ExtractionStore): Statement[] {
  const out: Statement[] = [];
  sources.forEach((source, index) => {
    let n = 0;
    const seen = new Set<string>();
    for (const text of chunkSourceText(source.text)) {
      for (const statement of store[chunkHash(text)]?.statements ?? []) {
        if (seen.has(statement)) continue;
        seen.add(statement);
        n += 1;
        out.push({ id: `${index + 1}.${n}`, text: statement, sourceNo: index + 1, source: source.label, date: source.date });
      }
    }
  });
  return out;
}

/** The statements as the model reads them: one block per source, one line per statement. */
export function formatStatements(statements: Statement[]): string {
  const blocks: string[] = [];
  let current = 0;
  for (const statement of statements) {
    if (statement.sourceNo !== current) {
      current = statement.sourceNo;
      blocks.push(`\n## Quelle ${current}: ${statement.source}`);
    }
    blocks.push(`[${statement.id}] ${statement.text}`);
  }
  return blocks.join("\n").trim();
}

/** IDs out of whatever the model returned: lists, strings, „1.3-1.7“ ranges. Only known IDs count. */
export function parseStatementIds(raw: unknown, known: ReadonlySet<string>): string[] {
  const text = Array.isArray(raw) ? raw.map((part) => String(part ?? "")).join(" ") : String(raw ?? "");
  const found = new Set<string>();
  const pattern = /(\d{1,3})\.(\d{1,4})(?:\s*[-–]\s*(?:(\d{1,3})\.)?(\d{1,4}))?/g;
  for (const match of text.matchAll(pattern)) {
    const source = match[1];
    const from = Number(match[2]);
    const to = match[4] != null && (match[3] == null || match[3] === source) ? Number(match[4]) : from;
    if (to >= from && to - from <= 400) {
      for (let n = from; n <= to; n += 1) {
        const id = `${source}.${n}`;
        if (known.has(id)) found.add(id);
      }
    }
    if (match[3] != null && match[3] !== source) {
      const other = `${match[3]}.${match[4]}`;
      if (known.has(other)) found.add(other);
      const first = `${source}.${from}`;
      if (known.has(first)) found.add(first);
    }
  }
  return [...found];
}

/** The coverage check: every statement that no point lists. */
export function unassignedStatements(
  statements: Statement[],
  assigned: Iterable<string>,
  dismissed: Iterable<string> = [],
): Statement[] {
  const taken = new Set([...assigned, ...dismissed]);
  return statements.filter((statement) => !taken.has(statement.id));
}

// ---------------------------------------------------------------------------
// Fact comparison
// ---------------------------------------------------------------------------

export type FactKind = "euro" | "prozent" | "datum" | "jahr" | "zahl" | "url" | "email" | "telefon" | "name";

export const FACT_KIND_LABEL: Record<FactKind, string> = {
  euro: "Euro-Betrag",
  prozent: "Prozentangabe",
  datum: "Datum",
  jahr: "Jahreszahl",
  zahl: "Zahl",
  url: "URL",
  email: "E-Mail-Adresse",
  telefon: "Telefonnummer",
  name: "Eigenname",
};

export type Fact = { kind: FactKind; value: string; canon: string; index: number };

const MONTHS = [
  "januar", "februar", "märz", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "dezember",
];
const MONTH_PATTERN = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";

function canonNumber(whole: string, fraction?: string): string {
  const digits = whole.replace(/\./g, "").replace(/^0+(?=\d)/, "");
  const frac = (fraction ?? "").replace(/0+$/, "");
  return frac ? `${digits}.${frac}` : digits;
}

function fullYear(year: string): string {
  if (year.length === 4) return year;
  return Number(year) > 50 ? `19${year}` : `20${year}`;
}

/**
 * The checkable facts of a text: amounts, percentages, dates, years, numbers from two
 * digits on, URLs, e-mail addresses and phone numbers. Clock times and list numbers are
 * no facts.
 */
export function extractFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  let work = text;
  const take = (pattern: RegExp, read: (match: RegExpExecArray) => { kind: FactKind; canon: string } | null) => {
    work = work.replace(pattern, (...args) => {
      const whole = String(args[0]);
      const index = Number(args[args.length - 2]);
      const match = Object.assign([...args.slice(0, -2)], { index, input: work }) as unknown as RegExpExecArray;
      const fact = read(match);
      if (fact?.canon) facts.push({ ...fact, value: whole.trim(), index });
      return " ".repeat(whole.length);
    });
  };
  const blank = (pattern: RegExp) => {
    work = work.replace(pattern, (whole) => " ".repeat(whole.length));
  };

  take(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => ({ kind: "email", canon: m[0].toLowerCase().replace(/\.$/, "") }));
  take(
    /(?:https?:\/\/|www\.)[^\s<>()"„“”]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|info|eu|io|at|ch|nrw|koeln|berlin)\b(?:\/[^\s<>()"„“”]*)?/gi,
    (m) => ({
      kind: "url",
      canon: m[0]
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/[.,;:!?)\]]+$/, "")
        .replace(/\/+$/, ""),
    }),
  );
  // Clock times and transcript time stamps.
  blank(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
  // Numbered headings and list items.
  blank(/^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*][ \t]+)?\d{1,3}[.)](?=[ \t]|$)/gm);
  take(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g, (m) => {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return { kind: "datum", canon: `${day}.${month}.${fullYear(String(m[3]))}` };
  });
  take(new RegExp(`\\b(\\d{1,2})\\.\\s?(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi"), (m) => ({
    kind: "datum",
    canon: `${Number(m[1])}.${MONTHS.indexOf(String(m[2]).toLowerCase()) + 1}.${m[3]}`,
  }));
  take(new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi"), (m) => ({
    kind: "datum",
    canon: `${MONTHS.indexOf(String(m[1]).toLowerCase()) + 1}.${m[2]}`,
  }));
  take(/(?:\+|\b00|\b0)\d[\d \t/().-]{5,}\d/g, (m) => {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 16) return null;
    return { kind: "telefon", canon: digits.replace(/^(?:0049|49(?=\d{8,}))/, "0") };
  });
  take(/(?:€|EUR)\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, (m) => ({
    kind: "euro",
    canon: canonNumber(String(m[1]), m[2] as string | undefined),
  }));
  take(/\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?:,-)?\s?(?:€|Euro\b|EUR\b)/g, (m) => ({
    kind: "euro",
    canon: canonNumber(String(m[1]), m[2] as string | undefined),
  }));
  take(/\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?(?:%|Prozent\b)/g, (m) => ({
    kind: "prozent",
    canon: canonNumber(String(m[1]), m[2] as string | undefined),
  }));
  take(/\b(?:19|20)\d{2}\b/g, (m) => ({ kind: "jahr", canon: m[0] }));
  take(/\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\b/g, (m) => {
    const canon = canonNumber(String(m[1]), m[2] as string | undefined);
    return canon.replace(/\..*$/, "").length >= 2 ? { kind: "zahl", canon } : null;
  });
  return facts.sort((a, b) => a.index - b.index);
}

const NUMERIC_KINDS: ReadonlySet<FactKind> = new Set(["euro", "prozent", "jahr", "zahl"]);

/** What a text offers to match against: the values of its facts, loosely by kind. */
function factKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const fact of extractFacts(text)) {
    if (NUMERIC_KINDS.has(fact.kind)) {
      keys.add(`n:${fact.canon}`);
    } else if (fact.kind === "datum") {
      keys.add(`d:${fact.canon}`);
      const parts = fact.canon.split(".");
      if (parts.length === 3) {
        keys.add(`d:${parts[1]}.${parts[2]}`);
        keys.add(`n:${parts[2]}`);
      } else if (parts.length === 2) {
        keys.add(`n:${parts[1]}`);
      }
    } else {
      keys.add(`${fact.kind}:${fact.canon}`);
    }
  }
  return keys;
}

function factKey(fact: Pick<Fact, "kind" | "canon">): string {
  if (NUMERIC_KINDS.has(fact.kind)) return `n:${fact.canon}`;
  if (fact.kind === "datum") return `d:${fact.canon}`;
  return `${fact.kind}:${fact.canon}`;
}

export type MissingFact = {
  kind: FactKind;
  value: string;
  /** Sources that carry the fact. */
  sources: string[];
  /** The place in the first source, for finding it again. */
  context: string;
};

function contextAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

export const MISSING_FACTS_MAX = 300;

/**
 * The safety net: every checkable fact and every proper name of the Bestand must be in
 * the result. What is missing comes back with its sources. Nothing here asks a model.
 */
export function missingFacts(input: {
  sources: StatementSource[];
  store: ExtractionStore;
  /** Everything the result shows: point texts, contradictions, unassigned statements. */
  resultText: string;
}): MissingFact[] {
  const have = factKeys(input.resultText);
  const resultLower = input.resultText.toLowerCase();
  const byKey = new Map<string, MissingFact>();
  const add = (key: string, entry: MissingFact) => {
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, entry);
    else if (!existing.sources.includes(entry.sources[0] ?? "")) existing.sources.push(entry.sources[0] ?? "");
  };
  for (const source of input.sources) {
    for (const fact of extractFacts(source.text)) {
      const key = factKey(fact);
      if (have.has(key)) continue;
      add(key, {
        kind: fact.kind,
        value: fact.value,
        sources: [source.label],
        context: contextAt(source.text, fact.index, fact.value.length),
      });
    }
    const sourceLower = source.text.toLowerCase();
    for (const text of chunkSourceText(source.text)) {
      for (const name of input.store[chunkHash(text)]?.names ?? []) {
        const lower = name.toLowerCase();
        if (resultLower.includes(lower)) continue;
        add(`name:${lower}`, {
          kind: "name",
          value: name,
          sources: [source.label],
          context: contextAt(source.text, Math.max(0, sourceLower.indexOf(lower)), name.length),
        });
      }
    }
  }
  return [...byKey.values()].slice(0, MISSING_FACTS_MAX);
}

/** Facts of `before` that `after` no longer has, except those `spared` mentions. */
export function droppedFacts(before: string, after: string, spared = ""): Array<Pick<Fact, "kind" | "value">> {
  const have = factKeys(after);
  const excused = factKeys(spared);
  const seen = new Set<string>();
  const out: Array<Pick<Fact, "kind" | "value">> = [];
  for (const fact of extractFacts(before)) {
    const key = factKey(fact);
    if (have.has(key) || excused.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: fact.kind, value: fact.value });
  }
  return out;
}

/** Whether an instruction asks for something to be removed at all. */
export function instructionDeletes(instruction: string): boolean {
  return /\b(?:lösch\w*|entfern\w*|streich\w*|rausnehmen|raus\b|weglassen|weg\b|nicht mehr|tilg\w*)/i.test(instruction);
}
