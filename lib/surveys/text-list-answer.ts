export type TextListEntry = {
  id: string;
  value: string;
};

export type TextListAnswerPayload = {
  entries: TextListEntry[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isTextListPayload(v: unknown): v is TextListAnswerPayload {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.entries)) return false;
  return v.entries.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      typeof entry.value === "string",
  );
}

/** Ensure one editable slot per prompt option; keep unknown extras. */
export function coerceTextListState(
  raw: unknown,
  optionIds: string[],
): TextListAnswerPayload {
  const byId = new Map<string, string>();

  if (isTextListPayload(raw)) {
    for (const entry of raw.entries) {
      byId.set(entry.id, entry.value);
    }
  } else if (isRecord(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === "string") byId.set(id, value);
    }
  } else if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    optionIds.forEach((id, index) => {
      byId.set(id, typeof raw[index] === "string" ? (raw[index] as string) : "");
    });
  }

  const entries: TextListEntry[] = optionIds.map((id) => ({
    id,
    value: byId.get(id) ?? "",
  }));

  for (const [id, value] of byId) {
    if (optionIds.includes(id)) continue;
    entries.push({ id, value });
  }

  return { entries };
}

/** Split a free-text prefill (one item per line) onto text_list slots. */
export function textListPayloadFromFreeText(
  text: string,
  optionIds: string[],
): TextListAnswerPayload {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
  const entries: TextListEntry[] = optionIds.map((id, index) => ({
    id,
    value: lines[index] ?? "",
  }));
  for (let i = optionIds.length; i < lines.length; i += 1) {
    entries.push({
      id: `prefill_${i + 1}`,
      value: lines[i] ?? "",
    });
  }
  return { entries };
}

export function setTextListEntryValue(
  raw: unknown,
  optionIds: string[],
  entryId: string,
  value: string,
): TextListAnswerPayload {
  const state = coerceTextListState(raw, optionIds);
  return {
    entries: state.entries.map((entry) =>
      entry.id === entryId ? { ...entry, value } : entry,
    ),
  };
}

export function addTextListExtraEntry(
  raw: unknown,
  optionIds: string[],
): TextListAnswerPayload {
  const state = coerceTextListState(raw, optionIds);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `extra_${crypto.randomUUID()}`
      : `extra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { entries: [...state.entries, { id, value: "" }] };
}

export function removeTextListExtraEntry(
  raw: unknown,
  optionIds: string[],
  entryId: string,
): TextListAnswerPayload {
  if (optionIds.includes(entryId)) {
    return coerceTextListState(raw, optionIds);
  }
  const state = coerceTextListState(raw, optionIds);
  return { entries: state.entries.filter((entry) => entry.id !== entryId) };
}

/** Required text_list: every prompt slot must have non-empty trimmed text. */
export function isTextListAnswerValid(
  raw: unknown,
  optionIds: string[],
  required: boolean,
): boolean {
  const state = coerceTextListState(raw, optionIds);
  if (!required) {
    return state.entries.some((entry) => entry.value.trim().length > 0);
  }
  return optionIds.every((id) => {
    const entry = state.entries.find((e) => e.id === id);
    return !!entry && entry.value.trim().length > 0;
  });
}

export function formatTextListAnswerForDisplay(
  raw: unknown,
  options: Array<{ id: string; label: string }>,
): string {
  const state = coerceTextListState(
    raw,
    options.map((o) => o.id),
  );
  const labelById = new Map(options.map((o) => [o.id, o.label] as const));
  return state.entries
    .map((entry) => {
      const prompt = labelById.get(entry.id)?.trim();
      const value = entry.value.trim();
      if (!value && !prompt) return "";
      if (!value) return prompt ? `${prompt}: —` : "";
      if (!prompt || !labelById.has(entry.id)) return value;
      return `${prompt} ${value}`.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join("\n");
}
