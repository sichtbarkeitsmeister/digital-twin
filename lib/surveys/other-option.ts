export const RADIO_OTHER_TOKEN = "__other__";
export const CHECKBOX_OTHER_TOKEN = "__other__";
export const CHECKBOX_OTHER_PREFIX = "__other__:";
export const CHECKBOX_EDIT_PREFIX = "__edit__:";
const CHECKBOX_OTHER_SEPARATOR = "|";

export type CheckboxOtherEntry = {
  id: string;
  text: string;
};

export type CheckboxAnswerState = {
  selectedPresets: Set<string>;
  otherEntries: CheckboxOtherEntry[];
  /** Original preset label → edited label shown/stored for that option. */
  presetEdits: Record<string, string>;
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

function parseEncodedEditEntry(entry: string): { original: string; edited: string } | null {
  if (!entry.startsWith(CHECKBOX_EDIT_PREFIX)) return null;
  const payload = entry.slice(CHECKBOX_EDIT_PREFIX.length);
  const sepIdx = payload.indexOf(CHECKBOX_OTHER_SEPARATOR);
  if (sepIdx < 0) return null;
  const original = safeDecode(payload.slice(0, sepIdx)).trim();
  const edited = safeDecode(payload.slice(sepIdx + 1));
  if (!original) return null;
  return { original, edited };
}

function encodePresetEdit(original: string, edited: string) {
  return `${CHECKBOX_EDIT_PREFIX}${encodeURIComponent(original)}${CHECKBOX_OTHER_SEPARATOR}${encodeURIComponent(edited)}`;
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

export function parseCheckboxOtherEntries(raw: unknown, presetLabels: string[]): CheckboxAnswerState {
  const selectedPresets = new Set<string>();
  const presetSet = new Set(presetLabels);
  const otherEntries: CheckboxOtherEntry[] = [];
  const presetEdits: Record<string, string> = {};

  if (!Array.isArray(raw)) {
    return { selectedPresets, otherEntries, presetEdits };
  }

  for (const [idx, entry] of raw.entries()) {
    if (typeof entry !== "string") continue;
    if (presetSet.has(entry)) {
      selectedPresets.add(entry);
      continue;
    }
    const edited = parseEncodedEditEntry(entry);
    if (edited && presetSet.has(edited.original)) {
      selectedPresets.add(edited.original);
      if (edited.edited !== edited.original) {
        presetEdits[edited.original] = edited.edited;
      }
      continue;
    }
    if (edited) {
      otherEntries.push({ id: `legacy_${idx + 1}`, text: edited.edited });
      continue;
    }
    // Backward compatibility: unknown values are treated as "Andere"-entries.
    otherEntries.push(parseEncodedOtherEntry(entry, `legacy_${idx + 1}`));
  }

  return { selectedPresets, otherEntries: normalizeOtherEntries(otherEntries), presetEdits };
}

export function displayedCheckboxPresetLabel(
  original: string,
  state: Pick<CheckboxAnswerState, "presetEdits">,
) {
  const edited = state.presetEdits[original];
  return typeof edited === "string" ? edited : original;
}

export function buildCheckboxAnswer(
  presetLabels: string[],
  selectedPresets: Set<string>,
  otherEntries: CheckboxOtherEntry[],
  presetEdits: Record<string, string> = {},
) {
  const result: string[] = [];
  for (const label of presetLabels) {
    if (!selectedPresets.has(label)) continue;
    const edited = typeof presetEdits[label] === "string" ? presetEdits[label]! : label;
    if (edited !== label) {
      result.push(encodePresetEdit(label, edited));
    } else {
      result.push(label);
    }
  }
  for (const entry of normalizeOtherEntries(otherEntries)) {
    result.push(
      `${CHECKBOX_OTHER_PREFIX}${encodeURIComponent(entry.id)}${CHECKBOX_OTHER_SEPARATOR}${encodeURIComponent(entry.text ?? "")}`,
    );
  }
  return result;
}

function rebuildFromRaw(
  raw: unknown,
  presetLabels: string[],
  patch: (state: CheckboxAnswerState) => CheckboxAnswerState,
) {
  const state = parseCheckboxOtherEntries(raw, presetLabels);
  const next = patch(state);
  return buildCheckboxAnswer(
    presetLabels,
    next.selectedPresets,
    next.otherEntries,
    next.presetEdits,
  );
}

export function addCheckboxOtherEntry(raw: unknown, presetLabels: string[]) {
  return rebuildFromRaw(raw, presetLabels, (state) => ({
    ...state,
    otherEntries: [...state.otherEntries, { id: createOtherEntryId(), text: "" }],
  }));
}

export function removeCheckboxOtherEntry(raw: unknown, presetLabels: string[], id: string) {
  return rebuildFromRaw(raw, presetLabels, (state) => ({
    ...state,
    otherEntries: state.otherEntries.filter((entry) => entry.id !== id),
  }));
}

export function setCheckboxOtherEntryText(
  raw: unknown,
  presetLabels: string[],
  id: string,
  text: string,
) {
  return rebuildFromRaw(raw, presetLabels, (state) => ({
    ...state,
    otherEntries: state.otherEntries.map((entry) =>
      entry.id === id ? { ...entry, text } : entry,
    ),
  }));
}

export function setCheckboxPresetSelection(
  raw: unknown,
  presetLabels: string[],
  originalLabel: string,
  selected: boolean,
) {
  return rebuildFromRaw(raw, presetLabels, (state) => {
    const selectedPresets = new Set(state.selectedPresets);
    if (selected) selectedPresets.add(originalLabel);
    else {
      selectedPresets.delete(originalLabel);
      const nextEdits = { ...state.presetEdits };
      delete nextEdits[originalLabel];
      return { ...state, selectedPresets, presetEdits: nextEdits };
    }
    return { ...state, selectedPresets };
  });
}

export function setCheckboxPresetLabel(
  raw: unknown,
  presetLabels: string[],
  originalLabel: string,
  nextLabel: string,
) {
  return rebuildFromRaw(raw, presetLabels, (state) => {
    const presetEdits = { ...state.presetEdits };
    if (nextLabel === originalLabel) delete presetEdits[originalLabel];
    else presetEdits[originalLabel] = nextLabel;
    const selectedPresets = new Set(state.selectedPresets);
    selectedPresets.add(originalLabel);
    return { ...state, selectedPresets, presetEdits };
  });
}

export function decodeOtherValueForDisplay(value: string) {
  if (value === RADIO_OTHER_TOKEN || value === CHECKBOX_OTHER_TOKEN) return "";
  const edited = parseEncodedEditEntry(value);
  if (edited) return edited.edited;
  if (value.startsWith(CHECKBOX_OTHER_PREFIX)) {
    const payload = value.slice(CHECKBOX_OTHER_PREFIX.length);
    const sepIdx = payload.indexOf(CHECKBOX_OTHER_SEPARATOR);
    if (sepIdx < 0) return payload;
    return safeDecode(payload.slice(sepIdx + 1));
  }
  return value;
}
