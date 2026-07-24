import {
  CHECKBOX_OTHER_PREFIX,
  CHECKBOX_OTHER_TOKEN,
  decodeOtherValueForDisplay,
  RADIO_OTHER_TOKEN,
} from "@/lib/surveys/other-option";
import {
  formatRankingAnswerForDisplay,
  hasStoredRankingAnswer,
} from "@/lib/surveys/ranking-answer";
import type { SurveyField, SurveyStep } from "@/lib/surveys/types";
import { createServiceClient } from "@/lib/supabase/service";

export type SurveyFieldQuestionRow = {
  id: string;
  field_id: string;
  kind: string;
  question: string;
  answer: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function getSurveySteps(definition: unknown): SurveyStep[] {
  if (!isRecord(definition)) return [];
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  return steps as SurveyStep[];
}

/** Placeholders / skip markers that must never be treated as real answers. */
const EMPTY_ANSWER_PLACEHOLDERS = new Set([
  "—",
  "-",
  "--",
  "---",
  "–",
  "n/a",
  "na",
  "k.a.",
  "ka",
  "nichts",
  "nichts.",
  "keine angabe",
  "keine antwort",
  "nichts gewählt",
  "kein ranking",
  "keine bewertung",
]);

export function isPlaceholderOrEmptyAnswer(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (EMPTY_ANSWER_PLACEHOLDERS.has(t)) return true;
  // Only punctuation / dash placeholders
  if (/^[\s\-—–_.…]+$/.test(t)) return true;
  return false;
}

export function normalizeSurveyAnswer(v: unknown, field?: SurveyField): string {
  if (field?.type === "ranking") {
    if (!hasStoredRankingAnswer(v)) return "";
    const labels = field.options.map((o) => o.label);
    const formatted = formatRankingAnswerForDisplay(v, labels);
    if (formatted) return formatted;
    if (Array.isArray(v)) {
      return v
        .map((x, idx) => `${idx + 1}. ${typeof x === "string" ? x : JSON.stringify(x)}`)
        .join(", ");
    }
    return "";
  }
  if (field?.type === "radio" && typeof v === "string") {
    const presetLabels = new Set(field.options.map((o) => o.label));
    if (presetLabels.has(v)) return v;
    const text = decodeOtherValueForDisplay(v).trim();
    const base = text.length > 0 ? text : "Andere";
    return `${base} (benutzererstellt)`;
  }
  if (field?.type === "checkbox" && Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x !== "string") return JSON.stringify(x);
        const presetLabels = new Set(field.options.map((o) => o.label));
        if (presetLabels.has(x)) return x;
        const isOtherToken = x === CHECKBOX_OTHER_TOKEN || x === RADIO_OTHER_TOKEN;
        const isPrefixedOther = x.startsWith(CHECKBOX_OTHER_PREFIX);
        const decoded = decodeOtherValueForDisplay(x).trim();
        if (isOtherToken || isPrefixedOther) {
          const base = decoded.length > 0 ? decoded : "Andere";
          return `${base} (benutzererstellt)`;
        }
        return decoded.length > 0 ? `${decoded} (benutzererstellt)` : "";
      })
      .filter((x) => x.trim().length > 0)
      .join(", ");
  }
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  }
  if (v && typeof v === "object") return JSON.stringify(v);
  return "";
}

function fieldHasUsableSideContent(qs: SurveyFieldQuestionRow[]): boolean {
  return qs.some((q) => {
    const question = q.question?.trim() ?? "";
    const answer = q.answer?.trim() ?? "";
    if (q.kind === "remark") {
      return question.length > 0 || answer.length > 0;
    }
    // Follow-up ("Nachfrage"): only useful when answered
    return answer.length > 0;
  });
}

/**
 * Builds Claude context as pure Frage–Antwort pairs.
 * Unanswered / placeholder fields are omitted so form option lists never look like answers.
 */
export function buildSurveyResponseContextForAgent(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  const steps = getSurveySteps(input.definition);
  const lines: string[] = [
    `# Umfrage: ${input.surveyTitle}`,
    "",
    "Hinweis: Nachfolgend stehen nur tatsächlich beantwortete Fragen (plus Bemerkungen/Nachfragen).",
    "Unbeantwortete Felder und reine Formular-Optionen wurden entfernt — erfinde keine Rankings oder Antworten.",
    "",
  ];

  let includedCount = 0;
  let skippedCount = 0;

  for (const [stepIndex, step] of steps.entries()) {
    const stepLines: string[] = [];

    for (const field of step.fields ?? []) {
      const raw = input.answers[field.id];
      const answer = normalizeSurveyAnswer(raw, field).trim();
      const hasUsableAnswer = answer.length > 0 && !isPlaceholderOrEmptyAnswer(answer);
      const qs = input.fieldQuestions.filter((q) => q.field_id === field.id);
      const hasSideContent = fieldHasUsableSideContent(qs);

      if (!hasUsableAnswer && !hasSideContent) {
        skippedCount += 1;
        continue;
      }

      includedCount += 1;
      stepLines.push(`### ${field.title || "Frage"}`);
      if (field.description?.trim()) {
        stepLines.push(`Beschreibung: ${field.description.trim()}`);
      }
      if (hasUsableAnswer) {
        stepLines.push(`Antwort: ${answer}`);
      }

      for (const q of qs) {
        const label = q.kind === "remark" ? "Bemerkung" : "Nachfrage";
        const question = q.question?.trim() ?? "";
        const qAnswer = q.answer?.trim() ?? "";
        if (q.kind === "remark") {
          if (!question && !qAnswer) continue;
          stepLines.push(`- ${label} (Admin/Teilnehmer): ${question || "(ohne Text)"}`);
          if (qAnswer) stepLines.push(`  Antwort: ${qAnswer}`);
        } else if (qAnswer) {
          stepLines.push(`- ${label} (Admin/Teilnehmer): ${question || "(ohne Text)"}`);
          stepLines.push(`  Antwort: ${qAnswer}`);
        }
      }
      stepLines.push("");
    }

    if (stepLines.length > 0) {
      lines.push(`## ${step.title || `Schritt ${stepIndex + 1}`}`);
      lines.push(...stepLines);
    }
  }

  lines.push(
    `---`,
    `Kontext-Statistik: ${includedCount} beantwortete Fragen übernommen, ${skippedCount} unbeantwortete/leere Felder weggelassen.`,
  );

  return lines.join("\n").trim();
}

export type PersonaReferenceExample = {
  name: string;
  role: string | null;
  slug: string;
  promptExcerpt: string;
  avatarDataKeys: string[];
};

const PROMPT_EXCERPT_MAX = 500;

export async function loadPersonaReferenceExamples(
  organisationId: string,
): Promise<PersonaReferenceExample[]> {
  const supabase = createServiceClient();

  const { data: orgAgents } = await supabase
    .from("dt_agents")
    .select("name, role, slug, prompt_template, avatar_data")
    .eq("organisation_id", organisationId)
    .eq("kind", "persona")
    .order("updated_at", { ascending: false })
    .limit(5);

  const sorted = (orgAgents ?? []).sort(
    (a, b) => (b.prompt_template?.length ?? 0) - (a.prompt_template?.length ?? 0),
  );

  let picked = sorted.slice(0, 1);

  if (picked.length === 0) {
    const { data: fallback } = await supabase
      .from("dt_agents")
      .select("name, role, slug, prompt_template, avatar_data")
      .eq("kind", "persona")
      .order("updated_at", { ascending: false })
      .limit(5);

    const fallbackSorted = (fallback ?? []).sort(
      (a, b) => (b.prompt_template?.length ?? 0) - (a.prompt_template?.length ?? 0),
    );
    picked = fallbackSorted.slice(0, 1);
  }

  return picked.map((row) => ({
    name: row.name,
    role: row.role,
    slug: row.slug,
    promptExcerpt: (row.prompt_template ?? "").slice(0, PROMPT_EXCERPT_MAX),
    avatarDataKeys: Object.keys(
      row.avatar_data && typeof row.avatar_data === "object" && !Array.isArray(row.avatar_data)
        ? row.avatar_data
        : {},
    ),
  }));
}

export async function findAgentForSurveyResponse(responseId: string): Promise<{
  id: string;
  name: string;
  organisation_id: string;
  slug: string;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_agents")
    .select("id, name, organisation_id, slug")
    .eq("source_survey_response_id", responseId)
    .maybeSingle();
  return data ?? null;
}
