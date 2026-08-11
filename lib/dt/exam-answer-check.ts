import Anthropic from "@anthropic-ai/sdk";

import {
  extractAnthropicText,
  isAnthropicModelNotFoundError,
} from "@/lib/ai/anthropic-helpers";

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
 * Offline fallback when Anthropic is unavailable — rough keyword overlap so the
 * UI always gets a green/red hint instead of failing silently.
 */
export function heuristicExamAnswerSuggestion(input: {
  expectedHint: string;
  assistantAnswer: string;
}): ExamAnswerCheckSuggestion {
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
        ? "Die erwarteten Fragebogen-Angaben sind in der Antwort kaum erkennbar."
        : `Nur teilweise abgedeckt (${hits.slice(0, 3).join(", ")}); Kerninhalt fehlt.`,
    confidence: "low",
  };
}

/** Cheap Haiku check: does the twin answer cover the questionnaire expectation? */
export async function checkExamAnswerAgainstExpected(input: {
  question: string;
  expectedHint: string;
  assistantAnswer: string;
}): Promise<ExamAnswerCheckSuggestion | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const userPrompt = [
    "Prüffrage an die Persona:",
    input.question.trim().slice(0, 800),
    "",
    "SOLL-Inhalt aus dem Fragebogen (muss sinngemäß vorkommen):",
    input.expectedHint.trim().slice(0, 1500),
    "",
    "IST-Antwort der Persona:",
    input.assistantAnswer.trim().slice(0, 4000),
    "",
    'Antworte NUR als JSON: {"suggested":"pass"|"fail","reason":"kurzer deutscher Satz","confidence":"high"|"medium"|"low"}',
    "pass = Kerninhalt der SOLL-Antwort ist sinngemäß enthalten (Paraphrase ok).",
    "fail = Kerninhalt fehlt, ist falsch oder wird durch etwas anderes ersetzt.",
  ].join("\n");

  for (const model of resolveExamCheckModels()) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 220,
        system:
          "Du bist ein strenger aber fairer Prüfer für DigitalTwin-Personas. Vergleiche SOLL (Fragebogen) mit IST (Antwort). Kein Markdown, nur JSON.",
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
}): Promise<ExamAnswerCheckSuggestion & { via: "ai" | "heuristic" }> {
  const ai = await checkExamAnswerAgainstExpected(input);
  if (ai) return { ...ai, via: "ai" };
  return { ...heuristicExamAnswerSuggestion(input), via: "heuristic" };
}
