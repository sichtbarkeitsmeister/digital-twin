import { randomUUID } from "crypto";

import { buildCheckboxAnswer } from "@/lib/surveys/other-option";
import { surveySchema, type SurveyParsed } from "@/lib/surveys/schema";
import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";

export type RawFilledParseResult = {
  title: string;
  description: string;
  survey: SurveyParsed;
  answers: Record<string, unknown>;
  fieldCount: number;
  stepCount: number;
  answeredCount: number;
};

type DraftField = {
  title: string;
  description: string;
  answerRaw: string;
};

type DraftSection = {
  title: string;
  fields: DraftField[];
};

const FELDER_LINE_RE = /^(\d+)\s+Felder?\s*$/i;
const ANTWORT_LINE_RE = /^Antwort\s*:\s*(.*)$/i;
const RANKING_HINT_RE =
  /nach\s+häufi|häufigste|sortier|nummerier|priorit|\branking\b|reihenfolge|oben\s*=/i;
const CHECKBOX_HINT_RE =
  /alle\s+zutreffenden|mehrfach|ankreuzen|was\s+häufig\s+vorkommt|bitte\s+alle/i;
const RADIO_HINT_RE = /eine\s+option|bitte\s+wählen|ankreuzen(?!.*alle)/i;

function slugId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(3, "0")}_${randomUUID().slice(0, 8)}`;
}

function optionId(index: number): string {
  return slugId("opt", index);
}

/** True when text looks like an exported filled questionnaire (Antwort: lines). */
export function isRawFilledQuestionnaire(text: string): boolean {
  const t = text.trim();
  if (t.length < 200) return false;
  if (t.trimStart().startsWith("{")) return false;
  const antwortCount = (t.match(/^Antwort\s*:/gim) ?? []).length;
  const felderCount = (t.match(/^\d+\s+Felder?\s*$/gim) ?? []).length;
  if (antwortCount >= 3) return true;
  if (antwortCount >= 2 && felderCount >= 1) return true;
  return false;
}

/**
 * Split multi-select answers on commas outside parentheses, preferring
 * boundaries before a new capitalized option / em-dash label.
 */
export function splitCheckboxLabels(answer: string): string[] {
  const trimmed = answer.trim();
  if (!trimmed) return [];

  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const c = trimmed[i]!;
    if (c === "(") depth += 1;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      const rest = trimmed.slice(i + 1);
      if (
        /^\s+[A-ZÄÖÜ]/.test(rest) ||
        /^\s+\S[^,]{0,60}\s*[–—-]/.test(rest)
      ) {
        if (cur.trim()) parts.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.length >= 2 ? parts : [trimmed];
}

/** Parse "1. A, 2. B, 3. C" ranking answers. */
export function splitRankingLabels(answer: string): string[] {
  const trimmed = answer.trim();
  if (!trimmed) return [];
  if (!/(?:^|,\s*)\d+\.\s+\S/.test(trimmed)) {
    return splitCheckboxLabels(trimmed);
  }
  return trimmed
    .split(/\s*(?=\d+\.\s+)/)
    .map((part) => part.replace(/^\d+\.\s+/, "").replace(/,\s*$/, "").trim())
    .filter(Boolean);
}

function detectFieldType(
  title: string,
  description: string,
  answerRaw: string,
): SurveyField["type"] {
  const hint = `${title}\n${description}`;
  if (RANKING_HINT_RE.test(hint) || /(?:^|,\s*)\d+\.\s+\S/.test(answerRaw)) {
    return "ranking";
  }
  if (CHECKBOX_HINT_RE.test(hint)) return "checkbox";
  if (RADIO_HINT_RE.test(hint) && !answerRaw.includes(",")) return "radio";
  return "text";
}

function buildFieldAndAnswer(
  draft: DraftField,
  index: number,
): { field: SurveyField; answer: unknown | null } {
  const title = draft.title.replace(/\s+/g, " ").trim() || `Frage ${index}`;
  const description = draft.description.trim();
  const answerRaw = draft.answerRaw.trim();
  const type = detectFieldType(title, description, answerRaw);
  const base = {
    id: slugId("field", index),
    title,
    description,
    required: true,
  };

  if (!answerRaw) {
    // Unanswered — keep the question as text so it remains editable for customers.
    return { field: { ...base, type: "text" }, answer: null };
  }

  if (type === "ranking") {
    const labels = splitRankingLabels(answerRaw);
    const options = labels.map((label, i) => ({
      id: optionId(i + 1),
      label,
    }));
    return {
      field: {
        ...base,
        type: "ranking",
        options,
        allowCustomEntries: true,
      },
      answer: {
        excludedPresets: [],
        items: labels.map((label) => ({ kind: "preset" as const, label })),
      },
    };
  }

  if (type === "checkbox") {
    const labels = splitCheckboxLabels(answerRaw);
    const options = labels.map((label, i) => ({
      id: optionId(i + 1),
      label,
    }));
    return {
      field: {
        ...base,
        type: "checkbox",
        options,
        allowOtherOption: true,
      },
      answer: buildCheckboxAnswer(labels, new Set(labels), []),
    };
  }

  if (type === "radio") {
    const label = answerRaw;
    return {
      field: {
        ...base,
        type: "radio",
        options: [{ id: optionId(1), label }],
        allowOtherOption: true,
      },
      answer: label,
    };
  }

  return {
    field: { ...base, type: "text" },
    answer: answerRaw,
  };
}

function parseSections(text: string): { title: string; sections: DraftSection[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: DraftSection[] = [];
  let preamble: string[] = [];
  let pendingSectionTitle: string | null = null;
  let current: DraftSection | null = null;

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    const trimmed = line.trim();

    const felder = trimmed.match(FELDER_LINE_RE);
    if (felder) {
      const title =
        pendingSectionTitle?.trim() ||
        `Abschnitt ${sections.length + 1}`;
      pendingSectionTitle = null;
      current = { title, fields: [] };
      sections.push(current);
      i += 1;
      continue;
    }

    if (!current) {
      if (trimmed) {
        // Candidate section title sits above "N Felder"; keep last non-empty.
        pendingSectionTitle = trimmed;
        if (sections.length === 0 && !FELDER_LINE_RE.test(trimmed)) {
          preamble.push(trimmed);
        }
      }
      i += 1;
      continue;
    }

    // Inside a section: gather question blocks ending at Antwort:
    if (!trimmed) {
      i += 1;
      continue;
    }

    // Next section title (lookahead for Felder)
    let look = i + 1;
    while (look < lines.length && !(lines[look] ?? "").trim()) look += 1;
    const nextTrim = (lines[look] ?? "").trim();
    if (FELDER_LINE_RE.test(nextTrim)) {
      pendingSectionTitle = trimmed;
      current = null;
      i += 1;
      continue;
    }

    const blockLines: string[] = [trimmed];
    i += 1;
    let answerRaw = "";
    while (i < lines.length) {
      const t = (lines[i] ?? "").trim();
      if (!t) {
        // blank line inside block — keep scanning for Antwort
        i += 1;
        // If next non-empty is a new section title+Felder, stop without answer
        let j = i;
        while (j < lines.length && !(lines[j] ?? "").trim()) j += 1;
        const maybeTitle = (lines[j] ?? "").trim();
        let k = j + 1;
        while (k < lines.length && !(lines[k] ?? "").trim()) k += 1;
        if (maybeTitle && FELDER_LINE_RE.test((lines[k] ?? "").trim())) {
          break;
        }
        continue;
      }
      const am = t.match(ANTWORT_LINE_RE);
      if (am) {
        answerRaw = (am[1] ?? "").trim();
        i += 1;
        // Continuation lines until blank or next question/section
        while (i < lines.length) {
          const cont = (lines[i] ?? "").trim();
          if (!cont) break;
          if (ANTWORT_LINE_RE.test(cont)) break;
          // New section ahead
          let j = i + 1;
          while (j < lines.length && !(lines[j] ?? "").trim()) j += 1;
          if (FELDER_LINE_RE.test((lines[j] ?? "").trim())) break;
          // Heuristic: another question starts with capital and ends with ? or is long title
          if (
            blockLines.length >= 1 &&
            cont.endsWith("?") &&
            !/^z\.\s*B\./i.test(cont) &&
            !/^Bitte\b/i.test(cont)
          ) {
            break;
          }
          answerRaw = `${answerRaw} ${cont}`.trim();
          i += 1;
        }
        break;
      }

      // New section without answer
      let j = i + 1;
      while (j < lines.length && !(lines[j] ?? "").trim()) j += 1;
      if (FELDER_LINE_RE.test((lines[j] ?? "").trim())) {
        break;
      }

      blockLines.push(t);
      i += 1;
    }

    const questionTitle = blockLines[0] ?? `Frage ${current.fields.length + 1}`;
    const description = blockLines.slice(1).join("\n").trim();
    current.fields.push({
      title: questionTitle,
      description,
      answerRaw,
    });
  }

  // Title: prefer text before first section that isn't the first section title
  const firstSectionTitle = sections[0]?.title ?? "";
  const titleFromPreamble = preamble
    .filter((l) => l !== firstSectionTitle && !FELDER_LINE_RE.test(l))
    .join(" ")
    .trim();

  return {
    title: titleFromPreamble || firstSectionTitle || "Importierter Fragebogen",
    sections,
  };
}

/**
 * Convert a raw filled questionnaire export (sections + "Antwort:" lines)
 * into a survey definition plus answer map ready for importSurveyBundleAction.
 */
export function parseRawFilledQuestionnaire(
  text: string,
  opts?: { title?: string },
):
  | { ok: true; data: RawFilledParseResult }
  | { ok: false; message: string } {
  if (!text.trim()) {
    return { ok: false, message: "Leerer Text — bitte den Fragebogen einfügen." };
  }

  const { title: parsedTitle, sections } = parseSections(text);
  if (sections.length === 0) {
    return {
      ok: false,
      message:
        "Keine Abschnitte erkannt. Erwartet wird das Export-Format mit „N Felder“ und „Antwort:“-Zeilen.",
    };
  }

  const steps: SurveyStep[] = [];
  const answers: Record<string, unknown> = {};
  let fieldIndex = 0;
  let answeredCount = 0;

  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s]!;
    const fields: SurveyField[] = [];
    for (const draft of section.fields) {
      fieldIndex += 1;
      const { field, answer } = buildFieldAndAnswer(draft, fieldIndex);
      // Skip empty ranking/checkbox shells with no options and no answer
      if (
        (field.type === "ranking" || field.type === "checkbox" || field.type === "radio") &&
        field.options.length === 0 &&
        answer == null
      ) {
        // Keep as text field so the question is not lost
        const textField: SurveyField = {
          id: field.id,
          type: "text",
          title: field.title,
          description: field.description,
          required: true,
        };
        fields.push(textField);
        continue;
      }
      if (
        (field.type === "ranking" || field.type === "checkbox") &&
        field.options.length === 0
      ) {
        fields.push({
          id: field.id,
          type: "text",
          title: field.title,
          description: field.description,
          required: true,
        });
        if (answer != null && typeof draft.answerRaw === "string" && draft.answerRaw.trim()) {
          answers[field.id] = draft.answerRaw.trim();
          answeredCount += 1;
        }
        continue;
      }
      fields.push(field);
      if (answer != null) {
        answers[field.id] = answer;
        answeredCount += 1;
      }
    }
    if (fields.length === 0) continue;
    steps.push({
      id: slugId("step", s + 1),
      title: section.title,
      description: "",
      fields,
    });
  }

  if (steps.length === 0) {
    return { ok: false, message: "Im Text wurden keine Fragen erkannt." };
  }

  const title = (opts?.title?.trim() || parsedTitle).slice(0, 120);
  const survey: Survey = {
    version: 1,
    id: randomUUID(),
    title,
    description: "Aus Roh-Fragebogen (Text) importiert — Fragen und Antworten übernommen.",
    infoTextEnabled: false,
    infoText: "",
    answerPlaceholder: "Deine Antwort…",
    steps,
  };

  const validated = surveySchema.safeParse(survey);
  if (!validated.success) {
    return {
      ok: false,
      message:
        validated.error.issues[0]?.message ??
        "Konvertierter Fragebogen entspricht nicht dem Schema.",
    };
  }

  const fieldCount = steps.reduce((n, st) => n + st.fields.length, 0);
  return {
    ok: true,
    data: {
      title,
      description: survey.description,
      survey: validated.data,
      answers,
      fieldCount,
      stepCount: steps.length,
      answeredCount,
    },
  };
}

/** Bundle payload compatible with importSurveyBundleAction. */
export function rawFilledToImportBundle(data: RawFilledParseResult) {
  return {
    version: 1 as const,
    survey: {
      title: data.title,
      description: data.description,
      notification_emails: [] as string[],
      definition: data.survey,
    },
    responses: [
      {
        status: "completed" as const,
        answers: data.answers,
        completed_at: new Date().toISOString(),
      },
    ],
    fieldQuestions: [] as unknown[],
  };
}
