import type { SurveyFact } from "@/lib/dt/survey-facts";

export type SurveyExamQuestion = {
  id: string;
  /** Question the tester sends to the twin (as the interviewer). */
  question: string;
  /** Short expected content from the questionnaire — for the tester only. */
  expectedHint: string;
  factId: string;
  kind: SurveyFact["kind"];
};

const WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_pain",
    question: "Was beschäftigt dich gerade am meisten — was liegt dir besonders auf dem Herzen?",
  },
  {
    id: "warmup_now",
    question: "Was ist für dich gerade die größte Herausforderung?",
  },
];

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return /[?？]$/.test(t) || /^(wie|was|welche|welcher|welches|wo|wann|warum|weshalb|wieso|erzähl|beschreib|nenne|hast|hast du|seid|bist)\b/i.test(t);
}

function toInterviewQuestion(fact: SurveyFact): string {
  const raw = (fact.kind === "answer" ? fact.fieldTitle : fact.label).trim();
  if (!raw) return "Erzähl mir bitte etwas über dich.";
  if (looksLikeQuestion(raw)) return raw;

  // Ranking / list fields often read like statements — ask conversationally.
  if (fact.fieldType === "ranking" || fact.fieldType === "checkbox" || fact.fieldType === "text_list") {
    return `Was ist dir bei „${raw}" besonders wichtig — und warum in dieser Reihenfolge?`;
  }

  return `Erzähl mir bitte: ${raw}`;
}

function hintFromValue(value: string, max = 160): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/**
 * Build an interviewer script from questionnaire facts (deterministic, no LLM).
 * Warm-up openers first, then concrete questions tied to answered fields.
 */
export function buildSurveyExamQuestions(
  facts: SurveyFact[],
  options?: { maxQuestions?: number },
): SurveyExamQuestion[] {
  const maxQuestions = options?.maxQuestions ?? 14;
  const out: SurveyExamQuestion[] = [];
  const seenNorm = new Set<string>();

  function push(q: SurveyExamQuestion) {
    const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNorm.has(key)) return;
    seenNorm.add(key);
    out.push(q);
  }

  for (const w of WARMUP) {
    push({
      id: w.id,
      question: w.question,
      expectedHint: "Offene Einstiegsfrage — Inhalt aus Persona-Prompt prüfen.",
      factId: "",
      kind: "answer",
    });
  }

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  // Prefer concrete answers; sprinkle follow-ups; skip pure remarks as questions.
  const ordered = [...answerFacts, ...followUps];

  for (const fact of ordered) {
    if (out.length >= maxQuestions) break;
    push({
      id: `exam_${fact.id}`,
      question: toInterviewQuestion(fact),
      expectedHint: hintFromValue(fact.value),
      factId: fact.id,
      kind: fact.kind,
    });
  }

  return out.slice(0, maxQuestions);
}
