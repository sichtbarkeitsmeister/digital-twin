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

/** True when text looks like a filled questionnaire worth importing. */
export function isRawFilledQuestionnaire(text: string): boolean {
  const t = text.trim();
  if (t.length < 200) return false;
  if (t.trimStart().startsWith("{")) return false;
  const antwortCount = (t.match(/^Antwort\s*:/gim) ?? []).length;
  const felderCount = (t.match(/^\d+\s+Felder?\s*$/gim) ?? []).length;
  if (antwortCount >= 3) return true;
  if (antwortCount >= 2 && felderCount >= 1) return true;

  // Loose Word / emoji pastes: many questions, or emoji section headers.
  const questionMarks = (t.match(/\?/g) ?? []).length;
  const emojiHeaders = (t.match(/^[\p{Extended_Pictographic}]/gmu) ?? []).length;
  if (t.length >= 400 && questionMarks >= 4) return true;
  if (t.length >= 300 && emojiHeaders >= 2 && questionMarks >= 3) return true;
  if (
    t.length >= 500 &&
    /fragebogen|persona|wunschkunde|anbieter/i.test(t) &&
    questionMarks >= 3
  ) {
    return true;
  }
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

const EMOJI_PREFIX_RE =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+\s*)+/u;

function stripLeadingEmoji(line: string): string {
  return line.replace(EMOJI_PREFIX_RE, "").trim();
}

function isLooseSectionHeader(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^#{1,3}\s+\S/.test(t)) return true;
  if (EMOJI_PREFIX_RE.test(t) && stripLeadingEmoji(t).length >= 2) return true;
  if (/^(?:abschnitt|teil|kapitel|sektion)\b/i.test(t)) return true;
  return false;
}

function isLooseQuestionLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 280) return false;
  if (ANTWORT_LINE_RE.test(t)) return false;
  if (isLooseSectionHeader(t)) return false;
  if (t.endsWith("?")) return true;
  if (
    /^(?:wie|was|welche|welcher|welches|wer|wo|wann|warum|wieso|weshalb|beschreib(?:en|e)?|nenn(?:en|e)?|gib|hast|habt|sind|ist|habt\s+ihr|haben\s+sie)\b/i.test(
      t,
    ) &&
    t.length >= 12 &&
    t.length <= 200
  ) {
    return true;
  }
  return false;
}

function isLooseHintLine(line: string): boolean {
  const t = line.trim();
  return /^(?:bitte|z\.\s*b\.|hinweis|optional|→|->|mehrfach|ankreuzen|sortier|nummerier)/i.test(
    t,
  );
}

/**
 * Word / emoji pastes without „N Felder“ / „Antwort:“ labels.
 * Questions end with ? (or start with question words); following lines are the answer.
 */
function parseLooseSections(text: string): { title: string; sections: DraftSection[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: DraftSection[] = [];
  const preamble: string[] = [];
  let current: DraftSection | null = null;
  let active: DraftField | null = null;

  const ensureSection = (title: string) => {
    current = { title: stripLeadingEmoji(title) || title, fields: [] };
    sections.push(current);
    active = null;
  };

  const flushActive = () => {
    if (!active || !current) return;
    active.answerRaw = active.answerRaw.trim();
    active.description = active.description.trim();
    current.fields.push(active);
    active = null;
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const antwort = trimmed.match(ANTWORT_LINE_RE);
    if (antwort && active) {
      active.answerRaw = [active.answerRaw, antwort[1] ?? ""].filter(Boolean).join(" ").trim();
      continue;
    }

    if (isLooseSectionHeader(trimmed)) {
      flushActive();
      ensureSection(trimmed.replace(/^#{1,3}\s+/, ""));
      continue;
    }

    if (isLooseQuestionLine(trimmed)) {
      if (!current) ensureSection("Allgemein");
      flushActive();
      active = { title: trimmed, description: "", answerRaw: "" };
      continue;
    }

    if (!current) {
      preamble.push(trimmed);
      continue;
    }

    if (active) {
      if (!active.answerRaw && isLooseHintLine(trimmed)) {
        active.description = [active.description, trimmed].filter(Boolean).join("\n");
      } else {
        active.answerRaw = [active.answerRaw, trimmed].filter(Boolean).join("\n");
      }
      continue;
    }

    // Orphan prose under a section — start an implicit question from first sentence
    // only if it looks substantial; otherwise ignore as section blurb.
    if (trimmed.length >= 40 && /[.!?]$/.test(trimmed)) {
      active = {
        title: trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed,
        description: "",
        answerRaw: "",
      };
    }
  }
  flushActive();

  const firstSectionTitle = sections[0]?.title ?? "";
  const titleFromPreamble = preamble
    .filter((l) => l !== firstSectionTitle && !isLooseSectionHeader(l))
    .slice(0, 2)
    .join(" — ")
    .trim();

  return {
    title: titleFromPreamble || firstSectionTitle || "Importierter Fragebogen",
    sections: sections.filter((s) => s.fields.length > 0),
  };
}

function buildResultFromSections(
  sections: DraftSection[],
  title: string,
):
  | { ok: true; data: RawFilledParseResult }
  | { ok: false; message: string } {
  if (sections.length === 0) {
    return {
      ok: false,
      message:
        "Keine Fragen erkannt. Bitte den kompletten Fragebogen einfügen (Word-Text, .docx oder Export mit „Antwort:“).",
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
      if (
        (field.type === "ranking" || field.type === "checkbox" || field.type === "radio") &&
        field.options.length === 0 &&
        answer == null
      ) {
        fields.push({
          id: field.id,
          type: "text",
          title: field.title,
          description: field.description,
          required: true,
        });
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
        if (draft.answerRaw.trim()) {
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

  const surveyTitle = title.slice(0, 120) || "Importierter Fragebogen";
  const survey: Survey = {
    version: 1,
    id: randomUUID(),
    title: surveyTitle,
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
      title: surveyTitle,
      description: survey.description,
      survey: validated.data,
      answers,
      fieldCount,
      stepCount: steps.length,
      answeredCount,
    },
  };
}

/**
 * Convert a raw filled questionnaire (strict export or loose Word paste)
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

  const strict = parseSections(text);
  if (strict.sections.some((s) => s.fields.length > 0)) {
    const title = (opts?.title?.trim() || strict.title).slice(0, 120);
    const built = buildResultFromSections(strict.sections, title);
    if (built.ok && built.data.fieldCount >= 1) return built;
  }

  const loose = parseLooseSections(text);
  if (loose.sections.some((s) => s.fields.length > 0)) {
    const title = (opts?.title?.trim() || loose.title).slice(0, 120);
    const built = buildResultFromSections(loose.sections, title);
    if (built.ok && built.data.fieldCount >= 1) return built;
  }

  return {
    ok: false,
    message:
      "Keine Abschnitte/Fragen erkannt. Der Text wird ggf. per KI ausgewertet — oder bitte mit „Antwort:“-Zeilen bzw. klaren Fragen (…?) einfügen.",
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

const EXPLICIT_DOC_SEP_RE =
  /\n{0,2}(?:={4,}|#{2,3}\s*(?:NEUER\s+)?FRAGEBOGEN(?:\s+\d+)?|-{5,})\s*\n{0,2}/i;

/** Titles that often start a whole questionnaire (not just a mid-doc section). */
const DOC_START_TITLE_RE =
  /^(?:wunschkunde|arbeitgeber|anbieter|seo(?:\b|[\s_-])|persona|digital\s*twin|mitarbeiter|marke|branding|geo\b)/i;

function antwortCountBefore(text: string, index: number): number {
  const head = text.slice(0, index);
  return (head.match(/^Antwort\s*:/gim) ?? []).length;
}

/**
 * Split one paste/file blob into multiple questionnaires.
 * Supports explicit separators (`=====`, `---`, `## FRAGEBOGEN`) and a heuristic
 * for concatenated exports (e.g. Wunschkunde + separate Anbieter questionnaire).
 */
export function splitRawFilledDocuments(
  text: string,
): Array<{ label: string; text: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  if (normalized.includes("\f")) {
    const parts = normalized
      .split("\f")
      .map((t) => t.trim())
      .filter((t) => t.length >= 50);
    if (parts.length > 1) {
      return parts.map((t, i) => ({
        label: `Fragebogen ${i + 1}`,
        text: t,
      }));
    }
  }

  const explicit = normalized
    .split(EXPLICIT_DOC_SEP_RE)
    .map((t) => t.trim())
    .filter((t) => t.length >= 50);
  if (explicit.length > 1) {
    const usable = explicit.filter(
      (t) => (t.match(/^Antwort\s*:/gim) ?? []).length >= 2 || isRawFilledQuestionnaire(t),
    );
    if (usable.length > 1) {
      return usable.map((t, i) => ({
        label: `Fragebogen ${i + 1}`,
        text: t,
      }));
    }
  }

  // Heuristic: new document when "Title\nN Felder" appears after enough prior answers
  // and the title looks like a questionnaire start (Wunschkunde / Anbieter / …).
  const lines = normalized.split("\n");
  const cutIndexes: number[] = [0];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineStart = offset;
    offset += line.length + 1; // + \n

    const title = line.trim();
    if (!title || !DOC_START_TITLE_RE.test(title)) continue;

    let j = i + 1;
    while (j < lines.length && !(lines[j] ?? "").trim()) j += 1;
    const next = (lines[j] ?? "").trim();
    if (!FELDER_LINE_RE.test(next)) continue;

    // Don't split at the very first document.
    if (antwortCountBefore(normalized, lineStart) < 3) continue;
    if (cutIndexes[cutIndexes.length - 1] === lineStart) continue;
    cutIndexes.push(lineStart);
  }

  if (cutIndexes.length > 1) {
    const parts: Array<{ label: string; text: string }> = [];
    for (let c = 0; c < cutIndexes.length; c += 1) {
      const start = cutIndexes[c]!;
      const end = c + 1 < cutIndexes.length ? cutIndexes[c + 1]! : normalized.length;
      const chunk = normalized.slice(start, end).trim();
      if (chunk.length < 50) continue;
      if ((chunk.match(/^Antwort\s*:/gim) ?? []).length < 2 && !isRawFilledQuestionnaire(chunk)) {
        continue;
      }
      const firstLine = chunk.split("\n").find((l) => l.trim())?.trim() ?? `Fragebogen ${parts.length + 1}`;
      parts.push({ label: firstLine.slice(0, 80), text: chunk });
    }
    if (parts.length > 1) return parts;
  }

  return [{ label: "Fragebogen", text: normalized }];
}

