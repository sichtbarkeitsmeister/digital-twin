import { createHash } from "node:crypto";

import {
  avatarFirstName,
  avatarShortRole,
  ensureAvatarIntroducesSelf,
  type AvatarValueKey,
} from "@/lib/dt/transcripts/avatar-value";
import { buildCurrentAnbieterMarkdown } from "@/lib/dt/transcripts/anbieter-markdown";
import {
  AVATAR_PLAN_MAX,
  AVATAR_PLAN_MIN,
} from "@/lib/dt/transcripts/avatar-plan-bounds";
import {
  type DateOrigin,
  type ExtractionStore,
  type FactKind,
  type MissingFact,
  FACT_KIND_LABEL,
  MISSING_FACTS_MAX,
} from "@/lib/dt/transcripts/anbieter-statements";
import { normalizePersonaKey, slugFromPersonaName } from "@/lib/dt/transcripts/sanitize";

export { AVATAR_PLAN_MAX, AVATAR_PLAN_MIN };

export const WORKSHOP_CORPUS_START = "<!-- DT_WORKSHOP_CORPUS_START -->";
export const WORKSHOP_CORPUS_END = "<!-- DT_WORKSHOP_CORPUS_END -->";

export const ANBIETER_POINTS = [
  { key: "unternehmen", label: "Unternehmen & Kern" },
  { key: "gruendung", label: "Gründungsgeschichte" },
  { key: "leistungen", label: "Leistungen & Schwerpunkte" },
  { key: "ablauf", label: "Ablauf & Mitwirkung" },
  { key: "alleinstellung", label: "Alleinstellung" },
  { key: "wettbewerb", label: "Wettbewerb" },
  { key: "team", label: "Team & Partner" },
  { key: "werte", label: "Werte & Haltung" },
  { key: "beweise", label: "Beweise & Erfolge" },
  { key: "sprache", label: "Sprache & Ton" },
  { key: "preis", label: "Preis & Positionierung" },
  { key: "kanaele", label: "Anfragen & Kanäle" },
  { key: "ziele", label: "Ziele & Weiterentwicklung" },
] as const;

export type AnbieterPointKey = (typeof ANBIETER_POINTS)[number]["key"];

export type WorkshopSourceKind = "raw" | "summary";

export type WorkshopSource = {
  id: string;
  title: string | null;
  filename: string | null;
  sourceKind: WorkshopSourceKind;
  spokenOn: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  rawText: string;
};

/** One side of a contradiction, with where and when it was said. */
export type AnbieterClaim = {
  text: string;
  source: string;
  date: string | null;
  /** Where the date comes from; „upload“ means the document itself states none. */
  dateOrigin?: DateOrigin;
  /** The claim from the latest source. It is marked, not chosen. */
  newest: boolean;
  ids: string[];
};

/** Sources disagree on one matter. Both claims stay; nobody picks one silently. */
export type AnbieterConflict = { topic: string; claims: AnbieterClaim[] };

export type AnbieterItem = {
  key: AnbieterPointKey;
  label: string;
  current: string;
  earlier: string | null;
  sources: string;
  /** IDs of the statements this point covers, contradictions included. */
  statementIds?: string[];
  conflicts?: AnbieterConflict[];
};

/** What the code found when it checked the evaluation against the Bestand. */
export type AnbieterReview = {
  statementCount: number;
  sourceCount: number;
  /** Statements no point lists. Shown, never dropped. */
  unassigned: Array<{ id: string; text: string; source: string }>;
  unassignedCount: number;
  /** Facts and names of the Bestand that the result does not show. */
  missingFacts: MissingFact[];
  /** Statements marked as not for publication. They are in no point. */
  internal: Array<{ id: string; text: string; source: string }>;
  /** What the internal notes mean for texts: prohibitions only, never the internal fact itself. */
  guardrails: Array<{ rule: string; ids: string[] }>;
  /** Statements an instruction removed on purpose; they are not reported again. */
  dismissedIds: string[];
  /** What the last „Änderung anwenden“ dropped although nobody asked for it. */
  lostInRevision: Array<{ id: string | null; text: string; source: string; point: string }>;
  /** The number each source carries in the statement IDs, by source id. It never changes or gets reused. */
  sourceNumbers: Record<string, number>;
  /** Hash of each source's text at the last run; tells a changed source from a new one. */
  sourceHashes: Record<string, string>;
  nextSourceNo: number;
};

/** What changed in the Bestand since the stand was written. */
export type AnbieterSync = {
  /** New sources, by label. Only these can be worked in without a full run. */
  added: string[];
  /** Sources whose text changed; they need a full run. */
  changed: string[];
  /** Sources that are gone and whose content is still in the stand. */
  removed: number;
};

export const REVIEW_UNASSIGNED_MAX = 1_000;

export type WorkshopSectionStatus = "empty" | "proposed" | "approved" | "stale";

export type AvatarCase = {
  service: string;
  summary: string;
  quotes: string[];
};

export type AvatarDossier = {
  narrative: string;
  quotes: string[];
  gaps: string[];
  pains: string;
  outcome: string;
} & Record<AvatarValueKey, string>;

/** One question of the avatar generator before it writes the prompt. */
export type AvatarRueckfrage = { block: string; frage: string; vorschlag: string };
/** The reviewer's answer to a Rückfrage; it counts before the summaries. */
export type AvatarAntwort = { block: string; frage: string; antwort: string };

/** What the generator derived or could not find; only the team sees it, never the avatar. */
export type AvatarGeneratorMeta = {
  abgeleitet: Array<{ block: string; aussage: string; grund: string }>;
  fehlende_daten: string[];
  zusatzbloecke: string[];
  offene_fragen: string[];
};

/** A finished result that broke a rule: kept so the team can see it, correct it and save it. */
export type AvatarGeneratorDraft = {
  promptTemplate: string;
  name: string;
  role: string;
  icon: string;
  quickActions: string[];
  meta: AvatarGeneratorMeta | null;
};

/**
 * The generator's state for one avatar of the plan (kept in `dt_workshop_corpus.avatar_plan`):
 * open Rückfragen, the answers given so far, the last validation errors with the rejected
 * draft, and the meta of the text that was saved to Agenten.
 */
export type AvatarGeneratorState = {
  status: "rueckfragen" | "fehler" | "fertig";
  rueckfragen: AvatarRueckfrage[];
  antworten: AvatarAntwort[];
  meta: AvatarGeneratorMeta | null;
  errors: string[];
  /** Only with status „fehler“: the result that was not saved. */
  draft: AvatarGeneratorDraft | null;
  updatedAt: string;
};

export type WorkshopAvatar = {
  key: string;
  title: string;
  whySeparate: string;
  cases: AvatarCase[];
  /** Avatar generator (Avatar-Plan → „Avatar erstellen“); null until it ran once. */
  generator: AvatarGeneratorState | null;
  dossier: AvatarDossier | null;
  preview: {
    name: string;
    role: string;
    summary: string;
    promptAppend: string;
  } | null;
  agentId: string | null;
};

export const REVISION_NOTE_MAX = 4_000;

export type AnbieterState = {
  status: WorkshopSectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  revisionNote: string;
  items: AnbieterItem[];
  /** When the points were last saved (an evaluation or a revision), ISO. Null for older rows. */
  savedAt: string | null;
  /**
   * Points that are empty although a source has a filled section under this very heading.
   * Derived from the sources on every load, never trusted from the saved row.
   */
  openWithSource: AnbieterOpenPoint[];
  /** Statements per chunk of source text. Server only; never sent to the browser. */
  extraction: ExtractionStore;
  /** Result of the coverage and fact check of the last run. Null for stands from before the check. */
  review: AnbieterReview | null;
  /** Derived on every load; never trusted from the saved row. */
  sync: AnbieterSync;
};

/** An empty point and the sources that carry a section with its name. */
export type AnbieterOpenPoint = { key: AnbieterPointKey; label: string; sources: string[] };

export type AvatarPlanState = {
  status: WorkshopSectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  revisionNote: string;
  notWanted: string;
  /** Set by the plan when the summaries separate fewer groups than the requested count. */
  hinweis: string;
  avatars: WorkshopAvatar[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, max: number): string {
  return asText(value, max);
}

function asText(value: unknown, max: number, depth = 0): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (Array.isArray(value)) {
    return value
      .map((part) => asText(part, max, depth + 1))
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
  }
  if (depth < 4) {
    const record = asRecord(value);
    if (record) {
      return Object.values(record)
        .map((part) => asText(part, max, depth + 1))
        .filter(Boolean)
        .join("\n")
        .slice(0, max);
    }
  }
  return "";
}

export function compareWorkshopSources(a: WorkshopSource, b: WorkshopSource): number {
  const aDate = a.spokenOn ?? "";
  const bDate = b.spokenOn ?? "";
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate < bDate ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function orderWorkshopSources(sources: WorkshopSource[]): WorkshopSource[] {
  return [...sources].sort(compareWorkshopSources);
}

export function corpusFingerprint(sources: WorkshopSource[]): string {
  const ordered = orderWorkshopSources(sources);
  const body = ordered
    .map((source) =>
      [
        source.id,
        source.spokenOn ?? "",
        source.updatedAt,
        source.sourceKind,
        source.summary ?? "",
        String(source.rawText.length),
      ].join("|"),
    )
    .join("\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

export function sourceLabel(source: WorkshopSource, index: number): string {
  const date = source.spokenOn ? source.spokenOn.split("-").reverse().join(".") : "ohne Datum";
  const title = source.title?.trim() || source.filename?.trim() || `Gespräch ${index + 1}`;
  return `${date} · ${title}`;
}

const POINT_TEXT_MAX = 24_000;

/** Readable corpus. Later conversations come last. The full wording is included. */
export function buildCorpusPrompt(sources: WorkshopSource[], options?: { rawChars?: number }): string {
  const rawChars = options?.rawChars;
  const ordered = orderWorkshopSources(sources);
  return ordered
    .map((source, index) => {
      const parts = [`## Gespräch ${index + 1}: ${sourceLabel(source, index)}`];
      const summary = source.summary?.trim() ?? "";
      const raw = source.rawText.trim();
      const wording = (text: string) =>
        rawChars != null && text.length > rawChars ? `${text.slice(0, rawChars)}\n…[gekürzt]` : text;
      if (summary) parts.push("", "### Zusammenfassung", summary);
      if (source.sourceKind === "raw" && raw && raw !== summary) {
        parts.push("", "### Wortlaut", wording(raw));
      } else if (!summary && raw) {
        parts.push("", wording(raw));
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

/** Conversations without a saved summary, in conversation order; they block plan and avatars. */
export function sourcesWithoutSummary(sources: WorkshopSource[]): Array<{ id: string; label: string }> {
  return orderWorkshopSources(sources)
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !source.summary?.trim())
    .map(({ source, index }) => ({ id: source.id, label: sourceLabel(source, index) }));
}

export function missingSummaryMessage(missing: Array<{ label: string }>): string {
  return `Diese Gespräche haben noch keine Zusammenfassung: ${missing.map((item) => item.label).join(", ")}. Bitte zuerst zusammenfassen.`;
}

/**
 * Input of the Avatar-Plan and the avatar generator: only the saved summaries, every
 * conversation in conversation order, plus the saved Anbieter points when there are any.
 * The raw wording is never sent.
 */
export function buildSummaryCorpusPrompt(
  sources: WorkshopSource[],
  anbieterItems: Array<Pick<AnbieterItem, "label" | "current">> = [],
): string {
  const conversations = orderWorkshopSources(sources).map((source, index) =>
    [`## Gespräch ${index + 1}: ${sourceLabel(source, index)}`, source.summary?.trim() || "(keine Zusammenfassung)"].join("\n"),
  );
  const points = anbieterItems
    .filter((item) => item.current.trim())
    .map((item) => `### ${item.label}\n${item.current.trim()}`);
  return [
    "# Zusammenfassungen der Gespräche (von alt nach neu)",
    ...conversations,
    points.length > 0 ? ["# Anbieterstand (gespeicherte Punkte)", ...points].join("\n\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compactPointName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "und")
    .replace(/[^a-z0-9]+/g, "");
}

function pointKeyFrom(value: string): AnbieterPointKey | null {
  const compact = compactPointName(value);
  if (!compact) return null;
  for (const point of ANBIETER_POINTS) {
    if (compact === point.key || compact === compactPointName(point.label)) {
      return point.key;
    }
  }
  const loose = ANBIETER_POINTS.filter((point) => compact.startsWith(point.key));
  if (loose.length !== 1) return null;
  const only = loose[0];
  if (!only) return null;
  return compact.length <= only.key.length + 16 ? only.key : null;
}

function itemCurrent(item: Record<string, unknown>): string {
  for (const key of ["current", "text", "stand", "inhalt", "fakt", "beschreibung", "value", "summary"]) {
    const text = asString(item[key], POINT_TEXT_MAX);
    if (text) return text;
  }
  let best = "";
  for (const [key, value] of Object.entries(item)) {
    if (key === "key" || key === "label" || key === "earlier" || key === "sources") continue;
    const text = asString(value, POINT_TEXT_MAX);
    if (text.length > best.length) best = text;
  }
  return best;
}

function explicitPointKey(item: Record<string, unknown>): AnbieterPointKey | null {
  for (const field of ["key", "label", "punkt", "name", "titel", "thema", "title"]) {
    const key = pointKeyFrom(asString(item[field], 160));
    if (key) return key;
  }
  return null;
}

function markdownRows(text: string): unknown[] {
  const parts = text.split(/\n(?=#{1,3}\s+)/);
  const rows: unknown[] = [];
  for (const part of parts) {
    const match = part.match(/^#{1,3}\s+([^\n]+)\n([\s\S]*)$/);
    if (!match) continue;
    const key = pointKeyFrom(match[1] ?? "");
    const current = (match[2] ?? "").trim();
    if (!key || !current) continue;
    rows.push({ key, current });
  }
  return rows;
}

function expandRow(row: unknown): unknown[] {
  if (typeof row === "string") {
    const fromHeadings = markdownRows(row);
    if (fromHeadings.length > 0) return fromHeadings;
    return row.trim() ? [{ key: "unternehmen", current: row.trim() }] : [];
  }
  const item = asRecord(row);
  if (!item) return [];
  const nested: unknown[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (!pointKeyFrom(key)) continue;
    const child = asRecord(value);
    nested.push(child ? { ...child, key } : { key, current: value });
  }
  if (nested.length > 0) return nested;
  const key = explicitPointKey(item);
  if (key) return [{ ...item, key }];
  const text = itemCurrent(item);
  const fromHeadings = markdownRows(text);
  if (fromHeadings.length > 0) return fromHeadings;
  if (text.trim()) return [{ key: "unternehmen", current: text.trim() }];
  return [];
}

function anbieterRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw.flatMap((row) => expandRow(row));
  const record = asRecord(raw);
  if (!record) return [];
  const rows: unknown[] = [];
  if (Array.isArray(record.items) && record.items.length > 0) {
    rows.push(...record.items.flatMap((row) => expandRow(row)));
  } else if (record.items && typeof record.items === "object") {
    rows.push(...anbieterRows(record.items));
  }
  if (Array.isArray(record.anbieter) && record.anbieter.length > 0) {
    rows.push(...record.anbieter.flatMap((row) => expandRow(row)));
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "items" || key === "anbieter") continue;
    if (!pointKeyFrom(key)) continue;
    const item = asRecord(value);
    rows.push(item ? { ...item, key } : { key, current: value });
  }
  for (const key of ["content", "text", "markdown", "anbieterMarkdown", "summary"]) {
    const text = asString(record[key], POINT_TEXT_MAX);
    if (text) rows.push(...expandRow(text));
  }
  return rows;
}

export function normalizeAnbieterItems(raw: unknown): AnbieterItem[] {
  const rows = anbieterRows(raw);
  const byKey = new Map<string, { current: string; earlier: string | null; sources: string }>();
  for (const row of rows) {
    const item = asRecord(row);
    if (!item) continue;
    const key = pointKeyFrom(asString(item.key, 120) || asString(item.label, 120));
    if (!key) continue;
    const current = itemCurrent(item);
    const earlier = asString(item.earlier, POINT_TEXT_MAX);
    const existing = byKey.get(key);
    let merged = current;
    if (existing?.current && current && existing.current !== current && !existing.current.includes(current)) {
      merged = `${existing.current}\n${current}`.slice(0, POINT_TEXT_MAX);
    } else if (!current) {
      merged = existing?.current ?? "";
    }
    if (!merged && !earlier) continue;
    byKey.set(key, {
      current: merged,
      earlier: (earlier && earlier !== merged ? earlier : null) || existing?.earlier || null,
      sources: asString(item.sources, 2_000) || existing?.sources || "",
    });
  }
  return ANBIETER_POINTS.map((point) => {
    const found = byKey.get(point.key);
    return {
      key: point.key,
      label: point.label,
      current: found?.current ?? "",
      earlier: found?.earlier ?? null,
      sources: found?.sources ?? "",
    };
  });
}

/** At most this many points go into one evaluation call, so a long early field cannot starve a later one. */
export const ANBIETER_EVAL_GROUP_SIZE = 4;

/** The points in checklist order, cut into evenly sized groups; one evaluation call fills one group. */
export function anbieterPointGroups(
  keys: readonly AnbieterPointKey[] = ANBIETER_POINTS.map((point) => point.key),
): AnbieterPointKey[][] {
  const wanted = new Set(keys);
  const ordered = ANBIETER_POINTS.map((point) => point.key).filter((key) => wanted.has(key));
  const count = Math.ceil(ordered.length / ANBIETER_EVAL_GROUP_SIZE);
  const groups: AnbieterPointKey[][] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const size = Math.ceil((ordered.length - start) / (count - i));
    groups.push(ordered.slice(start, start + size));
    start += size;
  }
  return groups;
}

/**
 * The points an instruction names by their full label („Preis & Positionierung“, also with
 * „und“ or without a joiner) or by a one-word label. A loose word like „Preis“ in a sentence
 * names no point; the model then decides which points the instruction touches.
 */
export function pointsNamedInInstruction(instruction: string): AnbieterPointKey[] {
  const compact = compactPointName(instruction);
  if (!compact) return [];
  return ANBIETER_POINTS.filter((point) => {
    const label = compactPointName(point.label);
    return compact.includes(label) || compact.includes(compactPointName(point.label.replace(/&/g, " ")));
  }).map((point) => point.key);
}

/** The point a heading line names: „## 11. Preis & Positionierung“, „**Preis & Positionierung**“, „Preis & Positionierung:“. */
function headingPointKey(line: string): AnbieterPointKey | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return null;
  const hashed = /^#{1,6}\s+/.test(trimmed);
  const name = trimmed
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[*_]+|[*_:\s]+$/g, "")
    .replace(/^(?:punkt\s+)?\d{1,2}\s*[.):-]\s*/i, "")
    .replace(/^[*_]+|[*_:\s]+$/g, "");
  const compact = compactPointName(name);
  if (!compact) return null;
  const exact = ANBIETER_POINTS.find(
    (point) => compact === compactPointName(point.label) || (hashed && compact === point.key),
  );
  return exact?.key ?? null;
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line.trim());
}

/** The points one text carries as a heading with text below it. */
function filledHeadingPoints(text: string): Set<AnbieterPointKey> {
  const found = new Set<AnbieterPointKey>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const key = headingPointKey(lines[i] ?? "");
    if (!key) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? "";
      if (!next.trim()) continue;
      if (isHeadingLine(next) || headingPointKey(next)) break;
      found.add(key);
      break;
    }
  }
  return found;
}

/**
 * Empty points for which a source has a filled section under exactly this heading. Such a
 * point is not „nobody said anything“: the evaluation lost it.
 */
export function openPointsWithSource(
  items: Pick<AnbieterItem, "key" | "current">[],
  sources: WorkshopSource[],
): AnbieterOpenPoint[] {
  const empty = new Set(items.filter((item) => !item.current.trim()).map((item) => item.key));
  if (empty.size === 0) return [];
  const byKey = new Map<AnbieterPointKey, string[]>();
  orderWorkshopSources(sources).forEach((source, index) => {
    const text = [source.summary ?? "", source.rawText].join("\n");
    for (const key of filledHeadingPoints(text)) {
      if (!empty.has(key)) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), sourceLabel(source, index)]);
    }
  });
  return ANBIETER_POINTS.filter((point) => byKey.has(point.key)).map((point) => ({
    key: point.key,
    label: point.label,
    sources: byKey.get(point.key) ?? [],
  }));
}

/**
 * A revision changes only what it was asked to change. A point the revision did not return
 * stays word for word. An empty answer deletes a point only when the instruction named it.
 */
export function mergeRevisedAnbieterItems(input: {
  current: AnbieterItem[];
  revised: AnbieterItem[];
  returned: readonly AnbieterPointKey[];
  named: readonly AnbieterPointKey[];
}): AnbieterItem[] {
  const returned = new Set(input.returned);
  const named = new Set(input.named);
  const revisedByKey = new Map(input.revised.map((item) => [item.key, item]));
  const currentByKey = new Map(input.current.map((item) => [item.key, item]));
  return ANBIETER_POINTS.map((point) => {
    const before =
      currentByKey.get(point.key) ??
      ({ key: point.key, label: point.label, current: "", earlier: null, sources: "" } satisfies AnbieterItem);
    const after = revisedByKey.get(point.key);
    if (!after || !returned.has(point.key)) return before;
    if (!after.current.trim() && !named.has(point.key)) return before;
    return {
      ...before,
      current: after.current,
      earlier: after.earlier ?? before.earlier,
      statementIds: after.statementIds ?? before.statementIds,
      conflicts: after.conflicts ?? before.conflicts,
    };
  });
}

export { buildCurrentAnbieterMarkdown };

export function sectionStatus(input: {
  fingerprint: string;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  hasContent: boolean;
}): WorkshopSectionStatus {
  if (!input.hasContent || !input.sourceFingerprint) return "empty";
  if (input.sourceFingerprint !== input.fingerprint) return "stale";
  if (input.approvedFingerprint && input.approvedFingerprint === input.fingerprint) return "approved";
  return "proposed";
}

function normalizeCases(raw: unknown): AvatarCase[] {
  if (!Array.isArray(raw)) return [];
  const cases: AvatarCase[] = [];
  for (const row of raw) {
    const record = asRecord(row);
    if (!record) continue;
    const summary = asString(record.summary, 8_000);
    if (!summary) continue;
    const quotes = Array.isArray(record.quotes)
      ? record.quotes.map((quote) => asString(quote, 2_000)).filter(Boolean).slice(0, 12)
      : [];
    cases.push({
      service: asString(record.service, 200),
      summary,
      quotes,
    });
    if (cases.length >= 8) break;
  }
  return cases;
}

export function normalizeAvatarPlan(raw: unknown, previous: WorkshopAvatar[] = []): AvatarPlanState["avatars"] {
  const record = asRecord(raw);
  const rows = Array.isArray(raw) ? raw : Array.isArray(record?.avatars) ? record.avatars : [];
  const previousByKey = new Map(previous.map((avatar) => [avatar.key, avatar]));
  const previousByTitle = new Map(previous.map((avatar) => [normalizePersonaKey(avatar.title), avatar]));
  const used = new Set<string>();
  const avatars: WorkshopAvatar[] = [];

  for (const row of rows) {
    const item = asRecord(row);
    if (!item) continue;
    const title = asString(item.title, 120);
    if (title.length < 2) continue;
    let key = slugFromPersonaName(asString(item.key, 48) || title);
    let n = 2;
    while (used.has(key)) {
      key = `${slugFromPersonaName(title).slice(0, 36)}_${n}`;
      n += 1;
    }
    used.add(key);
    const kept =
      previousByKey.get(key) ?? previousByTitle.get(normalizePersonaKey(title)) ?? null;
    avatars.push({
      key,
      title,
      whySeparate: asString(item.whySeparate ?? item.why_separate, 800),
      cases: normalizeCases(item.cases),
      generator: kept?.generator ?? null,
      dossier: kept?.dossier ?? null,
      preview: kept?.preview ?? null,
      agentId: kept?.agentId ?? null,
    });
    if (avatars.length >= AVATAR_PLAN_MAX) break;
  }
  return avatars;
}

function dossierField(record: Record<string, unknown>, key: string, alias?: string): string {
  const primary = asString(record[key], 8_000);
  if (primary) return primary;
  return alias ? asString(record[alias], 8_000) : "";
}

export function normalizeDossier(raw: unknown): WorkshopAvatar["dossier"] {
  const record = asRecord(raw);
  if (!record) return null;
  const narrative = asString(record.narrative, POINT_TEXT_MAX);
  const schmerz = dossierField(record, "schmerz", "pains");
  const traumergebnis = dossierField(record, "traumergebnis", "outcome");
  const dringlichkeit = dossierField(record, "dringlichkeit");
  const huerde = dossierField(record, "huerde");
  const aufwand = dossierField(record, "aufwand");
  const zeit = dossierField(record, "zeit");
  const wahrscheinlichkeit = dossierField(record, "wahrscheinlichkeit");
  const quotes = Array.isArray(record.quotes)
    ? record.quotes.map((quote) => asString(quote, 2_000)).filter(Boolean).slice(0, 24)
    : [];
  const gapSource = Array.isArray(record.gaps)
    ? record.gaps
    : Array.isArray(record.offen)
      ? record.offen
      : [];
  const gaps = gapSource.map((gap) => asString(gap, 1_000)).filter(Boolean).slice(0, 24);
  const filled = [
    narrative,
    schmerz,
    traumergebnis,
    dringlichkeit,
    huerde,
    aufwand,
    zeit,
    wahrscheinlichkeit,
    ...quotes,
    ...gaps,
  ].some((part) => part.trim());
  if (!filled) return null;
  return {
    narrative,
    schmerz,
    traumergebnis,
    dringlichkeit,
    huerde,
    aufwand,
    zeit,
    wahrscheinlichkeit,
    pains: schmerz,
    outcome: traumergebnis,
    quotes,
    gaps,
  };
}

export function normalizePreview(raw: unknown): WorkshopAvatar["preview"] {
  const record = asRecord(raw);
  if (!record) return null;
  const name = avatarFirstName(asString(record.name, 80));
  const promptAppend = ensureAvatarIntroducesSelf(
    name,
    asString(record.promptAppend ?? record.prompt_append, 32_000),
  );
  if (name.length < 2 || promptAppend.length < 80) return null;
  return {
    name,
    role: avatarShortRole(asString(record.role, 200)),
    summary: asString(record.summary, 800),
    promptAppend,
  };
}

export function formatRevisionBlock(instruction: string, current: string): string {
  const note = instruction.trim().slice(0, REVISION_NOTE_MAX);
  if (!note) return "";
  const parts = [
    "Anweisung der prüfenden Person. Sie gilt für genau die Punkte, die sie nennt, auch wenn ein Gespräch anders klingt.",
    "Nichts darüber hinaus erfinden. Alles andere bleibt aus dem Bestand.",
    note,
  ];
  if (current.trim()) parts.push("", "Bisheriger Vorschlag:", current.trim());
  return parts.join("\n");
}

export function describeAnbieterStand(items: AnbieterItem[]): string {
  return items
    .filter((item) => item.current.trim())
    .map((item) => `## ${item.label}\n${item.current.trim()}`)
    .join("\n\n");
}

export function describeAvatarStand(plan: Pick<AvatarPlanState, "notWanted" | "avatars">): string {
  return [
    plan.notWanted.trim() ? `Nicht als Kunden gewollt:\n${plan.notWanted.trim()}` : "",
    ...plan.avatars.map((avatar, index) => {
      const cases = avatar.cases
        .map((item) => `- ${item.service ? `${item.service}: ` : ""}${item.summary}`.trim())
        .filter((line) => line !== "-");
      return [`Avatar ${index + 1}: ${avatar.title}`, avatar.whySeparate.trim(), ...cases]
        .filter(Boolean)
        .join("\n");
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Open matters a reviewer should have seen before approving. */
export function anbieterOpenIssues(state: Pick<AnbieterState, "items" | "review">): {
  missingFacts: number;
  conflicts: number;
} {
  return {
    missingFacts: state.review?.missingFacts.length ?? 0,
    conflicts: state.items.reduce((sum, item) => sum + (item.conflicts?.length ?? 0), 0),
  };
}

/** The state as the browser gets it: without the stored statements of stage 1. */
export function anbieterForClient(state: AnbieterState): Omit<AnbieterState, "extraction"> {
  const { extraction: _extraction, ...rest } = state;
  void _extraction;
  return rest;
}

export function emptyAnbieterState(): AnbieterState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
    revisionNote: "",
    items: normalizeAnbieterItems([]),
    savedAt: null,
    openWithSource: [],
    extraction: {},
    review: null,
    sync: { added: [], changed: [], removed: 0 },
  };
}

export function emptyAvatarPlan(): AvatarPlanState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
    revisionNote: "",
    notWanted: "",
    hinweis: "",
    avatars: [],
  };
}

function textList(raw: unknown, max: number, itemMax: number): string[] {
  return Array.isArray(raw) ? raw.map((item) => asString(item, itemMax)).filter(Boolean).slice(0, max) : [];
}

export function normalizeGeneratorMeta(raw: unknown): AvatarGeneratorMeta | null {
  const record = asRecord(raw);
  if (!record) return null;
  const abgeleitet = Array.isArray(record.abgeleitet)
    ? record.abgeleitet
        .map((row) => {
          const item = asRecord(row);
          if (!item) return null;
          const aussage = asString(item.aussage, 2_000);
          if (!aussage) return null;
          return { block: asString(item.block, 200), aussage, grund: asString(item.grund, 2_000) };
        })
        .filter((row): row is { block: string; aussage: string; grund: string } => Boolean(row))
        .slice(0, 60)
    : [];
  return {
    abgeleitet,
    fehlende_daten: textList(record.fehlende_daten, 60, 1_000),
    zusatzbloecke: textList(record.zusatzbloecke, 30, 200),
    offene_fragen: textList(record.offene_fragen, 60, 1_000),
  };
}

export function normalizeRueckfragen(raw: unknown): AvatarRueckfrage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = asRecord(row);
      if (!item) return null;
      const frage = asString(item.frage, 2_000);
      if (!frage) return null;
      return { block: asString(item.block, 200), frage, vorschlag: asString(item.vorschlag, 2_000) };
    })
    .filter((row): row is AvatarRueckfrage => Boolean(row))
    .slice(0, 40);
}

export function normalizeAntworten(raw: unknown): AvatarAntwort[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = asRecord(row);
      if (!item) return null;
      const frage = asString(item.frage, 2_000);
      const antwort = asString(item.antwort, 4_000);
      if (!frage || !antwort) return null;
      return { block: asString(item.block, 200), frage, antwort };
    })
    .filter((row): row is AvatarAntwort => Boolean(row))
    .slice(-80);
}

/** Later answers to the same question replace earlier ones; order of first appearance stays. */
export function mergeAntworten(earlier: AvatarAntwort[], later: AvatarAntwort[]): AvatarAntwort[] {
  const key = (item: AvatarAntwort) => `${item.block.trim().toLowerCase()}|${item.frage.trim().toLowerCase()}`;
  const byKey = new Map<string, AvatarAntwort>();
  for (const item of [...earlier, ...later]) byKey.set(key(item), item);
  return [...byKey.values()].slice(-80);
}

export function normalizeGeneratorDraft(raw: unknown): AvatarGeneratorDraft | null {
  const record = asRecord(raw);
  if (!record) return null;
  const promptTemplate = typeof record.promptTemplate === "string" ? record.promptTemplate.trim().slice(0, 60_000) : "";
  if (!promptTemplate) return null;
  return {
    promptTemplate,
    name: asString(record.name, 80),
    role: asString(record.role, 200),
    icon: asString(record.icon, 16),
    quickActions: textList(record.quickActions, 12, 160),
    meta: normalizeGeneratorMeta(record.meta),
  };
}

export function normalizeGeneratorState(raw: unknown): AvatarGeneratorState | null {
  const record = asRecord(raw);
  if (!record) return null;
  const status = record.status === "rueckfragen" || record.status === "fehler" || record.status === "fertig" ? record.status : null;
  if (!status) return null;
  return {
    status,
    rueckfragen: normalizeRueckfragen(record.rueckfragen),
    antworten: normalizeAntworten(record.antworten),
    meta: normalizeGeneratorMeta(record.meta),
    errors: textList(record.errors, 40, 1_000),
    draft: status === "fehler" ? normalizeGeneratorDraft(record.draft) : null,
    updatedAt: asString(record.updatedAt, 40),
  };
}

function idList(raw: unknown, max: number): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && /^\d{1,3}\.\d{1,4}$/.test(id)).slice(0, max)
    : [];
}

const DATE_ORIGINS: readonly DateOrigin[] = ["gespraech", "dokument", "dateiname", "upload"];

function readConflicts(raw: unknown): AnbieterConflict[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      const claims = (Array.isArray(record?.claims) ? record.claims : [])
        .map((claim) => {
          const c = asRecord(claim);
          return {
            text: asString(c?.text, 4_000),
            source: asString(c?.source, 400),
            date: asString(c?.date, 20) || null,
            ...(DATE_ORIGINS.includes(c?.dateOrigin as DateOrigin) ? { dateOrigin: c?.dateOrigin as DateOrigin } : {}),
            newest: c?.newest === true,
            ids: idList(c?.ids, 200),
          };
        })
        .filter((claim) => claim.text);
      return { topic: asString(record?.topic, 400), claims };
    })
    .filter((conflict) => conflict.claims.length >= 2)
    .slice(0, 40);
}

/** Statement IDs and contradictions sit on the saved rows; the tolerant reader above only knows texts. */
function withItemExtras(items: AnbieterItem[], rawItems: unknown): AnbieterItem[] {
  if (!Array.isArray(rawItems)) return items;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rawItems) {
    const record = asRecord(row);
    if (record && typeof record.key === "string") byKey.set(record.key, record);
  }
  return items.map((item) => {
    const row = byKey.get(item.key);
    if (!row) return item;
    const statementIds = idList(row.statementIds, 5_000);
    const conflicts = readConflicts(row.conflicts);
    return {
      ...item,
      ...(statementIds.length > 0 ? { statementIds } : {}),
      ...(conflicts.length > 0 ? { conflicts } : {}),
    };
  });
}

function readExtraction(raw: unknown): ExtractionStore {
  const record = asRecord(raw);
  if (!record) return {};
  const store: ExtractionStore = {};
  for (const [hash, value] of Object.entries(record)) {
    const chunk = asRecord(value);
    if (!chunk || !/^[0-9a-f]{32}$/.test(hash)) continue;
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
    const statements = strings(chunk.statements);
    const internal = Array.isArray(chunk.internal)
      ? chunk.internal.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < statements.length)
      : [];
    store[hash] = { statements, names: strings(chunk.names), internal };
  }
  return store;
}

function readReview(raw: unknown): AnbieterReview | null {
  const record = asRecord(raw);
  if (!record) return null;
  const rows = (list: unknown) => (Array.isArray(list) ? list.map(asRecord).filter((row) => row != null) : []);
  const unassigned = rows(record.unassigned)
    .map((row) => ({ id: asString(row.id, 12), text: asString(row.text, 2_000), source: asString(row.source, 400) }))
    .filter((row) => row.id && row.text)
    .slice(0, REVIEW_UNASSIGNED_MAX);
  const internal = rows(record.internal)
    .map((row) => ({ id: asString(row.id, 12), text: asString(row.text, 2_000), source: asString(row.source, 400) }))
    .filter((row) => row.id && row.text)
    .slice(0, REVIEW_UNASSIGNED_MAX);
  const guardrails = rows(record.guardrails)
    .map((row) => ({ rule: asString(row.rule, 400), ids: idList(row.ids, 400) }))
    .filter((row) => row.rule)
    .slice(0, 200);
  const missingFacts = rows(record.missingFacts)
    .map((row) => ({
      kind: asString(row.kind, 20) as FactKind,
      value: asString(row.value, 400),
      sources: Array.isArray(row.sources) ? row.sources.map((source) => asString(source, 400)).filter(Boolean) : [],
      context: asString(row.context, 600),
    }))
    .filter((row) => row.value && row.kind in FACT_KIND_LABEL)
    .slice(0, MISSING_FACTS_MAX);
  const lostInRevision = rows(record.lostInRevision)
    .map((row) => ({
      id: asString(row.id, 12) || null,
      text: asString(row.text, 2_000),
      source: asString(row.source, 400),
      point: asString(row.point, 200),
    }))
    .filter((row) => row.text)
    .slice(0, 400);
  const count = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  const numbers = Object.fromEntries(
    Object.entries(asRecord(record.sourceNumbers) ?? {}).filter(
      (entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0,
    ),
  );
  return {
    statementCount: count(record.statementCount, 0),
    sourceCount: count(record.sourceCount, 0),
    unassigned,
    unassignedCount: Math.max(count(record.unassignedCount, 0), unassigned.length),
    missingFacts,
    internal,
    guardrails,
    dismissedIds: idList(record.dismissedIds, 5_000),
    lostInRevision,
    sourceNumbers: numbers,
    sourceHashes: Object.fromEntries(
      Object.entries(asRecord(record.sourceHashes) ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] in numbers,
      ),
    ),
    nextSourceNo: Math.max(count(record.nextSourceNo, 1), ...Object.values(numbers).map((n) => n + 1), 1),
  };
}

export function readAnbieterState(
  raw: unknown,
  fingerprint: string,
  sources: WorkshopSource[] = [],
): AnbieterState {
  const record = asRecord(raw);
  const items = withItemExtras(normalizeAnbieterItems(record?.items), record?.items);
  const hasContent = items.some((item) => item.current.trim() || item.earlier);
  const sourceFingerprint = asString(record?.sourceFingerprint, 40) || null;
  const approvedFingerprint = asString(record?.approvedFingerprint, 40) || null;
  const savedAt = asString(record?.savedAt, 40);
  return {
    items,
    sourceFingerprint,
    approvedFingerprint,
    revisionNote: asString(record?.revisionNote, REVISION_NOTE_MAX),
    savedAt: savedAt && Number.isFinite(Date.parse(savedAt)) ? savedAt : null,
    openWithSource: hasContent ? openPointsWithSource(items, sources) : [],
    extraction: readExtraction(record?.extraction),
    review: hasContent ? readReview(record?.review) : null,
    sync: { added: [], changed: [], removed: 0 },
    status: sectionStatus({
      fingerprint,
      sourceFingerprint,
      approvedFingerprint,
      hasContent,
    }),
  };
}

/** Drop agent links that no longer point at a live row. Same plan object when nothing changes. */
export function forgetMissingAvatarAgents(
  plan: AvatarPlanState,
  liveAgentIds: ReadonlySet<string>,
): AvatarPlanState {
  let changed = false;
  const avatars = plan.avatars.map((avatar) => {
    if (!avatar.agentId || liveAgentIds.has(avatar.agentId)) return avatar;
    changed = true;
    return { ...avatar, agentId: null };
  });
  if (!changed) return plan;
  return { ...plan, avatars };
}

export function isMissingAgentError(message: string): boolean {
  return message.toLowerCase().includes("agent_not_found");
}

export function readAvatarPlan(raw: unknown, fingerprint: string): AvatarPlanState {
  const record = asRecord(raw);
  const avatars = normalizeAvatarPlan(record?.avatars ?? [], []);
  const restored = avatars.map((avatar) => {
    const original = Array.isArray(record?.avatars)
      ? record.avatars.find((row) => asRecord(row)?.key === avatar.key || asString(asRecord(row)?.title, 120) === avatar.title)
      : null;
    const item = asRecord(original);
    return {
      ...avatar,
      generator: normalizeGeneratorState(item?.generator),
      dossier: normalizeDossier(item?.dossier),
      preview: normalizePreview(item?.preview),
      agentId: asString(item?.agentId, 80) || null,
    };
  });
  const hasContent = restored.length > 0 || Boolean(asString(record?.notWanted, 10));
  const sourceFingerprint = asString(record?.sourceFingerprint, 40) || null;
  const approvedFingerprint = asString(record?.approvedFingerprint, 40) || null;
  return {
    avatars: restored,
    notWanted: asString(record?.notWanted, 8_000),
    hinweis: asString(record?.hinweis, 2_000),
    revisionNote: asString(record?.revisionNote, REVISION_NOTE_MAX),
    sourceFingerprint,
    approvedFingerprint,
    status: sectionStatus({
      fingerprint,
      sourceFingerprint,
      approvedFingerprint,
      hasContent,
    }),
  };
}
