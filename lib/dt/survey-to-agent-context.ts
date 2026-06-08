import {
  CHECKBOX_OTHER_PREFIX,
  CHECKBOX_OTHER_TOKEN,
  decodeOtherValueForDisplay,
  RADIO_OTHER_TOKEN,
} from "@/lib/surveys/other-option";
import { formatRankingAnswerForDisplay } from "@/lib/surveys/ranking-answer";
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

export function normalizeSurveyAnswer(v: unknown, field?: SurveyField): string {
  if (field?.type === "ranking") {
    const labels = field.options.map((o) => o.label);
    const formatted = formatRankingAnswerForDisplay(v, labels);
    if (formatted) return formatted;
    if (Array.isArray(v)) {
      return v
        .map((x, idx) => `${idx + 1}. ${typeof x === "string" ? x : JSON.stringify(x)}`)
        .join(", ");
    }
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

export function buildSurveyResponseContextForAgent(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  const steps = getSurveySteps(input.definition);
  const lines: string[] = [`# Umfrage: ${input.surveyTitle}`, ""];

  for (const [stepIndex, step] of steps.entries()) {
    lines.push(`## ${step.title || `Schritt ${stepIndex + 1}`}`);
    for (const field of step.fields ?? []) {
      const answer = normalizeSurveyAnswer(input.answers[field.id], field);
      lines.push(`### ${field.title || "Frage"}`);
      if (field.description?.trim()) {
        lines.push(`Beschreibung: ${field.description.trim()}`);
      }
      lines.push(`Antwort: ${answer.trim() || "—"}`);

      const qs = input.fieldQuestions.filter((q) => q.field_id === field.id);
      for (const q of qs) {
        const label = q.kind === "remark" ? "Bemerkung" : "Nachfrage";
        lines.push(`- ${label} (Admin/Teilnehmer): ${q.question}`);
        if (q.answer?.trim()) {
          lines.push(`  Antwort: ${q.answer.trim()}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export type PersonaReferenceExample = {
  name: string;
  role: string | null;
  slug: string;
  promptExcerpt: string;
  avatarDataKeys: string[];
};

const PROMPT_EXCERPT_MAX = 2000;

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

  let picked = sorted.slice(0, 2);

  if (picked.length === 0) {
    const { data: fallback } = await supabase
      .from("dt_agents")
      .select("name, role, slug, prompt_template, avatar_data")
      .eq("kind", "persona")
      .order("updated_at", { ascending: false })
      .limit(10);

    const fallbackSorted = (fallback ?? []).sort(
      (a, b) => (b.prompt_template?.length ?? 0) - (a.prompt_template?.length ?? 0),
    );
    picked = fallbackSorted.slice(0, 2);
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
