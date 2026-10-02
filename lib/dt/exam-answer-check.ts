import Anthropic from "@anthropic-ai/sdk";

import {
  extractAnthropicText,
  isAnthropicModelNotFoundError,
} from "@/lib/ai/anthropic-helpers";
import { isOpenTopicSoll } from "@/lib/dt/persona-config-exam";

export type ExamAnswerCheckAudience = "persona" | "company";

/** Where SOLL came from: a questionnaire, or the twin's own settings. */
export type ExamSollBasis = "survey" | "persona";

export type ExamAnswerCheckSuggestion = {
  suggested: "pass" | "fail";
  reason: string;
  confidence: "high" | "medium" | "low";
};

function resolveExamCheckModels(): string[] {
  const preferred =
    process.env.ANTHROPIC_DT_TITLE_MODEL?.trim() ||
    process.env.ANTHROPIC_DT_PERSONA_MODEL?.trim() ||
    "claude-haiku-4-5-20251001";
  return Array.from(
    new Set([preferred, "claude-haiku-4-5-20251001", "claude-3-5-haiku-latest"].filter(Boolean)),
  );
}

export function parseExamAnswerSuggestion(raw: string): ExamAnswerCheckSuggestion | null {
  const text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      suggested?: string;
      reason?: string;
      confidence?: string;
    };
    const suggested =
      parsed.suggested === "pass" || parsed.suggested === "fail" ? parsed.suggested : null;
    const reason = String(parsed.reason ?? "").trim();
    const confidence =
      parsed.confidence === "high" ||
      parsed.confidence === "medium" ||
      parsed.confidence === "low"
        ? parsed.confidence
        : "medium";
    if (!suggested || !reason) return null;
    return { suggested, reason: reason.slice(0, 320), confidence };
  } catch {
    return null;
  }
}

/** Tokenize SOLL text into comparable chunks (words / short phrases). */
export function examHintTokens(expectedHint: string): string[] {
  return expectedHint
    .toLowerCase()
    .split(/[\n,;/|•·]+/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((t) => t.replace(/[^\p{L}\p{N}\-äöüÄÖÜß]/gu, "").trim())
    .filter((t) => t.length >= 4);
}

/**
 * Questions that probe what the twin knows about the company/brand —
 * for Wunschkunden only shallow external knowledge is expected.
 */
export function looksLikeCompanyKnowledgeProbe(question: string): boolean {
  const t = question.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /was\s+(wei[sß]t|kennst|hast)\s+du.{0,40}über\b/u.test(t) ||
    /welche[rn]?\s+leistungen/.test(t) ||
    /was\s+bietet/.test(t) ||
    /was\s+macht\s+.{0,40}(firma|unternehmen|praxis|anbieter)/.test(t) ||
    /erzähl.{0,30}(von|über)\s+(der|dem|die|das)?\s*(firma|unternehmen|praxis)/.test(t) ||
    /kennst\s+du\s+(unsere|eure)\s+(leistungen|firma|unternehmen)/.test(t)
  );
}

/**
 * Offline fallback when Anthropic is unavailable — rough keyword overlap so the
 * UI always gets a green/red hint instead of failing silently.
 */
export function heuristicExamAnswerSuggestion(input: {
  expectedHint: string;
  assistantAnswer: string;
  question?: string;
  audience?: ExamAnswerCheckAudience;
  basis?: ExamSollBasis;
}): ExamAnswerCheckSuggestion {
  const audience = input.audience === "company" ? "company" : "persona";
  const fromPersona = input.basis === "persona";
  const question = input.question?.trim() ?? "";

  // Interessent asked about the company: shallow knowledge is the correct role.
  if (audience === "persona" && looksLikeCompanyKnowledgeProbe(question)) {
    return {
      suggested: "pass",
      reason:
        "Als Interessent reicht oberflächliches Firmenwissen von außen — kein vollständiger Leistungskatalog nötig.",
      confidence: "low",
    };
  }

  if (isOpenTopicSoll(input.expectedHint)) {
    if (input.assistantAnswer.trim().length < 12) {
      return {
        suggested: "fail",
        reason: "Die Antwort ist zu dünn für eine Frage aus dem Persona-Gespräch.",
        confidence: "low",
      };
    }
    return {
      suggested: "pass",
      reason:
        "Zu diesem Punkt steht kein eigener Fakt in den Einstellungen. Die Antwort bleibt in der Rolle.",
      confidence: "low",
    };
  }

  const tokens = examHintTokens(input.expectedHint);
  const answer = input.assistantAnswer.toLowerCase();
  if (tokens.length === 0) {
    return {
      suggested: "fail",
      reason: "SOLL-Inhalt ist unklar — bitte manuell prüfen.",
      confidence: "low",
    };
  }
  const hits = tokens.filter((t) => answer.includes(t));
  const ratio = hits.length / tokens.length;
  if (ratio >= 0.45 || hits.length >= 3) {
    return {
      suggested: "pass",
      reason: `Wesentliche SOLL-Begriffe kommen vor (${hits.slice(0, 4).join(", ")}).`,
      confidence: ratio >= 0.7 ? "medium" : "low",
    };
  }
  return {
    suggested: "fail",
    reason:
      hits.length === 0
        ? fromPersona
          ? "Die erwarteten Angaben aus den Persona-Einstellungen sind in der Antwort kaum erkennbar."
          : "Die erwarteten Fragebogen-Angaben sind in der Antwort kaum erkennbar."
        : `Nur teilweise abgedeckt (${hits.slice(0, 3).join(", ")}); Kerninhalt fehlt.`,
    confidence: "low",
  };
}

export function buildExamCheckUserPrompt(input: {
  question: string;
  expectedHint: string;
  assistantAnswer: string;
  audience?: ExamAnswerCheckAudience;
  basis?: ExamSollBasis;
}): string {
  const audience = input.audience === "company" ? "company" : "persona";
  const fromPersona = input.basis === "persona";
  const sollLead =
    audience === "company"
      ? fromPersona
        ? "SOLL aus den hinterlegten Firmen-Einstellungen (muss sinngemäß vorkommen):"
        : "SOLL-Inhalt aus dem Anbieter-Fragebogen (muss sinngemäß vorkommen):"
      : fromPersona
        ? "SOLL aus den Persona-Einstellungen (DISG, Pain Points, Entscheidungskriterien, Hormozi — nur was dort steht):"
        : "SOLL aus dem Fragebogen (Persona-Situation/Fakten — KEIN Anspruch auf Firmen-Enzyklopädie):";

  if (audience === "company") {
    return [
      "Prüffrage an den Firmen-/SEO-Assistenten:",
      input.question.trim().slice(0, 800),
      "",
      sollLead,
      input.expectedHint.trim().slice(0, 1500),
      "",
      "IST-Antwort:",
      input.assistantAnswer.trim().slice(0, 4000),
      "",
      'Antworte NUR als JSON: {"suggested":"pass"|"fail","reason":"kurzer deutscher Satz","confidence":"high"|"medium"|"low"}',
      "pass = Kerninhalt der zur Prüffrage passenden SOLL-Angaben ist sinngemäß enthalten (Paraphrase ok).",
      "fail = Kerninhalt fehlt, ist falsch oder wird durch etwas anderes ersetzt.",
      "Beginnt der SOLL mit „Kein festes Soll“: es gibt keinen hinterlegten Fakt. pass, wenn die Antwort in der Rolle bleibt und zur Frage etwas sagt. fail nur bei leerer Antwort oder Rollenbruch.",
      "Wenn der SOLL-Block mehrere Fakten enthält: nur die zur Prüffrage relevanten bewerten.",
    ].join("\n");
  }

  return [
    "Prüffrage an die Wunschkunden-/Interessenten-Persona:",
    input.question.trim().slice(0, 800),
    "",
    sollLead,
    input.expectedHint.trim().slice(0, 1500),
    "",
    "IST-Antwort der Persona:",
    input.assistantAnswer.trim().slice(0, 4000),
    "",
    'Antworte NUR als JSON: {"suggested":"pass"|"fail","reason":"kurzer deutscher Satz","confidence":"high"|"medium"|"low"}',
    "Rolle: Die Persona ist Interessent/Pre-Sale. Sie kennt das Unternehmen nur so, wie man es von außen kennt (Website kurz gesehen, Werbung, Hörensagen) — nicht alle Leistungen, Preise oder internen Details.",
    "Bei Fragen ZUR FIRMA / ZU LEISTUNGEN: pass, wenn die Antwort glaubwürdig oberflächlich bleibt. Ein fehlender vollständiger Leistungskatalog ist KEIN fail. fail nur bei erfundenem Insiderwissen, Widerspruch zu Persona-Fakten oder wenn sie plötzlich Markenbotschafter/Mitarbeiter wird.",
      "Bei Fragen ZUR EIGENEN PERSON/SITUATION (Alter, Budget, Schmerz, Wie gefunden, …): pass, wenn die dazu passenden SOLL-Fakten sinngemäß vorkommen; fail, wenn Kerninhalt fehlt oder widerspricht.",
    "Beginnt der SOLL mit „Kein festes Soll“: es gibt keinen hinterlegten Fakt. pass, wenn die Antwort in der Rolle bleibt und zur Frage etwas sagt. fail nur bei leerer Antwort oder Rollenbruch.",
    "Wenn der SOLL-Block mehrere Fakten enthält: nur die zur Prüffrage relevanten bewerten; Firmen-Detailkataloge nicht als Pflichtwissen der Persona behandeln.",
  ].join("\n");
}

function examCheckSystemPrompt(
  audience: ExamAnswerCheckAudience,
  basis: ExamSollBasis,
): string {
  if (audience === "company") {
    const source = basis === "persona" ? "hinterlegte Einstellungen" : "Fragebogen";
    return `Du bist ein strenger aber fairer Prüfer für Firmen-/SEO-Assistenten. Vergleiche SOLL (${source}) mit IST (Antwort). Kein Markdown, nur JSON.`;
  }
  const source =
    basis === "persona" ? "den Persona-Einstellungen" : "dem Fragebogen";
  return `Du bist ein strenger aber fairer Prüfer für Wunschkunden-Personas (Interessenten). Persona-Fakten aus ${source} müssen stimmen; Firmenwissen darf nur oberflächlich sein. Kein Markdown, nur JSON.`;
}

/** Cheap Haiku check: does the twin answer match questionnaire expectations for its role? */
export async function checkExamAnswerAgainstExpected(input: {
  question: string;
  expectedHint: string;
  assistantAnswer: string;
  audience?: ExamAnswerCheckAudience;
  basis?: ExamSollBasis;
}): Promise<ExamAnswerCheckSuggestion | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const audience = input.audience === "company" ? "company" : "persona";
  const basis = input.basis === "persona" ? "persona" : "survey";
  const client = new Anthropic({ apiKey });
  const userPrompt = buildExamCheckUserPrompt({ ...input, audience, basis });

  for (const model of resolveExamCheckModels()) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 220,
        system: examCheckSystemPrompt(audience, basis),
        messages: [{ role: "user", content: userPrompt }],
      });
      const suggestion = parseExamAnswerSuggestion(extractAnthropicText(res));
      if (suggestion) return suggestion;
    } catch (error) {
      if (isAnthropicModelNotFoundError(error)) continue;
      console.warn("[dt] exam answer check failed", { model }, error);
    }
  }

  return null;
}

/** AI check with heuristic fallback — always returns a verdict for the UI. */
export async function checkExamAnswerAgainstExpectedOrHeuristic(input: {
  question: string;
  expectedHint: string;
  assistantAnswer: string;
  audience?: ExamAnswerCheckAudience;
  basis?: ExamSollBasis;
}): Promise<ExamAnswerCheckSuggestion & { via: "ai" | "heuristic" }> {
  const ai = await checkExamAnswerAgainstExpected(input);
  if (ai) return { ...ai, via: "ai" };
  return { ...heuristicExamAnswerSuggestion(input), via: "heuristic" };
}
