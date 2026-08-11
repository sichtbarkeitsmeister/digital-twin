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

/** Soft openers last — fact probes come first so Testing verifies questionnaire coverage. */
const PERSONA_WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_pain",
    question:
      "Was beschäftigt dich gerade am meisten — und was davon würdest du einem Anbieter als Erstes erzählen?",
  },
];

const COMPANY_WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_company_known",
    question:
      "Wenn ich euer Unternehmen in einem Satz treffen soll: Wofür seid ihr bekannt, und was dürfen wir nicht weglassen?",
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

  q = q.replace(/\bWunsch-?Zahnärzt(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bideal(?:en|e|er|es)?\s+Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\btypische\s+Wunsch[\w-]*\b/gi, "du");

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

function firstRankingItem(value: string): string | null {
  const numbered = value.match(/(?:^|\n)\s*1\.\s*([^\n]+)/);
  if (numbered?.[1]?.trim()) return numbered[1].trim();

  const m = value.match(/(?:^|[\n,;])\s*([^\n,;]+)/);
  const item = m?.[1]?.replace(/^\d+\.\s*/, "").trim();
  if (item && !/^rangfolge\b/i.test(item) && !/^nicht gewählt\b/i.test(item)) {
    return item.length > 1 ? item : null;
  }
  return null;
}

/** Ask so the twin must surface the stored fact — not just chat vaguely. */
function toPersonaInterviewQuestion(fact: SurveyFact): string | null {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) return "Erzähl mir bitte konkret etwas über dich und deine Situation.";

  if (/^(name des digitalen kunden-avatars|avatar-?name)$/i.test(raw)) {
    return "Wie heißt du — und wie soll ich dich ansprechen?";
  }

  if (
    looksLikeQuestion(raw) &&
    /\b(du|dir|dich|dein|deine|deiner|deinem|deinen)\b/i.test(raw)
  ) {
    return softenExistingQuestion(raw);
  }

  if (looksLikeQuestion(raw) && isCustomerProfileMetaTitle(raw)) {
    return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
  }

  if (looksLikeQuestion(raw) && !isCustomerProfileMetaTitle(raw)) {
    return softenExistingQuestion(raw);
  }

  if (
    fact.fieldType === "ranking" ||
    fact.fieldType === "checkbox" ||
    fact.fieldType === "text_list" ||
    /priorit|reihenfolge|ranking/i.test(raw)
  ) {
    const topic = topicFromCustomerMetaTitle(raw) || raw;
    if (/kontaktweg|aufmerksam|findest|suche|kanal|empfehlung|google|messe/i.test(`${topic} ${raw}`)) {
      return (
        "Worüber findest du typischerweise ein neues Labor oder einen neuen Partner — " +
        "was kommt für dich zuerst, und wie sieht die Reihenfolge dahinter aus?"
      );
    }
    if (/entscheid|anbieterwahl|kriterium|wichtig/i.test(`${topic} ${raw}`)) {
      return (
        "Wonach entscheidest du dich für einen Anbieter — " +
        "was hat für dich die höchste Priorität, und was kommt danach?"
      );
    }
    return (
      `Wenn du an „${shortTopic(topic)}" denkst: was ist dir am wichtigsten, ` +
      "und wie würdest du die Reihenfolge dahinter sortieren?"
    );
  }

  if (/beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)) {
    return "Erzähl mal kurz: Wer bist du, was prägt dich gerade, und worauf legst du besonders Wert?";
  }

  if (/\balter\b/i.test(raw)) {
    return "In welchem Alter bzw. welcher Altersgruppe siehst du dich?";
  }

  if (/praxisgröße|praxisgroesse|mitarbeiter|teamgröße|teamgroesse|betriebsgröße/i.test(raw)) {
    return "Wie groß ist eure Praxis oder euer Betrieb — wie seid ihr so aufgestellt?";
  }

  if (/einzugsgebiet|region|standort|gebiet/i.test(raw)) {
    return "Wo bist du unterwegs, und aus welcher Region kommen deine Patienten oder Kunden?";
  }

  if (/kontaktweg|kontakt auf|erstkontakt|erreichen/i.test(raw)) {
    return "Wie gehst du typischerweise auf Anbieter zu — welchen Weg nutzt du zuerst?";
  }

  if (/schwerpunkt/i.test(raw)) {
    return "Was sind die Schwerpunkte bei dir in der Praxis — worauf liegt der Fokus?";
  }

  if (/sorg|einwand|hürde|problem|schmerz|ärger|frust/i.test(raw)) {
    return "Was beschäftigt dich gerade am meisten — welche Sorgen oder Einwände hast du?";
  }

  if (/entscheid|kriterium|wichtig/i.test(raw)) {
    return "Wonach suchst du dir einen Anbieter aus — was muss für dich unbedingt stimmen?";
  }

  if (isCustomerProfileMetaTitle(raw)) {
    const topic = topicFromCustomerMetaTitle(raw);
    if (!topic || topic.length < 3) {
      return "Erzähl mir kurz von dir und deiner Situation.";
    }
    return `Zu „${shortTopic(topic)}": Was trifft auf dich zu — aus deiner Sicht?`;
  }

  return `Zu „${shortTopic(raw)}": Was gilt für dich persönlich?`;
}

function shortTopic(topic: string): string {
  const t = topic.replace(/\s+/g, " ").trim();
  return t.length <= 48 ? t : `${t.slice(0, 47)}…`;
}

function softenExistingQuestion(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim().replace(/[?？]+$/g, "");
  // Drop exam-speak that makes questions sound like a checklist.
  q = q.replace(/\s*[—–-]\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*und wie lautet die komplette Reihenfolge\.?$/i, "");
  q = q.replace(/\s*was steht bei dir bei\s*[„"][^„"]+[“"]\s*an erster Stelle/gi, "");
  if (!q || q.length < 8) return `${raw.replace(/[?？]+$/g, "")}?`;
  return `${q}?`;
}

function toCompanyInterviewQuestion(fact: SurveyFact): string {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) return "Welche Unternehmensfakten müssen wir aus dem Fragebogen treffen?";
  if (looksLikeQuestion(raw)) {
    return `${raw.replace(/\?$/, "")} — bitte mit den konkreten Angaben aus eurem Wissen.`;
  }

  if (fact.fieldType === "ranking" || fact.fieldType === "checkbox" || fact.fieldType === "text_list") {
    return (
      `Zu „${shortTopic(raw)}": Was steht bei euch ganz oben — ` +
      "und wie lautet die Reihenfolge laut Fragebogen?"
    );
  }

  if (/\d/.test(fact.value) || /%|€|euro|stern|platz|nr\.?/i.test(fact.value)) {
    return `Zu „${raw}“: Welche konkreten Zahlen oder Fakten gelten bei euch?`;
  }

  return `Zu „${raw}“: Was steht dazu in eurem Unternehmenswissen — bitte wörtlich und vollständig genug?`;
}

/**
 * Skip company-only facts when probing a Wunschkunde persona.
 * Catches firm names (“TM Dentaltechnik”), “am liebsten zusammen”, Labor/Kanzlei, etc.
 */
function isCompanyOnlyFactForPersona(fact: SurveyFact): boolean {
  const t = `${fact.fieldTitle} ${fact.label}`.toLowerCase();
  if (isCustomerProfileMetaTitle(t)) return false;

  // “Mit welchen X arbeitet [Firma] am liebsten zusammen?”
  if (
    /mit welchen\b/.test(t) &&
    /arbeitet/.test(t) &&
    /(zusammen|liebsten|partner)/.test(t)
  ) {
    return true;
  }

  if (/arbeitet .*\bam liebsten\b|\bam liebsten zusammen\b/.test(t)) {
    return true;
  }

  // Org / firm vocabulary (unless clearly about the customer's own practice as Wunschkunde).
  if (
    /\b(firma|unternehmen|organisation|labor|kanzlei|gmbh|partmbb|dentaltechnik|mitbewerber|wettbewerb|unsere?|ihr\b|euch)\b/.test(
      t,
    )
  ) {
    if (/\b(meine|deine|wunsch|ideal|typische)\b/.test(t)) return false;
    return true;
  }

  return false;
}

function hintFromValue(value: string, max = 420): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "(keine Angabe im Fragebogen)";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/**
 * Build an interviewer script from questionnaire facts (deterministic, no LLM).
 *
 * Goal: verify that survey answers were transferred and that the twin
 * thinks/acts/reacts accordingly — fact probes first, soft warmup last.
 *
 * - `persona`: ask the Wunschkunde as “du” (customer situation).
 * - `company`: ask the SEO/company twin about firm facts.
 */
export function buildSurveyExamQuestions(
  facts: SurveyFact[],
  options?: { maxQuestions?: number; audience?: SurveyExamAudience },
): SurveyExamQuestion[] {
  const maxQuestions = options?.maxQuestions ?? 16;
  const audience: SurveyExamAudience = options?.audience ?? "persona";
  const out: SurveyExamQuestion[] = [];
  const seenNorm = new Set<string>();

  function push(q: SurveyExamQuestion) {
    const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNorm.has(key)) return;
    seenNorm.add(key);
    out.push(q);
  }

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  // Concrete questionnaire answers first — that is what Testing must verify.
  const ordered = [...answerFacts, ...followUps];

  for (const fact of ordered) {
    if (out.length >= maxQuestions - 1) break;

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

  // One soft opener at the end (optional coverage of tone/behavior).
  const warmups = audience === "company" ? COMPANY_WARMUP : PERSONA_WARMUP;
  if (out.length < maxQuestions) {
    for (const w of warmups) {
      push({
        id: w.id,
        question: w.question,
        expectedHint:
          audience === "company"
            ? "Verhaltenscheck: Firmenwissen und Tonalität aus dem Anbieter-Fragebogen."
            : "Verhaltenscheck: Haltung/Tonalität der Persona aus dem Fragebogen.",
        factId: "",
        kind: "answer",
      });
    }
  }

  return out.slice(0, maxQuestions);
}
