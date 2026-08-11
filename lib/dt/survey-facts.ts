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

/** Cross-ref placeholders are resolved via Freigabe — not expected verbatim in the persona. */
function isCrossRefPlaceholderValue(value: string): boolean {
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length < 8) return false;
  return (
    /siehe\s+(den\s+)?(arbeitgeber|arbeitnehmer|anbieter|anderen?\s+fragebogen)/i.test(v) ||
    /ist\s+die\s+gleiche\s+wie\s+beim?\s+arbeitgeber/i.test(v) ||
    /gleiche?\s+\w*\s*wie\s+(beim?|der|die|dem)\s+arbeitgeber/i.test(v) ||
    /bitte\s+.*(übernehmen|übernahme)/i.test(v) ||
    /arbeitgeber[\s-]*(fragebogen|umfrage)/i.test(v)
  );
}

const COVERAGE_STOPWORDS = new Set(
  [
    "aber",
    "auch",
    "beim",
    "dann",
    "dass",
    "dein",
    "deine",
    "dem",
    "den",
    "der",
    "des",
    "die",
    "diese",
    "dieser",
    "dieses",
    "doch",
    "durch",
    "eine",
    "einem",
    "einen",
    "einer",
    "eines",
    "etwa",
    "etwas",
    "fuer",
    "ganz",
    "gibt",
    "haben",
    "hast",
    "hier",
    "immer",
    "kann",
    "keine",
    "kein",
    "mehr",
    "mein",
    "meine",
    "mich",
    "mir",
    "mit",
    "nach",
    "nicht",
    "noch",
    "oder",
    "ohne",
    "schon",
    "sehr",
    "sein",
    "seine",
    "sich",
    "sie",
    "sind",
    "soll",
    "sonst",
    "ueber",
    "und",
    "uns",
    "unter",
    "vom",
    "von",
    "vor",
    "was",
    "wenn",
    "wer",
    "wie",
    "wird",
    "wo",
    "wollen",
    "wurde",
    "werden",
    "zwischen",
  ].map((w) => normalizeForCoverage(w)),
);

function coverageTokens(normalizedNeedle: string): string[] {
  return normalizedNeedle
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 5)
    .filter((t) => !COVERAGE_STOPWORDS.has(t));
}

function distinctiveCoverageTokens(normalizedNeedle: string): string[] {
  return coverageTokens(normalizedNeedle).filter((t) => t.length >= 6);
}

function coverageNeedles(fact: SurveyFact): string[] {
  const value = fact.value.replace(/\s+/g, " ").trim();
  const needles: string[] = [];

  if (value.length >= 8) {
    needles.push(value);
  }

  // Leading distinctive span (paraphrases often keep the opening specifics)
  if (value.length >= 48) {
    needles.push(value.slice(0, 48).trim());
  }

  // Distinctive chunks (rank lines, short phrases)
  for (const part of value.split(/[\n;,|/]+/)) {
    const p = part.replace(/^\d+\.\s*/, "").trim();
    if (p.length >= 6) needles.push(p);
  }

  // Quoted phrases from the answer
  for (const m of value.matchAll(/[„""]([^„""]{6,80})["""]/g)) {
    const q = m[1]?.trim();
    if (q) needles.push(q);
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
    // Cross-refs are imported via Freigabe — skip noisy false missing/weak.
    if (isCrossRefPlaceholderValue(fact.value)) {
      covered.push({
        factId: fact.id,
        status: "covered",
        matchedBy: "cross_ref_placeholder",
      });
      continue;
    }

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

      const tokens = coverageTokens(n);
      if (tokens.length === 0) continue;

      const hitTokens = tokens.filter((t) => haystack.includes(t));
      const ratio = hitTokens.length / tokens.length;
      const distinctive = distinctiveCoverageTokens(n);
      const hitDistinctive = distinctive.filter((t) => haystack.includes(t));

      // Strong paraphrase: most distinctive tokens present → treat as covered
      // (reduces false „unsicher“ when the persona rephrases but keeps key terms).
      if (
        distinctive.length >= 2 &&
        hitDistinctive.length / distinctive.length >= 0.7 &&
        hitDistinctive.length >= 2
      ) {
        best = {
          factId: fact.id,
          status: "covered",
          matchedBy: hitDistinctive.join(" "),
        };
        break;
      }

      // Weak only when enough content tokens hit — not on stopword noise alone.
      if (ratio >= 0.7 && hitTokens.length >= 2) {
        const candidate: SurveyFactCoverageHit = {
          factId: fact.id,
          status: "weak",
          matchedBy: hitTokens.join(" "),
        };
        if (!best || best.status !== "covered") best = candidate;
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

export type SurveyFactCoverageSummary = {
  total: number;
  coveredCount: number;
  weakCount: number;
  missingCount: number;
  coverageRatio: number;
  missing: Array<{
    factId: string;
    fieldTitle: string;
    kind: SurveyFactKind;
    valuePreview: string;
    /** Fuller text for review / prompt insertion. */
    valueText: string;
    matchedBy?: string;
  }>;
  weak: Array<{
    factId: string;
    fieldTitle: string;
    kind: SurveyFactKind;
    valuePreview: string;
    valueText: string;
    matchedBy?: string;
  }>;
};

function valuePreview(value: string, max = 120): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function valueTextForReview(value: string, max = 2_000): string {
  const t = value.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Open fact IDs (missing + weak) that still need review before save.
 * Accepted IDs (Passt so / in Prompt übernommen) are excluded.
 */
export function unresolvedSurveyFactCoverageIds(
  summary: Pick<SurveyFactCoverageSummary, "missing" | "weak">,
  acceptedFactIds: Iterable<string> = [],
): string[] {
  const accepted = new Set(acceptedFactIds);
  const open = [...summary.missing, ...summary.weak]
    .map((item) => item.factId)
    .filter((id) => !accepted.has(id));
  return [...new Set(open)];
}

/** Compact coverage payload for API / wizard. */
export function summarizeSurveyFactCoverage(input: {
  facts: SurveyFact[];
  report: SurveyFactCoverageReport;
}): SurveyFactCoverageSummary {
  const byId = new Map(input.facts.map((f) => [f.id, f]));

  function mapHits(hits: SurveyFactCoverageHit[]) {
    return hits.map((h) => {
      const fact = byId.get(h.factId);
      const raw = fact?.value ?? "";
      return {
        factId: h.factId,
        fieldTitle: fact?.fieldTitle ?? h.factId,
        kind: fact?.kind ?? ("answer" as SurveyFactKind),
        valuePreview: valuePreview(raw),
        valueText: valueTextForReview(raw),
        matchedBy: h.matchedBy,
      };
    });
  }

  return {
    total: input.report.total,
    coveredCount: input.report.covered.length,
    weakCount: input.report.weak.length,
    missingCount: input.report.missing.length,
    coverageRatio: input.report.coverageRatio,
    missing: mapHits(input.report.missing),
    weak: mapHits(input.report.weak),
  };
}

/** Draft block an admin can insert into prompt_template for one fact. */
export function formatFactForPromptInsertion(input: {
  fieldTitle: string;
  kind: SurveyFactKind;
  valueText: string;
}): string {
  const kindLabel =
    input.kind === "remark" ? "Bemerkung" : input.kind === "follow_up" ? "Nachfrage" : "Antwort";
  const body = input.valueText.trim();
  return `\n\n### ${input.fieldTitle}\n(${kindLabel} aus Umfrage)\n${body}\n`;
}

/** Text block of missing/weak facts for a targeted repair prompt. */
export function formatFactsForCoverageRepair(input: {
  facts: SurveyFact[];
  factIds: string[];
}): string {
  const wanted = new Set(input.factIds);
  const lines = input.facts
    .filter((f) => wanted.has(f.id))
    .map((f) => {
      const kindLabel =
        f.kind === "remark" ? "Bemerkung" : f.kind === "follow_up" ? "Nachfrage" : "Antwort";
      return `- ${f.id} [${kindLabel}] ${f.fieldTitle}: ${f.value.replace(/\s+/g, " ").trim()}`;
    });
  return lines.length > 0 ? lines.join("\n") : "(keine Facts)";
}

/**
 * Company knowledge for the SEO advisor: topic + fact, no avatar pipeline noise.
 * Keeps the field title as context (so numbers/answers stay interpretable) but
 * drops fact_IDs, Pflicht-Checkliste, coverage stats, and duplicated detail blocks.
 */
export function formatSurveyFactsForSeoKnowledge(bundle: SurveyFactsBundle): string {
  if (bundle.facts.length === 0) {
    return "Keine verwertbaren Unternehmensfakten gefunden.";
  }

  const lines: string[] = [];
  let currentStep = "";
  let lastFieldId = "";

  for (const fact of bundle.facts) {
    if (fact.stepTitle !== currentStep) {
      currentStep = fact.stepTitle;
      lastFieldId = "";
      if (lines.length > 0) lines.push("");
      lines.push(`## ${currentStep}`);
      lines.push("");
    }

    if (fact.kind === "answer") {
      if (lastFieldId && lastFieldId !== fact.fieldId) lines.push("");
      lines.push(`**${fact.fieldTitle}**`);
      lines.push(fact.value.trim());
      lastFieldId = fact.fieldId;
      continue;
    }

    // Remark / follow-up: nest under the same topic when possible.
    if (fact.fieldId !== lastFieldId) {
      if (lastFieldId) lines.push("");
      lines.push(`**${fact.fieldTitle}**`);
      lastFieldId = fact.fieldId;
    }

    if (fact.kind === "remark") {
      const remarkBody = fact.value.trim();
      const label = fact.label.trim();
      const compact =
        remarkBody === label
          ? remarkBody
          : remarkBody.startsWith(label)
            ? remarkBody.slice(label.length).trim() || remarkBody
            : remarkBody;
      lines.push(`_Bemerkung:_ ${compact}`);
      continue;
    }

    lines.push(`_Nachfrage:_ ${fact.label.trim()}`);
    lines.push(fact.value.trim());
  }

  return lines.join("\n").trim();
}

/** Context builder for survey → persona (includes coverage checklist). */
export function buildSurveyResponseContextForAgent(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  return formatSurveyFactsForAgentContext(extractSurveyFacts(input));
}

/** SEO knowledge body from questionnaire facts (1:1, no LLM). */
export function buildSurveyResponseContextForSeo(input: {
  surveyTitle: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
}): string {
  return formatSurveyFactsForSeoKnowledge(extractSurveyFacts(input));
}
