import type { SurveyField } from "@/lib/surveys/types";

import {
  getSurveySteps,
  isPlaceholderOrEmptyAnswer,
  normalizeSurveyAnswer,
  type SurveyFieldQuestionRow,
} from "@/lib/dt/survey-to-agent-context";

export type SurveyFactKind = "answer" | "remark" | "follow_up";

/**
 * One atomic, non-invented piece of questionnaire truth.
 * Generation and coverage checks key off these IDs.
 */
export type SurveyFact = {
  id: string;
  fieldId: string;
  fieldTitle: string;
  fieldType: string;
  fieldDescription: string | null;
  stepTitle: string;
  kind: SurveyFactKind;
  /** Human-readable label (field title, or remark/follow-up question text). */
  label: string;
  /** Normalized value that must be reflected in the persona output. */
  value: string;
};

export type SurveyFactsBundle = {
  surveyTitle: string;
  facts: SurveyFact[];
  /** Fields omitted because empty / placeholder (no side content). */
  skippedFieldCount: number;
};

function nextFactId(index: number): string {
  return `fact_${String(index).padStart(3, "0")}`;
}

/**
 * Deterministic extraction: only real answers, remarks, and answered follow-ups.
 * No LLM. This is Stufe 1 of the survey→avatar pipeline redesign.
 */
export function extractSurveyFacts(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): SurveyFactsBundle {
  const steps = getSurveySteps(input.definition);
  const facts: SurveyFact[] = [];
  let skippedFieldCount = 0;
  let factIndex = 0;

  for (const [stepIndex, step] of steps.entries()) {
    const stepTitle = step.title?.trim() || `Schritt ${stepIndex + 1}`;

    for (const field of step.fields ?? []) {
      const raw = input.answers[field.id];
      const answer = normalizeSurveyAnswer(raw, field as SurveyField).trim();
      const hasUsableAnswer = answer.length > 0 && !isPlaceholderOrEmptyAnswer(answer);
      const qs = input.fieldQuestions.filter((q) => q.field_id === field.id);

      const sideItems = qs
        .map((q) => {
          const question = q.question?.trim() ?? "";
          const qAnswer = q.answer?.trim() ?? "";
          if (q.kind === "remark") {
            if (!question && !qAnswer) return null;
            return {
              kind: "remark" as const,
              label: question || "(Bemerkung ohne Text)",
              value: qAnswer ? `${question || "(ohne Text)"}\n${qAnswer}`.trim() : question,
            };
          }
          if (!qAnswer) return null;
          return {
            kind: "follow_up" as const,
            label: question || "(Nachfrage ohne Text)",
            value: qAnswer,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (!hasUsableAnswer && sideItems.length === 0) {
        skippedFieldCount += 1;
        continue;
      }

      const fieldTitle = field.title?.trim() || "Frage";
      const fieldType = field.type || "text";
      const fieldDescription = field.description?.trim() || null;

      if (hasUsableAnswer) {
        factIndex += 1;
        facts.push({
          id: nextFactId(factIndex),
          fieldId: field.id,
          fieldTitle,
          fieldType,
          fieldDescription,
          stepTitle,
          kind: "answer",
          label: fieldTitle,
          value: answer,
        });
      }

      for (const side of sideItems) {
        factIndex += 1;
        facts.push({
          id: nextFactId(factIndex),
          fieldId: field.id,
          fieldTitle,
          fieldType,
          fieldDescription,
          stepTitle,
          kind: side.kind,
          label: side.label,
          value: side.value,
        });
      }
    }
  }

  return {
    surveyTitle: input.surveyTitle,
    facts,
    skippedFieldCount,
  };
}

/** Numbered checklist + Q&A detail for the model (and for humans debugging). */
export function formatSurveyFactsForAgentContext(bundle: SurveyFactsBundle): string {
  const lines: string[] = [
    `# Umfrage: ${bundle.surveyTitle}`,
    "",
    "Hinweis: Nachfolgend stehen nur tatsächlich beantwortete Fragen (plus Bemerkungen/Nachfragen).",
    "Unbeantwortete Felder und reine Formular-Optionen wurden entfernt — erfinde keine Rankings oder Antworten.",
    "",
  ];

  if (bundle.facts.length === 0) {
    lines.push("Keine verwertbaren Facts gefunden.");
    return lines.join("\n").trim();
  }

  lines.push("## Pflicht-Checkliste (jede Fact-ID muss im Ergebnis vorkommen)");
  lines.push(
    "Jede Zeile ist ein verbindlicher Fact. Übernimm den Inhalt in prompt_template und/oder avatar_data.",
    "Erfinde nichts. Bei Rankings nur die gelistete Reihenfolge — keine Formular-Optionen ergänzen.",
    "",
  );

  for (const fact of bundle.facts) {
    const kindLabel =
      fact.kind === "remark" ? "Bemerkung" : fact.kind === "follow_up" ? "Nachfrage" : "Antwort";
    const valueOneLine = fact.value.replace(/\s+/g, " ").trim();
    lines.push(`- ${fact.id} [${kindLabel}] ${fact.fieldTitle}: ${valueOneLine}`);
  }

  lines.push("", "## Details nach Block", "");

  let currentStep = "";
  for (const fact of bundle.facts) {
    if (fact.stepTitle !== currentStep) {
      currentStep = fact.stepTitle;
      lines.push(`## ${currentStep}`);
    }

    if (fact.kind === "answer") {
      lines.push(`### ${fact.id} · ${fact.fieldTitle}`);
      if (fact.fieldDescription) {
        lines.push(`Beschreibung: ${fact.fieldDescription}`);
      }
      lines.push(`Antwort: ${fact.value}`);
      lines.push("");
      continue;
    }

    const kindLabel = fact.kind === "remark" ? "Bemerkung" : "Nachfrage";
    lines.push(`### ${fact.id} · ${fact.fieldTitle} (${kindLabel})`);
    lines.push(`${kindLabel}: ${fact.label}`);
    if (fact.kind === "follow_up" || (fact.value && fact.value !== fact.label)) {
      // For remarks, value may equal label when unanswered admin note
      if (fact.kind === "follow_up") {
        lines.push(`Antwort: ${fact.value}`);
      } else if (fact.value !== fact.label) {
        lines.push(`Inhalt: ${fact.value}`);
      }
    }
    lines.push("");
  }

  const answeredFields = new Set(bundle.facts.map((f) => f.fieldId)).size;
  lines.push(
    "---",
    `Kontext-Statistik: ${answeredFields} Felder mit Inhalt, ${bundle.facts.length} Facts, ${bundle.skippedFieldCount} unbeantwortete/leere Felder weggelassen.`,
    "Coverage: Jede Fact-ID aus der Checkliste muss im JSON-Ergebnis referenzierbar sein (Inhalt übernommen).",
  );

  return lines.join("\n").trim();
}

function normalizeForCoverage(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageNeedles(fact: SurveyFact): string[] {
  const value = fact.value.replace(/\s+/g, " ").trim();
  const needles: string[] = [];

  if (value.length >= 8) {
    needles.push(value);
  }

  // Distinctive chunks (rank lines, short phrases)
  for (const part of value.split(/[\n;,|/]+/)) {
    const p = part.replace(/^\d+\.\s*/, "").trim();
    if (p.length >= 6) needles.push(p);
  }

  // Short answers: pair with field title words
  if (value.length > 0 && value.length < 8) {
    needles.push(value);
  }

  return [...new Set(needles.map((n) => n.trim()).filter(Boolean))];
}

export type SurveyFactCoverageHit = {
  factId: string;
  status: "covered" | "weak" | "missing";
  matchedBy?: string;
};

export type SurveyFactCoverageReport = {
  total: number;
  covered: SurveyFactCoverageHit[];
  weak: SurveyFactCoverageHit[];
  missing: SurveyFactCoverageHit[];
  coverageRatio: number;
};

/**
 * Heuristic coverage check for Stufe 1/4.
 * Prefers exact-ish value presence; marks weak when only partial tokens match.
 * Later stages can require explicit fact_XXX citations.
 */
export function checkSurveyFactsCoverage(input: {
  facts: SurveyFact[];
  texts: string[];
}): SurveyFactCoverageReport {
  const haystack = normalizeForCoverage(input.texts.join("\n\n"));
  const covered: SurveyFactCoverageHit[] = [];
  const weak: SurveyFactCoverageHit[] = [];
  const missing: SurveyFactCoverageHit[] = [];

  for (const fact of input.facts) {
    const idNorm = normalizeForCoverage(fact.id);
    if (idNorm && haystack.includes(idNorm)) {
      covered.push({ factId: fact.id, status: "covered", matchedBy: fact.id });
      continue;
    }

    const needles = coverageNeedles(fact);
    let best: SurveyFactCoverageHit | null = null;

    for (const needle of needles) {
      const n = normalizeForCoverage(needle);
      if (!n) continue;
      if (haystack.includes(n)) {
        best = { factId: fact.id, status: "covered", matchedBy: needle };
        break;
      }
      // Weak: longest token ≥5 chars present
      const tokens = n.split(" ").filter((t) => t.length >= 5);
      const hitTokens = tokens.filter((t) => haystack.includes(t));
      if (tokens.length > 0 && hitTokens.length / tokens.length >= 0.6) {
        best = {
          factId: fact.id,
          status: "weak",
          matchedBy: hitTokens.join(" "),
        };
      }
    }

    if (best?.status === "covered") covered.push(best);
    else if (best?.status === "weak") weak.push(best);
    else missing.push({ factId: fact.id, status: "missing" });
  }

  const total = input.facts.length;
  const coverageRatio = total === 0 ? 1 : covered.length / total;

  return { total, covered, weak, missing, coverageRatio };
}

/** Drop-in context builder used by persona + anbieter paths. */
export function buildSurveyResponseContextForAgent(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  return formatSurveyFactsForAgentContext(extractSurveyFacts(input));
}
