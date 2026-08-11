export type RankingItem =
  | { kind: "preset"; label: string }
  | { kind: "custom"; id: string; label: string };

export type RankingAnswerPayload = {
  excludedPresets: string[];
  items: RankingItem[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isRankingPayload(v: unknown): v is RankingAnswerPayload {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.items)) return false;
  if (v.excludedPresets !== undefined && !Array.isArray(v.excludedPresets)) return false;
  return true;
}

export function rankingItemKey(item: RankingItem): string {
  return item.kind === "preset" ? `p:${item.label}` : `c:${item.id}`;
}

/** Stable key for drag state (labels may contain special characters). */
export function encodeRankingDragKey(item: RankingItem): string {
  return item.kind === "preset"
    ? `p:${encodeURIComponent(item.label)}`
    : `c:${encodeURIComponent(item.id)}`;
}

export function coerceRankingState(raw: unknown, presetLabels: string[]): RankingAnswerPayload {
  const presetSet = new Set(presetLabels);

  if (isRankingPayload(raw)) {
    const excluded = Array.isArray(raw.excludedPresets)
      ? raw.excludedPresets.filter((x): x is string => typeof x === "string" && presetSet.has(x))
      : [];

    const items: RankingItem[] = [];
    for (const entry of raw.items) {
      if (!isRecord(entry)) continue;
      if (entry.kind === "preset" && typeof entry.label === "string" && presetSet.has(entry.label)) {
        if (excluded.includes(entry.label)) continue;
        items.push({ kind: "preset", label: entry.label });
      }
      if (entry.kind === "custom" && typeof entry.id === "string" && entry.id.length > 0) {
        const label = typeof entry.label === "string" ? entry.label : "";
        items.push({ kind: "custom", id: entry.id, label });
      }
    }

    const seen = new Set<string>();
    const deduped: RankingItem[] = [];
    for (const it of items) {
      const k = rankingItemKey(it);
      if (seen.has(k)) continue;
      if (it.kind === "preset" && excluded.includes(it.label)) continue;
      seen.add(k);
      deduped.push(it);
    }

    for (const label of presetLabels) {
      if (excluded.includes(label)) continue;
      if (!deduped.some((i) => i.kind === "preset" && i.label === label)) {
        deduped.push({ kind: "preset", label });
      }
    }

    return { excludedPresets: excluded, items: deduped };
  }

  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    const arr = raw as string[];
    const items: RankingItem[] = [];
    for (const label of arr) {
      if (!presetSet.has(label)) continue;
      if (items.some((i) => i.kind === "preset" && i.label === label)) continue;
      items.push({ kind: "preset", label });
    }
    for (const label of presetLabels) {
      if (!items.some((i) => i.kind === "preset" && i.label === label)) {
        items.push({ kind: "preset", label });
      }
    }
    return { excludedPresets: [], items };
  }

  return {
    excludedPresets: [],
    items: presetLabels.map((label) => ({ kind: "preset", label })),
  };
}

export function toRankingPayload(state: RankingAnswerPayload): RankingAnswerPayload {
  return {
    excludedPresets: [...state.excludedPresets],
    items: state.items.map((it) =>
      it.kind === "preset" ? { ...it } : { ...it, label: it.label },
    ),
  };
}

export function reorderRankingItems(items: RankingItem[], fromIndex: number, toIndex: number): RankingItem[] {
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function togglePresetInRanking(
  state: RankingAnswerPayload,
  label: string,
  include: boolean,
  presetLabels: string[],
): RankingAnswerPayload {
  const base = coerceRankingState(toRankingPayload(state), presetLabels);
  if (!presetLabels.includes(label)) return base;

  if (include) {
    const excluded = base.excludedPresets.filter((l) => l !== label);
    let items = [...base.items];
    if (!items.some((i) => i.kind === "preset" && i.label === label)) {
      items = [...items, { kind: "preset", label }];
    }
    return { excludedPresets: excluded, items };
  }

  const excluded = base.excludedPresets.includes(label)
    ? base.excludedPresets
    : [...base.excludedPresets, label];
  const items = base.items.filter((i) => !(i.kind === "preset" && i.label === label));
  return { excludedPresets: excluded, items };
}

export function addCustomRankingItem(state: RankingAnswerPayload, presetLabels: string[]): RankingAnswerPayload {
  const base = coerceRankingState(toRankingPayload(state), presetLabels);
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    ...base,
    items: [...base.items, { kind: "custom", id, label: "" }],
  };
}

export function removeCustomRankingItem(
  state: RankingAnswerPayload,
  id: string,
  presetLabels: string[],
): RankingAnswerPayload {
  const base = coerceRankingState(toRankingPayload(state), presetLabels);
  return {
    ...base,
    items: base.items.filter((i) => !(i.kind === "custom" && i.id === id)),
  };
}

export function setCustomRankingLabel(
  state: RankingAnswerPayload,
  id: string,
  label: string,
  presetLabels: string[],
): RankingAnswerPayload {
  const base = coerceRankingState(toRankingPayload(state), presetLabels);
  return {
    ...base,
    items: base.items.map((i) => (i.kind === "custom" && i.id === id ? { ...i, label } : i)),
  };
}

/**
 * True only when a ranking answer was actually stored.
 * Missing/empty values must NOT fall through to coerceRankingState's default
 * (all form options in definition order) — that invents fake rankings.
 */
export function hasStoredRankingAnswer(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (Array.isArray(raw)) {
    return raw.length > 0 && raw.every((x) => typeof x === "string");
  }
  if (isRankingPayload(raw)) {
    return raw.items.length > 0;
  }
  return false;
}

export function isRankingAnswerValid(raw: unknown, presetLabels: string[], required: boolean): boolean {
  if (!hasStoredRankingAnswer(raw)) {
    return !required;
  }

  const state = coerceRankingState(raw, presetLabels);

  for (const it of state.items) {
    if (it.kind === "custom" && !it.label.trim()) return false;
  }

  return state.items.length > 0;
}

export type RankingOptionRef = { id: string; label: string };

/**
 * Resolve a stored ranking for export/context — never invents form-definition order.
 * Supports payload format, label arrays, and option-id arrays.
 */
export function resolveRankingExport(
  raw: unknown,
  options: RankingOptionRef[],
): { ranked: string[]; excluded: string[] } | null {
  if (!hasStoredRankingAnswer(raw)) return null;

  const presets = options.map((o) => o.label);
  const presetSet = new Set(presets);
  const labelById = new Map(options.map((o) => [o.id, o.label]));

  function resolveToken(token: string): string | null {
    if (presetSet.has(token)) return token;
    const viaId = labelById.get(token);
    return viaId ?? null;
  }

  if (isRankingPayload(raw)) {
    const ranked: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw.items) {
      if (!isRecord(entry)) continue;
      if (entry.kind === "preset" && typeof entry.label === "string") {
        const label = resolveToken(entry.label);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        ranked.push(label);
        continue;
      }
      if (entry.kind === "custom" && typeof entry.id === "string") {
        const label = typeof entry.label === "string" ? entry.label.trim() : "";
        if (!label || seen.has(`c:${entry.id}`)) continue;
        seen.add(`c:${entry.id}`);
        ranked.push(label);
      }
    }
    if (ranked.length === 0) return null;

    const excludedFromPayload = Array.isArray(raw.excludedPresets)
      ? raw.excludedPresets.filter((x): x is string => typeof x === "string" && presetSet.has(x))
      : [];
    const excluded =
      excludedFromPayload.length > 0
        ? excludedFromPayload
        : presets.filter((label) => !ranked.includes(label));

    return { ranked, excluded };
  }

  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    const ranked: string[] = [];
    const seen = new Set<string>();
    for (const token of raw as string[]) {
      const label = resolveToken(token);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      ranked.push(label);
    }
    if (ranked.length === 0) return null;
    return {
      ranked,
      excluded: presets.filter((label) => !ranked.includes(label)),
    };
  }

  if (typeof raw === "string" && raw.trim()) {
    // Rare legacy: single string — keep as one custom rank entry.
    return { ranked: [raw.trim()], excluded: presets };
  }

  return null;
}

/** Inline display (UI chips / short previews). Does not invent unanswered rankings. */
export function formatRankingAnswerForDisplay(raw: unknown, presetLabels: string[]): string {
  const resolved = resolveRankingExport(
    raw,
    presetLabels.map((label) => ({ id: label, label })),
  );
  if (!resolved || resolved.ranked.length === 0) return "";
  return resolved.ranked.map((text, idx) => `${idx + 1}. ${text}`).join(", ");
}

/**
 * Knowledge / agent context: numbered list, correct order, excluded options explicit.
 * Pass full field options so option-id answers resolve to labels.
 */
export function formatRankingAnswerForKnowledge(
  raw: unknown,
  options: RankingOptionRef[],
): string {
  const resolved = resolveRankingExport(raw, options);
  if (!resolved || resolved.ranked.length === 0) return "";

  const lines = [
    "Rangfolge (1 = höchste Priorität):",
    ...resolved.ranked.map((text, idx) => `${idx + 1}. ${text}`),
  ];
  if (resolved.excluded.length > 0) {
    lines.push(`Nicht gewählt: ${resolved.excluded.join("; ")}`);
  }
  return lines.join("\n");
}
