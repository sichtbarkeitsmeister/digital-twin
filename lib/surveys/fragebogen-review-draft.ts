import type { PrefillSource } from "@/lib/surveys/org-crawl-prefill";
import type {
  Survey,
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";
import { surveySchema } from "@/lib/surveys/schema";
import { coreQuestionsForPurpose } from "@/lib/surveys/core-question-templates";
import type { SurveyPurpose } from "@/lib/surveys/purpose";

export type ExtraQuestionPlacement = "start" | "end";

export const SURVEY_FIELD_TYPE_LABELS: Record<SurveyFieldType, string> = {
  text: "Text",
  text_list: "Textliste",
  radio: "Radio",
  checkbox: "Checkbox",
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
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function defaultOptions(minCount: number): SurveyOption[] {
  return Array.from({ length: minCount }, (_, i) => ({
    id: createId(),
    label: `Option ${i + 1}`,
  }));
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
    required: false,
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
    return {
      ...next,
      options,
      allowExtraEntries: question.allowExtraEntries !== false,
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
      options: ensureOptions(q.options, 1),
      allowExtraEntries: q.allowExtraEntries !== false,
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
  const original = coreQuestionsForPurpose(draft.purpose);
  const byKey = new Map(original.map((t) => [t.key, t]));

  const extrasStep: SurveyStep | null =
    extraIncluded.length > 0
      ? {
          id: "extra_individual",
          title: "Individuelle Fragen",
          description:
            "Zusatzfragen — Typ, Pflichtfeld und Optionen sind individuell einstellbar.",
          fields: extraIncluded.map(reviewQuestionToSurveyField),
        }
      : null;

  const coreByStep = new Map<string, SurveyStep>();
  for (const q of coreIncluded) {
    const key = q.coreKey || q.id.replace(/^core_/, "");
    const base = byKey.get(key);
    const stepId = base?.stepId ?? "core_reviewed";
    const stepTitle = base?.stepTitle ?? "Kernfragen";
    const field = reviewQuestionToSurveyField(q);
    const existing = coreByStep.get(stepId);
    if (existing) existing.fields.push(field);
    else {
      coreByStep.set(stepId, {
        id: stepId,
        title: stepTitle,
        description: "",
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

  const definitionCandidate: Survey = {
    version: 1,
    id: createId(),
    title: draft.title.trim() || "Fragebogen",
    description: draft.description,
    infoTextEnabled: false,
    infoText: "",
    answerPlaceholder: "Deine Antwort…",
    steps,
  };

  const parsed = surveySchema.safeParse(definitionCandidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Fragebogen-Definition ungültig.");
  }
  return parsed.data as Survey;
}

export function answersFromReview(
  draft: FragebogenReviewDraft,
  savePrefills: boolean,
): Record<string, string> {
  if (!savePrefills) return {};
  const out: Record<string, string> = {};
  for (const q of draft.questions) {
    if (!q.included) continue;
    if (q.type && q.type !== "text" && q.type !== "radio") continue;
    const answer = q.answer.trim();
    if (!answer) continue;
    out[q.id] = answer;
  }
  return out;
}

export function buildSurveyAndAnswersFromReview(input: {
  draft: FragebogenReviewDraft;
  savePrefills: boolean;
}): { definition: Survey; answers: Record<string, string> } {
  return {
    definition: surveyFromReview(input.draft),
    answers: answersFromReview(input.draft, input.savePrefills),
  };
}
