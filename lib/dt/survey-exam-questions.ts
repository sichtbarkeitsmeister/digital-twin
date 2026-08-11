import type { SurveyFact } from "@/lib/dt/survey-facts";

export type SurveyExamAudience = "persona" | "company";

export type SurveyExamQuestion = {
  id: string;
  /** Question the tester sends to the twin (as the interviewer). */
  question: string;
  /** Short expected content from the questionnaire — for the tester only. */
  expectedHint: string;
  factId: string;
  kind: SurveyFact["kind"];
};

const PERSONA_WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_pain",
    question: "Was beschäftigt dich gerade am meisten — was liegt dir besonders auf dem Herzen?",
  },
  {
    id: "warmup_now",
    question: "Was ist für dich gerade die größte Herausforderung?",
  },
];

const COMPANY_WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_company_known",
    question: "Wofür seid ihr bekannt — was sollen Kunden über euch wissen?",
  },
  {
    id: "warmup_company_diff",
    question: "Was unterscheidet euch vom Wettbewerb?",
  },
];

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return (
    /[?？]$/.test(t) ||
    /^(wie|was|welche|welcher|welches|wo|wann|warum|weshalb|wieso|erzähl|beschreib|nenne|hast|hast du|seid|bist)\b/i.test(
      t,
    )
  );
}

function stripDecorations(title: string): string {
  return title
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, "")
    .replace(/\s*\((?:Ranking|Rangfolge|Mehrfachauswahl)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Company-perspective labels that describe the ideal customer, not the company itself. */
function isCustomerProfileMetaTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /\bwunsch/.test(t) ||
    /\bideal(?:en|e|er|es)?\b/.test(t) ||
    /\btypische[rns]?\b/.test(t) ||
    /\bkunden-?avatar\b/.test(t) ||
    /\bdigitale[rn]?\s+kunden\b/.test(t) ||
    /\bavatar-?name\b/.test(t) ||
    /\bzielgruppe\b/.test(t) ||
    /\bpersona\b/.test(t)
  );
}

/**
 * Rewrite 3rd-person “Wunschkunde/ideal customer” wording into a Du-question
 * for interviewing the persona avatar.
 */
function rewriteCustomerThirdPersonToSecondPerson(question: string): string {
  let q = question.trim();

  q = q.replace(/\bWie nehmen\b/gi, "Wie nimmst");
  q = q.replace(/\bWie kommen\b/gi, "Wie kommst");
  q = q.replace(/\bWie wählen\b/gi, "Wie wählst");
  q = q.replace(/\bWie entscheiden\b/gi, "Wie entscheidest");
  q = q.replace(/\bWie suchen\b/gi, "Wie suchst");
  q = q.replace(/\bWorauf legen\b/gi, "Worauf legst");
  q = q.replace(/\bWelche Wege nutzen\b/gi, "Welche Wege nutzt");
  q = q.replace(/\bWas erwarten\b/gi, "Was erwartest");
  q = q.replace(/\bWas brauchen\b/gi, "Was brauchst");
  q = q.replace(/\bWas sind\b/gi, "Was sind"); // kept; often followed by noun phrase

  q = q.replace(/\bWunsch-?Zahnärzt(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bideal(?:en|e|er|es)?\s+Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\btypische\s+Wunsch[\w-]*\b/gi, "du");

  // Cleanup awkward "du du" / "zu du" artifacts
  q = q.replace(/\bdu\s+du\b/gi, "du");
  q = q.replace(/\bzu\s+du\b/gi, "zu dir");
  q = q.replace(/\bvon\s+du\b/gi, "von dir");
  q = q.replace(/\bbei\s+du\b/gi, "bei dir");
  q = q.replace(/\s+/g, " ").trim();

  return q;
}

function topicFromCustomerMetaTitle(title: string): string {
  return stripDecorations(title)
    .replace(/^beschreibung\s+(des|der|die|dem)\s+/i, "")
    .replace(/\b(ideal(?:en|e|er|es)?|typische[rns]?|meisten)\s+/gi, "")
    .replace(/\b(name des digitalen kunden-avatars|avatar-?name)\b/gi, "Name")
    .replace(/\bwunsch-?[\wäöüÄÖÜß-]+/gi, "")
    .replace(/\b(der|des|die|dem|den)\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPersonaInterviewQuestion(fact: SurveyFact): string | null {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) return "Erzähl mir bitte etwas über dich.";

  // Admin/meta naming fields → identity probe
  if (/^(name des digitalen kunden-avatars|avatar-?name)$/i.test(raw)) {
    return "Wie heißt du?";
  }

  // Already a usable 2nd-person question
  if (
    looksLikeQuestion(raw) &&
    /\b(du|dir|dich|dein|deine|deiner|deinem|deinen)\b/i.test(raw)
  ) {
    return raw;
  }

  if (looksLikeQuestion(raw) && isCustomerProfileMetaTitle(raw)) {
    return rewriteCustomerThirdPersonToSecondPerson(raw);
  }

  if (looksLikeQuestion(raw) && !isCustomerProfileMetaTitle(raw)) {
    return raw;
  }

  // Rankings / lists first — keep the topic, don't collapse into generic contact probes.
  if (
    fact.fieldType === "ranking" ||
    fact.fieldType === "checkbox" ||
    fact.fieldType === "text_list" ||
    /priorit|reihenfolge|ranking/i.test(raw)
  ) {
    const topic = topicFromCustomerMetaTitle(raw) || raw;
    return `Was ist dir bei „${topic}“ besonders wichtig — und warum in dieser Reihenfolge?`;
  }

  // Profile meta → concrete Du-probes
  if (/beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)) {
    return "Erzähl mir bitte kurz von dir — wer bist du, und was ist dir in deiner Situation besonders wichtig?";
  }

  if (/\balter\b/i.test(raw)) {
    return "Wie alt bist du — oder in welcher Altersgruppe siehst du dich?";
  }

  if (/praxisgröße|praxisgroesse|mitarbeiter|teamgröße|teamgroesse|betriebsgröße/i.test(raw)) {
    return "Wie groß ist deine Praxis oder dein Betrieb — wie seid ihr aufgestellt?";
  }

  if (/einzugsgebiet|region|standort|gebiet/i.test(raw)) {
    return "Wo bist du tätig, und aus welchem Einzugsgebiet kommst du bzw. kommen deine Patienten/Kunden?";
  }

  if (/kontaktweg|kontakt auf|erstkontakt|erreichen/i.test(raw)) {
    return "Wie nimmst du typischerweise Kontakt zu Anbietern auf — welche Wege nutzt du?";
  }

  if (/schwerpunkt/i.test(raw)) {
    return "Was sind die Schwerpunkte deiner Arbeit oder Praxis?";
  }

  if (isCustomerProfileMetaTitle(raw)) {
    const topic = topicFromCustomerMetaTitle(raw);
    if (!topic || topic.length < 3) {
      return "Erzähl mir bitte etwas über dich und deine Situation.";
    }
    return `Erzähl mir bitte aus deiner Sicht: ${topic}`;
  }

  return `Erzähl mir bitte: ${raw}`;
}

function toCompanyInterviewQuestion(fact: SurveyFact): string {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) return "Was sollten wir über euer Unternehmen wissen?";
  if (looksLikeQuestion(raw)) return raw;

  if (fact.fieldType === "ranking" || fact.fieldType === "checkbox" || fact.fieldType === "text_list") {
    return `Was ist euch bei „${raw}“ besonders wichtig — und warum in dieser Reihenfolge?`;
  }

  return `Erzähl mir bitte: ${raw}`;
}

/**
 * Skip company-only facts when probing a Wunschkunde persona
 * (e.g. “Mit welchen Zahnärzten arbeitet die Firma …”).
 */
function isCompanyOnlyFactForPersona(fact: SurveyFact): boolean {
  const t = `${fact.fieldTitle} ${fact.label}`.toLowerCase();
  if (isCustomerProfileMetaTitle(t)) return false;
  return (
    /\b(firma|unternehmen|organisation|labor|kanzlei|unsere?|ihr|euch|wettbewerb|mitbewerber)\b/.test(
      t,
    ) && !/\b(wunsch|ideal|typische|kunde|kunden|avatar|persona)\b/.test(t)
  );
}

function hintFromValue(value: string, max = 160): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/**
 * Build an interviewer script from questionnaire facts (deterministic, no LLM).
 *
 * - `persona`: ask the Wunschkunde as “du” (customer situation).
 * - `company`: ask the SEO/company twin about firm facts.
 */
export function buildSurveyExamQuestions(
  facts: SurveyFact[],
  options?: { maxQuestions?: number; audience?: SurveyExamAudience },
): SurveyExamQuestion[] {
  const maxQuestions = options?.maxQuestions ?? 14;
  const audience: SurveyExamAudience = options?.audience ?? "persona";
  const out: SurveyExamQuestion[] = [];
  const seenNorm = new Set<string>();

  function push(q: SurveyExamQuestion) {
    const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNorm.has(key)) return;
    seenNorm.add(key);
    out.push(q);
  }

  const warmups = audience === "company" ? COMPANY_WARMUP : PERSONA_WARMUP;
  for (const w of warmups) {
    push({
      id: w.id,
      question: w.question,
      expectedHint:
        audience === "company"
          ? "Offene Firmenfrage — Inhalt aus Anbieter-Wissen prüfen."
          : "Offene Einstiegsfrage — Inhalt aus Persona-Prompt prüfen.",
      factId: "",
      kind: "answer",
    });
  }

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  const ordered = [...answerFacts, ...followUps];

  for (const fact of ordered) {
    if (out.length >= maxQuestions) break;

    if (audience === "persona" && isCompanyOnlyFactForPersona(fact)) {
      continue;
    }

    const question =
      audience === "company"
        ? toCompanyInterviewQuestion(fact)
        : toPersonaInterviewQuestion(fact);
    if (!question) continue;

    push({
      id: `exam_${fact.id}`,
      question,
      expectedHint: hintFromValue(fact.value),
      factId: fact.id,
      kind: fact.kind,
    });
  }

  return out.slice(0, maxQuestions);
}
