import { randomUUID } from "crypto";

import { surveySchema, type SurveyParsed } from "@/lib/surveys/schema";
import type { Survey, SurveyField, SurveyStep } from "@/lib/surveys/types";
import {
  isRawFilledQuestionnaire,
  parseRawFilledQuestionnaire,
} from "@/lib/surveys/raw-filled-questionnaire";
import {
  resolveFolderPlacementFromMessage,
  wrapProposalWithFolder,
} from "@/lib/ai/survey-multiphase-create";

type FolderSnapshot = { id: string; name: string };

const QUESTION_LINE_RE = /^\*\*(.+?)\*\*\s*$/;
const OPTION_LINE_RE = /^[○●◦•▪︎]\s+(.+)\s*$/;
const SECTION_RE = /^##\s+(.+)\s*$/;
const TITLE_RE = /^#\s+(.+)\s*$/;
const BLANK_LINE_RE = /^_{6,}\s*$/;
const HINT_LINE_RE = /^(?:→|->)\s*(.+)\s*$/;

function stripEmojiPrefix(text: string): string {
  return text
    .replace(
      /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{20E3}]+\s*)+/u,
      "",
    )
    .trim();
}

function slugId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(3, "0")}_${randomUUID().slice(0, 8)}`;
}

function detectFieldType(
  questionTitle: string,
  options: string[],
): SurveyField["type"] {
  const t = questionTitle.toLowerCase();
  if (options.length >= 2 && /\branking\b|\bnummerieren\b|\bpriorit[aä]t\b/.test(t)) {
    return "ranking";
  }
  // Prompted blanks / phrase stems (often end with …) should be editable text slots.
  if (
    options.length >= 2 &&
    (/\bformulierungen?\b|\bausfüllen\b|\bergänzen\b|\beintragen\b|\btextliste\b/.test(t) ||
      options.filter((o) => /(?:\.\.\.|…)\s*$/.test(o.trim())).length >= 2)
  ) {
    return "text_list";
  }
  if (options.length >= 1 && /\bmehrfachauswahl\b|\bmehrere\b/.test(t)) {
    return "checkbox";
  }
  if (options.length >= 1) return "radio";
  if (/\bbewertung\b|\bskala\b|\bsternen?\b|\brating\b/.test(t)) return "rating";
  return "text";
}

function buildField(input: {
  title: string;
  description: string;
  options: string[];
  index: number;
}): SurveyField {
  const title = stripEmojiPrefix(input.title).replace(/\s+/g, " ").trim() || `Frage ${input.index}`;
  const description = input.description.trim();
  const type = detectFieldType(title, input.options);
  const base = {
    id: slugId("field", input.index),
    title,
    description,
    required: true,
  };

  if (type === "ranking") {
    return {
      ...base,
      type: "ranking",
      options: input.options.map((label, i) => ({
        id: slugId("opt", i + 1),
        label,
      })),
      allowCustomEntries: true,
    };
  }
  if (type === "text_list") {
    return {
      ...base,
      type: "text_list",
      options: input.options.map((label, i) => ({
        id: slugId("opt", i + 1),
        label,
      })),
      allowExtraEntries: true,
    };
  }
  if (type === "checkbox") {
    return {
      ...base,
      type: "checkbox",
      options: input.options.map((label, i) => ({
        id: slugId("opt", i + 1),
        label,
      })),
      allowOtherOption: true,
    };
  }
  if (type === "radio") {
    return {
      ...base,
      type: "radio",
      options: input.options.map((label, i) => ({
        id: slugId("opt", i + 1),
        label,
      })),
      allowOtherOption: true,
    };
  }
  if (type === "rating") {
    return {
      ...base,
      type: "rating",
      scale: { min: 1, max: 5 },
    };
  }
  return {
    ...base,
    type: "text",
  };
}

/**
 * True when the user pasted a ready-made Fragebogen (sections + many questions)
 * rather than asking the model to invent one from scratch.
 */
export function isCompleteQuestionnairePaste(userMessage: string): boolean {
  const text = userMessage.trim();
  if (text.length < 2_500) return false;

  const sectionCount = (text.match(/^##\s+/gm) ?? []).length;
  const questionCount = (text.match(/^\*\*[^*].+\*\*\s*$/gm) ?? []).length;
  const looksNumbered = /#{1,3}\s+\d+\./.test(text);
  const saveIntent =
    /\b(?:ab)?speicher(?:e|n|t)?\b/i.test(text) ||
    /\b(?:ordner|folder)\b/i.test(text) ||
    /\b(?:erstell|anleg|übernehm)\w*\b/i.test(text);

  if (!saveIntent && !looksNumbered) return false;
  if (sectionCount >= 3 && questionCount >= 8) return true;
  if (questionCount >= 15 && text.length >= 6_000) return true;
  return false;
}

/**
 * Short follow-ups after a paste/timeout — reuse the last Fragebogen in history.
 *
 * Bare confirmations ("ja", "ok", "bitte") are deliberately not accepted: they
 * are how every other proposal in this chat gets approved, and re-importing a
 * whole questionnaire instead would bury the answer the user actually wanted.
 */
export function isPasteRetryOrConfirmIntent(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text || text.length > 400) return false;
  return (
    /\b(?:versuch(?:e|en)?\s+(?:es\s+)?erneut|nochmal|noch\s*mal|erneut|retry|nochmals)\b/i.test(
      text,
    ) ||
    /\b(?:genau\s+so|1\s*:\s*1|eins\s*zu\s*eins|wie\s+im\s+template|wie\s+vorliegend|so\s+lassen|so\s+übernehmen|bitte\s+übernehmen|übernimm(?:\s+es)?)\b/i.test(
      text,
    )
  );
}

/** How far back a retry may reach for the questionnaire it repeats. */
const PASTE_RETRY_LOOKBACK = 3;

/**
 * Prefer the current message if it is a full paste; otherwise, on retry/confirm,
 * reuse the latest questionnaire paste from prior user messages.
 */
export function resolveQuestionnairePasteSource(input: {
  userMessage: string;
  priorUserMessages?: string[];
}): string | null {
  if (isCompleteQuestionnairePaste(input.userMessage)) {
    return input.userMessage;
  }
  if (!isPasteRetryOrConfirmIntent(input.userMessage)) return null;
  const priors = input.priorUserMessages ?? [];
  const start = Math.max(0, priors.length - PASTE_RETRY_LOOKBACK);
  for (let i = priors.length - 1; i >= start; i -= 1) {
    const prior = priors[i];
    if (prior && isCompleteQuestionnairePaste(prior)) return prior;
  }
  return null;
}

export function convertMarkdownQuestionnaireToSurvey(userMessage: string): {
  ok: true;
  title: string;
  description: string;
  survey: SurveyParsed;
} | { ok: false; message: string } {
  const lines = userMessage.replace(/\r\n/g, "\n").split("\n");

  let title = "";
  const preSection: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const titleMatch = line.match(TITLE_RE);
    if (titleMatch && !title) {
      title = stripEmojiPrefix(titleMatch[1] ?? "").replace(/\s+/g, " ").trim();
      continue;
    }
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      current = {
        title: stripEmojiPrefix(sectionMatch[1] ?? "").replace(/\s+/g, " ").trim(),
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      preSection.push(line);
      continue;
    }
    current.lines.push(line);
  }

  if (sections.length === 0) {
    return { ok: false, message: "Kein Abschnitts-Markup (## …) im Fragebogen gefunden." };
  }

  const steps: SurveyStep[] = [];
  let fieldIndex = 0;

  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s]!;
    const fields: SurveyField[] = [];
    const sectionDescriptionParts: string[] = [];
    let active: {
      title: string;
      descriptionParts: string[];
      options: string[];
    } | null = null;

    const flush = () => {
      if (!active) return;
      fieldIndex += 1;
      fields.push(
        buildField({
          title: active.title,
          description: active.descriptionParts.join("\n").trim(),
          options: active.options,
          index: fieldIndex,
        }),
      );
      active = null;
    };

    for (const line of section.lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "---" || BLANK_LINE_RE.test(trimmed)) continue;

      const q = trimmed.match(QUESTION_LINE_RE);
      if (q) {
        flush();
        active = {
          title: q[1] ?? "",
          descriptionParts: [],
          options: [],
        };
        continue;
      }

      const opt = trimmed.match(OPTION_LINE_RE);
      if (opt && active) {
        active.options.push((opt[1] ?? "").trim());
        continue;
      }

      const hint = trimmed.match(HINT_LINE_RE);
      if (hint) {
        const text = (hint[1] ?? "").trim();
        if (active) active.descriptionParts.push(text);
        else sectionDescriptionParts.push(text);
        continue;
      }

      // Skip instructional bullets that are not answer options.
      if (/^[-*]\s+/.test(trimmed) && !active) {
        sectionDescriptionParts.push(trimmed.replace(/^[-*]\s+/, ""));
        continue;
      }

      if (active) {
        // Ranking instruction lines belonging to the question.
        if (/bitte nach|nummerieren|priorit/i.test(trimmed)) {
          active.descriptionParts.push(trimmed);
        }
        continue;
      }

      if (!trimmed.startsWith("#")) {
        sectionDescriptionParts.push(trimmed);
      }
    }
    flush();

    if (fields.length === 0) continue;
    steps.push({
      id: slugId("step", s + 1),
      title: section.title || `Abschnitt ${s + 1}`,
      description: sectionDescriptionParts.join("\n").trim(),
      fields,
    });
  }

  if (steps.length === 0) {
    return { ok: false, message: "Im Fragebogen wurden keine Fragen erkannt." };
  }

  const description = preSection
    .map((l) => l.trim())
    .filter((l) => l && l !== "---" && !l.startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);

  const surveyTitle =
    title ||
    steps[0]?.title ||
    "Fragebogen";

  const survey: Survey = {
    version: 1,
    id: randomUUID(),
    title: surveyTitle,
    description: description.slice(0, 500),
    infoTextEnabled: description.length > 0,
    infoText: description,
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

  return {
    ok: true,
    title: surveyTitle.slice(0, 120),
    description: description.slice(0, 500),
    survey: validated.data,
  };
}

export function buildQuestionnairePasteProposal(input: {
  userMessage: string;
  folders: FolderSnapshot[];
  priorUserMessages?: string[];
}):
  | { ok: true; proposal: Record<string, unknown>; stepCount: number; fieldCount: number }
  | { ok: false; message: string } {
  // Prefer filled raw exports (Fragen + Antworten) over empty markdown templates.
  if (isRawFilledQuestionnaire(input.userMessage)) {
    const converted = parseRawFilledQuestionnaire(input.userMessage);
    if (converted.ok) {
      const createSurvey = {
        kind: "create_survey" as const,
        summary: `Ausgefüllten Roh-Fragebogen „${converted.data.title}“ übernommen (${converted.data.stepCount} Abschnitte, ${converted.data.fieldCount} Fragen, ${converted.data.answeredCount} Antworten).`,
        title: converted.data.title,
        description: converted.data.description,
        notificationEmails: [] as string[],
        survey: converted.data.survey,
        initialResponse: {
          status: "completed" as const,
          answers: converted.data.answers,
        },
      };
      const placement = resolveFolderPlacementFromMessage(
        input.userMessage,
        input.folders,
      );
      const proposal = wrapProposalWithFolder({ createSurvey, placement });
      return {
        ok: true,
        proposal,
        stepCount: converted.data.stepCount,
        fieldCount: converted.data.fieldCount,
      };
    }
  }

  const source = resolveQuestionnairePasteSource({
    userMessage: input.userMessage,
    priorUserMessages: input.priorUserMessages,
  });
  if (!source) {
    return { ok: false, message: "Kein vollständiger Fragebogen-Paste erkannt." };
  }

  const converted = convertMarkdownQuestionnaireToSurvey(source);
  if (!converted.ok) return converted;

  const fieldCount = converted.survey.steps.reduce((n, s) => n + s.fields.length, 0);
  const createSurvey = {
    kind: "create_survey" as const,
    summary: `Fragebogen „${converted.title}“ aus Paste übernommen (${converted.survey.steps.length} Abschnitte, ${fieldCount} Fragen).`,
    title: converted.title,
    description: converted.description,
    notificationEmails: [] as string[],
    survey: converted.survey,
  };

  // Folder intent may be in the original paste and/or the short retry message.
  const placement =
    resolveFolderPlacementFromMessage(input.userMessage, input.folders) ??
    resolveFolderPlacementFromMessage(source, input.folders);
  const proposal = wrapProposalWithFolder({ createSurvey, placement });

  return {
    ok: true,
    proposal,
    stepCount: converted.survey.steps.length,
    fieldCount,
  };
}
