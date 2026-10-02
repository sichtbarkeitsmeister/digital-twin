import { createHash } from "node:crypto";

import type { AvatarValueKey } from "@/lib/dt/transcripts/avatar-value";
import { normalizePersonaKey, slugFromPersonaName } from "@/lib/dt/transcripts/sanitize";

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

export type AnbieterItem = {
  key: AnbieterPointKey;
  label: string;
  current: string;
  earlier: string | null;
  sources: string;
};

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

export type WorkshopAvatar = {
  key: string;
  title: string;
  whySeparate: string;
  cases: AvatarCase[];
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
};

export type AvatarPlanState = {
  status: WorkshopSectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  revisionNote: string;
  notWanted: string;
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
    nested.push(child ? { key, ...child, key } : { key, current: value });
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
    rows.push(item ? { key, ...item, key } : { key, current: value });
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

export function buildCurrentAnbieterMarkdown(input: {
  organisationName: string;
  items: AnbieterItem[];
}): string {
  const filled = input.items.filter((item) => item.current.trim());
  const open = input.items.filter((item) => !item.current.trim());
  const lines = [
    `Organisation: ${input.organisationName}`,
    "Dies ist der aktuelle Stand aus allen Workshops und Gesprächen.",
    "Spätere Aussagen haben frühere zum selben Punkt ersetzt. Nur diesen Stand verwenden. Nichts ergänzen, was hier nicht steht.",
    "",
  ];
  for (const item of filled) {
    lines.push(`## ${item.label}`, item.current.trim(), "");
  }
  if (open.length > 0) {
    lines.push(
      "## Noch offen",
      "Diese Punkte wurden nicht belegt. Nicht erfinden:",
      ...open.map((item) => `- ${item.label}`),
    );
  }
  return lines.join("\n").trim();
}

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
      dossier: kept?.dossier ?? null,
      preview: kept?.preview ?? null,
      agentId: kept?.agentId ?? null,
    });
    if (avatars.length >= 6) break;
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
  const name = asString(record.name, 120);
  const promptAppend = asString(record.promptAppend ?? record.prompt_append, 32_000);
  if (name.length < 2 || promptAppend.length < 80) return null;
  return {
    name,
    role: asString(record.role, 200),
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

export function emptyAnbieterState(): AnbieterState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
    revisionNote: "",
    items: normalizeAnbieterItems([]),
  };
}

export function emptyAvatarPlan(): AvatarPlanState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
    revisionNote: "",
    notWanted: "",
    avatars: [],
  };
}

export function readAnbieterState(raw: unknown, fingerprint: string): AnbieterState {
  const record = asRecord(raw);
  const items = normalizeAnbieterItems(record?.items);
  const hasContent = items.some((item) => item.current.trim() || item.earlier);
  const sourceFingerprint = asString(record?.sourceFingerprint, 40) || null;
  const approvedFingerprint = asString(record?.approvedFingerprint, 40) || null;
  return {
    items,
    sourceFingerprint,
    approvedFingerprint,
    revisionNote: asString(record?.revisionNote, REVISION_NOTE_MAX),
    status: sectionStatus({
      fingerprint,
      sourceFingerprint,
      approvedFingerprint,
      hasContent,
    }),
  };
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
