export const RADIO_OTHER_TOKEN = "__other__";
export const CHECKBOX_OTHER_TOKEN = "__other__";
export const CHECKBOX_OTHER_PREFIX = "__other__:";
const CHECKBOX_OTHER_SEPARATOR = "|";

export type CheckboxOtherEntry = {
  id: string;
  text: string;
};

export function getRadioOtherState(raw: unknown, presetLabels: string[]) {
  const presetSet = new Set(presetLabels);
  if (typeof raw !== "string") return { selected: false, text: "" };
  if (raw === RADIO_OTHER_TOKEN) return { selected: true, text: "" };
  if (presetSet.has(raw)) return { selected: false, text: "" };
  return { selected: true, text: raw };
}

export function buildRadioAnswer(otherText: string) {
  const trimmed = otherText.trim();
  return trimmed.length > 0 ? trimmed : RADIO_OTHER_TOKEN;
}

function createOtherEntryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `other_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseEncodedOtherEntry(entry: string, fallbackId: string): CheckboxOtherEntry {
  if (entry === CHECKBOX_OTHER_TOKEN) return { id: fallbackId, text: "" };
  if (!entry.startsWith(CHECKBOX_OTHER_PREFIX)) return { id: fallbackId, text: entry };

  const payload = entry.slice(CHECKBOX_OTHER_PREFIX.length);
  const sepIdx = payload.indexOf(CHECKBOX_OTHER_SEPARATOR);
  if (sepIdx < 0) {
    // Legacy format: "__other__:text"
    return { id: fallbackId, text: payload };
  }

  const encodedId = payload.slice(0, sepIdx);
  const encodedText = payload.slice(sepIdx + 1);
  const id = safeDecode(encodedId || fallbackId).trim() || fallbackId;
  const text = safeDecode(encodedText);
  return { id, text };
}

function normalizeOtherEntries(entries: CheckboxOtherEntry[]) {
  const seen = new Set<string>();
  const result: CheckboxOtherEntry[] = [];
  for (const entry of entries) {
    let id = (entry.id || "").trim() || createOtherEntryId();
    if (seen.has(id)) id = `${id}_${result.length + 1}`;
    seen.add(id);
    result.push({ id, text: entry.text ?? "" });
  }
  return result;
}

export function parseCheckboxOtherEntries(raw: unknown, presetLabels: string[]) {
  const selectedPresets = new Set<string>();
  const presetSet = new Set(presetLabels);
  const otherEntries: CheckboxOtherEntry[] = [];

  if (!Array.isArray(raw)) {
    return { selectedPresets, otherEntries };
  }

  for (const [idx, entry] of raw.entries()) {
    if (typeof entry !== "string") continue;
    if (presetSet.has(entry)) {
      selectedPresets.add(entry);
      continue;
    }
    // Backward compatibility: unknown values are treated as "Andere"-entries.
    otherEntries.push(parseEncodedOtherEntry(entry, `legacy_${idx + 1}`));
  }

  return { selectedPresets, otherEntries: normalizeOtherEntries(otherEntries) };
}

export function buildCheckboxAnswer(
  presetLabels: string[],
  selectedPresets: Set<string>,
  otherEntries: CheckboxOtherEntry[],
) {
  const result = presetLabels.filter((label) => selectedPresets.has(label));
  for (const entry of normalizeOtherEntries(otherEntries)) {
    result.push(
      `${CHECKBOX_OTHER_PREFIX}${encodeURIComponent(entry.id)}${CHECKBOX_OTHER_SEPARATOR}${encodeURIComponent(entry.text ?? "")}`,
    );
  }
  return result;
}

export function addCheckboxOtherEntry(raw: unknown, presetLabels: string[]) {
  const state = parseCheckboxOtherEntries(raw, presetLabels);
  return buildCheckboxAnswer(presetLabels, state.selectedPresets, [
    ...state.otherEntries,
    { id: createOtherEntryId(), text: "" },
  ]);
}

export function removeCheckboxOtherEntry(raw: unknown, presetLabels: string[], id: string) {
  const state = parseCheckboxOtherEntries(raw, presetLabels);
  return buildCheckboxAnswer(
    presetLabels,
    state.selectedPresets,
    state.otherEntries.filter((entry) => entry.id !== id),
  );
}

export function setCheckboxOtherEntryText(raw: unknown, presetLabels: string[], id: string, text: string) {
  const state = parseCheckboxOtherEntries(raw, presetLabels);
  return buildCheckboxAnswer(
    presetLabels,
    state.selectedPresets,
    state.otherEntries.map((entry) => (entry.id === id ? { ...entry, text } : entry)),
  );
}

export function decodeOtherValueForDisplay(value: string) {
  if (value === RADIO_OTHER_TOKEN || value === CHECKBOX_OTHER_TOKEN) return "";
  if (value.startsWith(CHECKBOX_OTHER_PREFIX)) {
    const payload = value.slice(CHECKBOX_OTHER_PREFIX.length);
    const sepIdx = payload.indexOf(CHECKBOX_OTHER_SEPARATOR);
    if (sepIdx < 0) return payload;
    return safeDecode(payload.slice(sepIdx + 1));
  }
  return value;
}
