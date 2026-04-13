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

export function isRankingAnswerValid(raw: unknown, presetLabels: string[], required: boolean): boolean {
  const state = coerceRankingState(raw, presetLabels);

  for (const it of state.items) {
    if (it.kind === "custom" && !it.label.trim()) return false;
  }

  if (!required) return true;
  return state.items.length > 0;
}

export function formatRankingAnswerForDisplay(raw: unknown, presetLabels: string[]): string {
  const { items } = coerceRankingState(raw, presetLabels);
  if (items.length === 0) return "";
  return items
    .map((it, idx) => {
      const text = it.kind === "preset" ? it.label : it.label.trim() || "(ohne Text)";
      return `${idx + 1}. ${text}`;
    })
    .join(", ");
}
