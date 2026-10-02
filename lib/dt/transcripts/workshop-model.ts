import { createHash } from "node:crypto";

import { normalizePersonaKey, slugFromPersonaName } from "@/lib/dt/transcripts/sanitize";

export const WORKSHOP_CORPUS_START = "<!-- DT_WORKSHOP_CORPUS_START -->";
export const WORKSHOP_CORPUS_END = "<!-- DT_WORKSHOP_CORPUS_END -->";

export const ANBIETER_POINTS = [
  { key: "unternehmen", label: "Unternehmen & Kern" },
  { key: "gruendung", label: "Gründungsgeschichte" },
  { key: "leistungen", label: "Leistungen & Schwerpunkte" },
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

export type WorkshopAvatar = {
  key: string;
  title: string;
  whySeparate: string;
  cases: AvatarCase[];
  dossier: {
    narrative: string;
    pains: string;
    outcome: string;
    quotes: string[];
    gaps: string[];
  } | null;
  preview: {
    name: string;
    role: string;
    summary: string;
    promptAppend: string;
  } | null;
  agentId: string | null;
};

export type AnbieterState = {
  status: WorkshopSectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
  items: AnbieterItem[];
};

export type AvatarPlanState = {
  status: WorkshopSectionStatus;
  sourceFingerprint: string | null;
  approvedFingerprint: string | null;
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

function asText(value: unknown, max: number): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" || typeof part === "number" ? asText(part, max) : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
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

/** Readable corpus. Later conversations come last so the model treats them as the current word. */
export function buildCorpusPrompt(sources: WorkshopSource[], options?: { rawChars?: number }): string {
  const rawChars = options?.rawChars ?? 8_000;
  const ordered = orderWorkshopSources(sources);
  return ordered
    .map((source, index) => {
      const parts = [`## Gespräch ${index + 1}: ${sourceLabel(source, index)}`];
      const summary = source.summary?.trim() ?? "";
      const raw = source.rawText.trim();
      if (summary) parts.push("", "### Zusammenfassung", summary);
      if (source.sourceKind === "raw" && raw && raw !== summary) {
        const clipped = raw.length > rawChars ? `${raw.slice(0, rawChars)}\n…[gekürzt]` : raw;
        parts.push("", "### Wortlaut", clipped);
      } else if (!summary && raw) {
        const clipped = raw.length > rawChars ? `${raw.slice(0, rawChars)}\n…[gekürzt]` : raw;
        parts.push("", clipped);
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
  return null;
}

export function normalizeAnbieterItems(raw: unknown): AnbieterItem[] {
  const record = asRecord(raw);
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.anbieter)
        ? record.anbieter
        : [];
  const byKey = new Map<string, { current: string; earlier: string | null; sources: string }>();
  for (const row of rows) {
    const item = asRecord(row);
    if (!item) continue;
    const key = pointKeyFrom(asString(item.key, 80) || asString(item.label, 80));
    if (!key) continue;
    const current = asString(item.current ?? item.text ?? item.stand, 2000);
    const earlier = asString(item.earlier, 2000);
    byKey.set(key, {
      current,
      earlier: earlier && earlier !== current ? earlier : null,
      sources: asString(item.sources, 400),
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
    const summary = asString(record.summary, 1500);
    if (!summary) continue;
    const quotes = Array.isArray(record.quotes)
      ? record.quotes.map((quote) => asString(quote, 400)).filter(Boolean).slice(0, 5)
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

export function normalizeDossier(raw: unknown): WorkshopAvatar["dossier"] {
  const record = asRecord(raw);
  if (!record) return null;
  const narrative = asString(record.narrative, 4000);
  if (!narrative) return null;
  const quotes = Array.isArray(record.quotes)
    ? record.quotes.map((quote) => asString(quote, 400)).filter(Boolean).slice(0, 8)
    : [];
  const gaps = Array.isArray(record.gaps)
    ? record.gaps.map((gap) => asString(gap, 300)).filter(Boolean).slice(0, 12)
    : [];
  return {
    narrative,
    pains: asString(record.pains, 1500),
    outcome: asString(record.outcome, 1500),
    quotes,
    gaps,
  };
}

export function normalizePreview(raw: unknown): WorkshopAvatar["preview"] {
  const record = asRecord(raw);
  if (!record) return null;
  const name = asString(record.name, 120);
  const promptAppend = asString(record.promptAppend ?? record.prompt_append, 12_000);
  if (name.length < 2 || promptAppend.length < 80) return null;
  return {
    name,
    role: asString(record.role, 200),
    summary: asString(record.summary, 800),
    promptAppend,
  };
}

export function emptyAnbieterState(): AnbieterState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
    items: normalizeAnbieterItems([]),
  };
}

export function emptyAvatarPlan(): AvatarPlanState {
  return {
    status: "empty",
    sourceFingerprint: null,
    approvedFingerprint: null,
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
    notWanted: asString(record?.notWanted, 2000),
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
