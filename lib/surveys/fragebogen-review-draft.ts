import type { PrefillSource } from "@/lib/surveys/org-crawl-prefill";
import type {
  Survey,
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";
import { surveySchema } from "@/lib/surveys/schema";
import { coreQuestionsForPurpose, surveyInfoTextForPurpose } from "@/lib/surveys/core-question-templates";
import type { SurveyPurpose } from "@/lib/surveys/purpose";
import { textListPayloadFromFreeText } from "@/lib/surveys/text-list-answer";
import {
  isClientAudienceKind,
  type ClientAudienceKind,
} from "@/lib/surveys/client-audience";
import { customizeCoreQuestions } from "@/lib/surveys/customize-fragebogen";
import { isIndustryPlaceholderLabel } from "@/lib/surveys/core-question-templates";

export type ExtraQuestionPlacement = "start" | "end";

export const SURVEY_FIELD_TYPE_LABELS: Record<SurveyFieldType, string> = {
  text: "Freitext",
  text_list: "Freitext-Liste",
  radio: "Einzelauswahl",
  checkbox: "Mehrfachauswahl",
  rating: "Bewertung",
  ranking: "Ranking",
};

export const SURVEY_FIELD_TYPES = Object.keys(
  SURVEY_FIELD_TYPE_LABELS,
) as SurveyFieldType[];

export type ReviewQuestionItem = {
  id: string;
  kind: "core" | "extra";
  coreKey?: string;
  title: string;
  description: string;
  included: boolean;
  required: boolean;
  type: SurveyFieldType;
  options: SurveyOption[];
  allowOtherOption?: boolean;
  allowExtraEntries?: boolean;
  allowCustomEntries?: boolean;
  addEntryLabel?: string;
  scaleMin?: number;
  scaleMax?: number;
  answer: string;
  answerSource: PrefillSource | "none";
  answerNote: string;
};

export type FragebogenReviewDraft = {
  title: string;
  description: string;
  purpose: SurveyPurpose;
  extraPlacement: ExtraQuestionPlacement;
  crawlPageCount: number;
  websiteUrl: string | null;
  organisationName: string;
  questions: ReviewQuestionItem[];
  /** Stable id for the live wizard definition (Survey KI patches this draft). */
  definitionId?: string;
  /** Kanzlei / Praxis / Unternehmen — steuert Mandant, Patient oder Kunde. */
  clientAudience?: ClientAudienceKind;
  /** Set when crawl/upload prefills succeeded but the AI gap-fill timed out or failed. */
  aiWarning?: string | null;
};

function resolveDraftAudience(draft: FragebogenReviewDraft): ClientAudienceKind {
  return isClientAudienceKind(draft.clientAudience) ? draft.clientAudience : "unternehmen";
}

function checkboxAnswerFromFreeText(answer: string, optionLabels: string[]): string[] {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
  const hay = answer.toLowerCase();
  const selected: string[] = [];
  for (const label of optionLabels) {
    const trimmed = label.trim();
    if (!trimmed || isIndustryPlaceholderLabel(trimmed)) continue;
    const lower = trimmed.toLowerCase();
    if (lines.some((line) => line.toLowerCase() === lower)) {
      selected.push(trimmed);
      continue;
    }
    if (trimmed.length >= 4 && hay.includes(lower)) selected.push(trimmed);
  }
  return selected;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/** Survey-level id must be a UUID so the Survey KI can patch the live wizard draft. */
export function createSurveyDefinitionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function ensureOptions(options: SurveyOption[] | undefined, minCount: number): SurveyOption[] {
  const next = (options ?? [])
    .filter((opt) => opt && typeof opt.id === "string")
    .map((opt) => ({
      id: opt.id || createId(),
      label: typeof opt.label === "string" ? opt.label : "",
    }));
  while (next.length < minCount) {
    next.push({ id: createId(), label: `Option ${next.length + 1}` });
  }
  return next;
}

export function createEmptyExtraQuestion(): ReviewQuestionItem {
  return {
    id: `extra_${createId()}`,
    kind: "extra",
    title: "",
    description: "",
    included: true,
    required: true,
    type: "text",
    options: [],
    answer: "",
    answerSource: "none",
    answerNote: "",
  };
}

export function applyReviewQuestionType(
  question: ReviewQuestionItem,
  nextType: SurveyFieldType,
): ReviewQuestionItem {
  if (question.type === nextType) return question;
  const next: ReviewQuestionItem = { ...question, type: nextType };
  if (nextType === "text") {
    return { ...next, options: [] };
  }
  if (nextType === "rating") {
    return {
      ...next,
      options: [],
      scaleMin: question.scaleMin ?? 1,
      scaleMax: question.scaleMax ?? 5,
    };
  }
  const options = ensureOptions(question.options, nextType === "ranking" ? 2 : 1);
  if (nextType === "text_list") {
    const labeled = (question.options ?? []).filter(
      (o) => o && typeof o.id === "string" && o.label.trim().length > 0,
    );
    const listOptions =
      labeled.length >= 2
        ? labeled.map((o) => ({ id: o.id || createId(), label: o.label }))
        : [
            { id: createId(), label: "" },
            { id: createId(), label: "" },
            { id: createId(), label: "" },
          ];
    return {
      ...next,
      options: listOptions,
      allowExtraEntries: question.allowExtraEntries !== false,
      addEntryLabel: question.addEntryLabel,
    };
  }
  if (nextType === "radio") {
    return {
      ...next,
      options,
      allowOtherOption: question.allowOtherOption === true,
    };
  }
  if (nextType === "checkbox") {
    return {
      ...next,
      options,
      allowOtherOption: question.allowOtherOption !== false,
    };
  }
  return {
    ...next,
    options,
    allowCustomEntries: question.allowCustomEntries !== false,
  };
}

export function reviewQuestionToSurveyField(q: ReviewQuestionItem): SurveyField {
  const base = {
    id: q.id,
    title: q.title.trim(),
    description: q.description ?? "",
    required: Boolean(q.required),
  };
  const type = q.type ?? "text";

  if (type === "text") return { ...base, type: "text" };

  if (type === "rating") {
    const min = Number.isFinite(q.scaleMin) ? Number(q.scaleMin) : 1;
    const max = Number.isFinite(q.scaleMax) ? Number(q.scaleMax) : 5;
    return {
      ...base,
      type: "rating",
      scale: { min, max: max > min ? max : min + 1 },
    };
  }

  if (type === "text_list") {
    return {
      ...base,
      type: "text_list",
      options: ensureOptions(q.options, 3).map((o) => ({ id: o.id, label: o.label })),
      allowExtraEntries: q.allowExtraEntries !== false,
      addEntryLabel: q.addEntryLabel?.trim() || undefined,
    };
  }

  if (type === "radio") {
    return {
      ...base,
      type: "radio",
      options: ensureOptions(q.options, 1),
      allowOtherOption: q.allowOtherOption === true,
    };
  }

  if (type === "checkbox") {
    return {
      ...base,
      type: "checkbox",
      options: ensureOptions(q.options, 1),
      allowOtherOption: q.allowOtherOption !== false,
    };
  }

  return {
    ...base,
    type: "ranking",
    options: ensureOptions(q.options, 2),
    allowCustomEntries: q.allowCustomEntries !== false,
  };
}

export function surveyFromReview(draft: FragebogenReviewDraft): Survey {
  const included = draft.questions.filter((q) => q.included && q.title.trim());
  if (included.length === 0) {
    throw new Error("Mindestens eine Frage muss übernommen werden.");
  }

  const coreIncluded = included.filter((q) => q.kind === "core");
  const extraIncluded = included.filter((q) => q.kind === "extra");
  const audience = resolveDraftAudience(draft);
  const original = customizeCoreQuestions({
    templates: coreQuestionsForPurpose(draft.purpose),
    audience,
  });
  const byKey = new Map(original.map((t) => [t.key, t]));

  const extrasStep: SurveyStep | null =
    extraIncluded.length > 0
      ? {
          id: "extra_individual",
          title: "Individuelle Fragen für dieses Unternehmen",
          description:
            "KI-Vorschläge für die jeweilige Firma — bearbeiten, kopieren oder löschen.",
          fields: extraIncluded.map(reviewQuestionToSurveyField),
        }
      : null;

  const coreByStep = new Map<string, SurveyStep>();
  for (const q of coreIncluded) {
    const key = q.coreKey || q.id.replace(/^core_/, "");
    const base = byKey.get(key);
    const stepId = base?.stepId ?? "core_reviewed";
    const stepTitle = base?.stepTitle ?? "Kernfragen";
    const stepDescription = base?.stepDescription ?? "";
    const field = reviewQuestionToSurveyField(q);
    const existing = coreByStep.get(stepId);
    if (existing) existing.fields.push(field);
    else {
      coreByStep.set(stepId, {
        id: stepId,
        title: stepTitle,
        description: stepDescription,
        fields: [field],
      });
    }
  }

  const coreSteps = [...coreByStep.values()];
  const steps =
    extrasStep == null
      ? coreSteps
      : draft.extraPlacement === "start"
        ? [extrasStep, ...coreSteps]
        : [...coreSteps, extrasStep];

  const info = surveyInfoTextForPurpose(draft.purpose, audience);
  const definitionCandidate: Survey = {
    version: 1,
    id: draft.definitionId?.trim() || createSurveyDefinitionId(),
    title: draft.title.trim() || "Fragebogen",
    description: draft.description,
    infoTextEnabled: info.infoTextEnabled,
    infoText: info.infoText,
    answerPlaceholder: "Deine Antwort…",
    steps,
  };

  const parsed = surveySchema.safeParse(definitionCandidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Fragebogen-Definition ungültig.");
  }
  return parsed.data as Survey;
}

export function surveyFromReviewOrNull(
  draft: FragebogenReviewDraft | null | undefined,
): Survey | null {
  if (!draft) return null;
  try {
    return surveyFromReview(draft);
  } catch {
    return null;
  }
}

export function answersFromReview(
  draft: FragebogenReviewDraft,
  savePrefills: boolean,
): Record<string, unknown> {
  if (!savePrefills) return {};
  const out: Record<string, unknown> = {};
  for (const q of draft.questions) {
    if (!q.included) continue;
    const answer = q.answer.trim();
    if (!answer) continue;
    if (!q.type || q.type === "text" || q.type === "radio") {
      out[q.id] = answer;
      continue;
    }
    if (q.type === "checkbox") {
      const selected = checkboxAnswerFromFreeText(
        answer,
        q.options.map((opt) => opt.label),
      );
      if (selected.length > 0) out[q.id] = selected;
      continue;
    }
    if (q.type === "ranking") {
      const lines = answer
        .split(/\n+/)
        .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
        .filter(Boolean);
      const presets = q.options.map((opt) => opt.label).filter(Boolean);
      const ranked = lines.filter((line) => presets.includes(line));
      if (ranked.length >= 2) out[q.id] = ranked;
      continue;
    }
    if (q.type === "text_list") {
      const payload = textListPayloadFromFreeText(
        answer,
        q.options.map((opt) => opt.id),
      );
      if (payload.entries.some((entry) => entry.value.trim())) {
        out[q.id] = payload;
      }
    }
  }
  return out;
}

export function buildSurveyAndAnswersFromReview(input: {
  draft: FragebogenReviewDraft;
  savePrefills: boolean;
}): { definition: Survey; answers: Record<string, unknown> } {
  return {
    definition: surveyFromReview(input.draft),
    answers: answersFromReview(input.draft, input.savePrefills),
  };
}

function optionsFromField(field: SurveyField): SurveyOption[] {
  if (field.type === "text" || field.type === "rating") return [];
  return field.options.map((opt) => ({ id: opt.id, label: opt.label }));
}

function extraFromField(field: SurveyField): ReviewQuestionItem {
  const options = optionsFromField(field);
  return {
    id: field.id,
    kind: "extra",
    title: field.title,
    description: field.description,
    included: true,
    required: field.required,
    type: field.type,
    options,
    allowOtherOption:
      field.type === "radio" || field.type === "checkbox" ? field.allowOtherOption : undefined,
    allowExtraEntries: field.type === "text_list" ? field.allowExtraEntries : undefined,
    addEntryLabel: field.type === "text_list" ? field.addEntryLabel : undefined,
    allowCustomEntries: field.type === "ranking" ? field.allowCustomEntries : undefined,
    scaleMin: field.type === "rating" ? field.scale.min : undefined,
    scaleMax: field.type === "rating" ? field.scale.max : undefined,
    answer: "",
    answerSource: "none",
    answerNote: "",
  };
}

/** Merge a patched Survey back into the wizard review draft (keep answers/core keys). */
export function mergeSurveyIntoReviewDraft(
  draft: FragebogenReviewDraft,
  survey: Survey,
): FragebogenReviewDraft {
  const prevById = new Map(draft.questions.map((question) => [question.id, question]));
  const next: ReviewQuestionItem[] = [];
  const seen = new Set<string>();

  for (const step of survey.steps) {
    for (const field of step.fields) {
      seen.add(field.id);
      const prev = prevById.get(field.id);
      const options = optionsFromField(field);
      const base = prev ? { ...prev, included: true } : extraFromField(field);
      next.push({
        ...base,
        title: field.title,
        description: field.description,
        required: field.required,
        type: field.type,
        options,
        allowOtherOption:
          field.type === "radio" || field.type === "checkbox"
            ? field.allowOtherOption
            : base.allowOtherOption,
        allowExtraEntries:
          field.type === "text_list" ? field.allowExtraEntries : base.allowExtraEntries,
        addEntryLabel: field.type === "text_list" ? field.addEntryLabel : base.addEntryLabel,
        allowCustomEntries:
          field.type === "ranking" ? field.allowCustomEntries : base.allowCustomEntries,
        scaleMin: field.type === "rating" ? field.scale.min : base.scaleMin,
        scaleMax: field.type === "rating" ? field.scale.max : base.scaleMax,
      });
    }
  }

  for (const question of draft.questions) {
    if (seen.has(question.id)) continue;
    next.push({ ...question, included: false });
  }

  return {
    ...draft,
    title: survey.title.trim() || draft.title,
    description: survey.description,
    definitionId: survey.id || draft.definitionId,
    questions: next,
  };
}
