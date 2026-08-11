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

function hintFromValue(value: string, max = 420): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "(keine Angabe im Fragebogen)";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

type FactSlice = { key: string; label: string; value: string };

/**
 * Pull concrete sub-facts out of long description answers
 * (e.g. "Alter: 35-45 / Praxisgröße: 1-6 Behandler / …").
 */
export function extractConcreteFactSlices(value: string): FactSlice[] {
  const text = value.replace(/\r/g, "").trim();
  if (!text) return [];

  const slices: FactSlice[] = [];
  const seen = new Set<string>();

  function push(key: string, label: string, rawValue: string) {
    const v = rawValue.replace(/\s+/g, " ").trim();
    if (!v || v.length < 1) return;
    const norm = `${key}::${v.toLowerCase()}`;
    if (seen.has(norm)) return;
    seen.add(norm);
    slices.push({ key, label, value: v });
  }

  // Line / bullet "Label: value"
  for (const line of text.split(/\n+/)) {
    const cleaned = line.replace(/^[-•*]\s*/, "").trim();
    const m = cleaned.match(/^(.{2,48}?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const label = m[1]!.trim();
    const val = m[2]!.trim();
    const key = classifySliceLabel(label);
    if (key) push(key, label, val);
  }

  // Slash- or semicolon-separated "Label: value" chunks on one line
  for (const part of text.split(/\s*[|;/]\s*/)) {
    const m = part.match(/^(.{2,40}?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const label = m[1]!.trim();
    const val = m[2]!.trim();
    const key = classifySliceLabel(label);
    if (key) push(key, label, val);
  }

  // Inline patterns when labels are missing
  const age =
    text.match(/\balter(?:sgruppe)?\b[^0-9]{0,16}(\d{2}\s*[–\-bis]+\s*\d{2}|\d{2})/i) ??
    text.match(/\b(\d{2}\s*[–\-]\s*\d{2})\s*(?:jahre|jährig)?/i);
  if (age?.[1]) push("age", "Alter", age[1].trim());

  const size =
    text.match(
      /\b(?:praxisgröße|praxisgroesse|behandler|mitarbeiter|teamgröße|teamgroesse|ma\b)[^0-9]{0,24}(\d+\s*[–\-bis]+\s*\d+|\d+)/i,
    ) ?? text.match(/\b(\d+\s*[–\-]\s*\d+)\s*(?:behandler|mitarbeiter|ma|personen|köpfe)/i);
  if (size?.[1]) {
    const around = text.slice(Math.max(0, (size.index ?? 0) - 10), (size.index ?? 0) + size[0].length + 24);
    push("size", "Praxisgröße", around.replace(/\s+/g, " ").trim());
  }

  const focus = text.match(
    /\bschwerpunkt(?:e)?\b\s*[:：]?\s*([^\n|;]{3,120})/i,
  );
  if (focus?.[1]) push("focus", "Schwerpunkte", focus[1].trim());

  return slices;
}

function classifySliceLabel(label: string): string | null {
  const t = label.toLowerCase();
  if (/\balter\b/.test(t)) return "age";
  if (/praxis|behandler|mitarbeiter|team|betriebs|größe|groesse|\bma\b|anzahl/.test(t)) {
    return "size";
  }
  if (/schwerpunkt|spezial|fokus|fachricht/.test(t)) return "focus";
  if (/\bname\b|ansprech/.test(t)) return "name";
  if (/region|standort|einzugs|gebiet/.test(t)) return "region";
  if (/kontakt/.test(t)) return "contact";
  return null;
}

function concreteQuestionForSlice(slice: FactSlice): string {
  switch (slice.key) {
    case "age":
      return "Wie alt bist du — bzw. welche Altersgruppe trifft auf dich zu?";
    case "size":
      return "Wie viele Mitarbeiter bzw. Behandler habt ihr — wie groß ist die Praxis?";
    case "focus":
      return "Welche fachlichen Schwerpunkte hast du?";
    case "name":
      return "Wie heißt du — und wie soll ich dich ansprechen?";
    case "region":
      return "Wo bist du unterwegs, und aus welcher Region kommen deine Patienten?";
    case "contact":
      return "Wie nimmst du erstmals Kontakt zu einem Anbieter oder Labor auf?";
    default:
      return `Was gilt bei dir konkret zu „${shortTopic(slice.label)}"?`;
  }
}

/** Priority: name/age/size/focus before soft narrative probes. */
function factProbePriority(fact: SurveyFact, question: string): number {
  const hay = `${fact.fieldTitle} ${fact.label} ${question}`.toLowerCase();
  if (/wie heißt du|avatar-?name|name des digitalen/.test(hay)) return 10;
  if (/\balter\b|altersgruppe|wie alt/.test(hay)) return 20;
  if (/mitarbeiter|behandler|praxisgröße|praxisgroesse|wie viele ma|wie groß ist/.test(hay)) {
    return 30;
  }
  if (/schwerpunkt|spezial/.test(hay)) return 40;
  if (/kontakt|aufmerksam|findest.*labor|partner/.test(hay)) return 50;
  if (/erzähl mal kurz|wer bist du|beschäftigt dich/.test(hay)) return 90;
  return 60;
}

/** Ask so the twin must surface the stored fact — concrete, checkable probes. */
function toPersonaInterviewQuestion(fact: SurveyFact): string | null {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) return "Erzähl mir bitte konkret etwas über dich und deine Situation.";

  if (/^(name des digitalen kunden-avatars|avatar-?name)$/i.test(raw)) {
    return "Wie heißt du — und wie soll ich dich ansprechen?";
  }

  if (/\balter\b/i.test(raw)) {
    return "Wie alt bist du — bzw. welche Altersgruppe trifft auf dich zu?";
  }

  if (
    /praxisgröße|praxisgroesse|mitarbeiter|behandler|teamgröße|teamgroesse|betriebsgröße|anzahl.*(ma|mitarbeiter|behandler)/i.test(
      raw,
    )
  ) {
    return "Wie viele Mitarbeiter bzw. Behandler habt ihr — wie groß ist die Praxis?";
  }

  if (/schwerpunkt/i.test(raw)) {
    return "Welche fachlichen Schwerpunkte hast du?";
  }

  if (/einzugsgebiet|region|standort|gebiet/i.test(raw)) {
    return "Wo bist du unterwegs, und aus welcher Region kommen deine Patienten oder Kunden?";
  }

  if (/kontaktweg|kontakt auf|erstkontakt|erreichen|erstmals kontakt/i.test(raw)) {
    return "Wie nimmst du erstmals Kontakt zu einem Anbieter oder Labor auf?";
  }

  if (/sorg|einwand|hürde|problem|schmerz|ärger|frust/i.test(raw)) {
    return "Was beschäftigt dich gerade am meisten — welche Sorgen oder Einwände hast du?";
  }

  if (/entscheid|kriterium|wichtig/i.test(raw)) {
    return "Wonach suchst du dir einen Anbieter aus — was muss für dich unbedingt stimmen?";
  }

  // Long bio/description fields: prefer concrete multi-fact ask only as fallback
  // when we could not split the value (handled in personaProbesFromFact).
  if (/beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)) {
    return (
      "Nenn mir konkret: Wie alt bist du, wie viele Behandler bzw. Mitarbeiter habt ihr, " +
      "und welche fachlichen Schwerpunkte hast du?"
    );
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

  if (isCustomerProfileMetaTitle(raw)) {
    const topic = topicFromCustomerMetaTitle(raw);
    if (!topic || topic.length < 3) {
      return "Erzähl mir kurz von dir und deiner Situation.";
    }
    return `Zu „${shortTopic(topic)}": Was trifft auf dich zu — bitte möglichst konkret?`;
  }

  return `Zu „${shortTopic(raw)}": Was gilt für dich persönlich — bitte mit den konkreten Angaben?`;
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

function isDescriptionMetaField(fact: SurveyFact): boolean {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  return (
    /beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)
  );
}

/** One survey fact → one or more concrete exam probes (persona). */
function personaProbesFromFact(fact: SurveyFact): Array<{
  idSuffix: string;
  question: string;
  expectedHint: string;
}> {
  // Long description answers often pack Alter / Praxisgröße / Schwerpunkte — split them.
  if (isDescriptionMetaField(fact) || fact.value.length > 160) {
    const slices = extractConcreteFactSlices(fact.value);
    if (slices.length >= 2) {
      return slices.map((slice) => ({
        idSuffix: `_${slice.key}`,
        question: concreteQuestionForSlice(slice),
        expectedHint: hintFromValue(slice.value),
      }));
    }
  }

  const question = toPersonaInterviewQuestion(fact);
  if (!question) return [];
  return [
    {
      idSuffix: "",
      question,
      expectedHint: hintFromValue(fact.value),
    },
  ];
}

/**
 * Build an interviewer script from questionnaire facts (deterministic, no LLM).
 *
 * Goal: verify that survey answers were transferred and that the twin
 * thinks/acts/reacts accordingly — concrete fact probes first, soft warmup last.
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
  const draft: Array<SurveyExamQuestion & { priority: number }> = [];
  const seenNorm = new Set<string>();

  function push(q: SurveyExamQuestion, priority: number) {
    const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNorm.has(key)) return;
    seenNorm.add(key);
    draft.push({ ...q, priority });
  }

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  // Concrete questionnaire answers first — that is what Testing must verify.
  const ordered = [...answerFacts, ...followUps];

  for (const fact of ordered) {
    if (audience === "persona" && isCompanyOnlyFactForPersona(fact)) {
      continue;
    }

    if (audience === "company") {
      const question = toCompanyInterviewQuestion(fact);
      push(
        {
          id: `exam_${fact.id}`,
          question,
          expectedHint: hintFromValue(fact.value),
          factId: fact.id,
          kind: fact.kind,
        },
        factProbePriority(fact, question),
      );
      continue;
    }

    for (const probe of personaProbesFromFact(fact)) {
      push(
        {
          id: `exam_${fact.id}${probe.idSuffix}`,
          question: probe.question,
          expectedHint: probe.expectedHint,
          factId: fact.id,
          kind: fact.kind,
        },
        factProbePriority(fact, probe.question),
      );
    }
  }

  draft.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const out: SurveyExamQuestion[] = draft
    .slice(0, Math.max(0, maxQuestions - 1))
    .map(({ priority: _p, ...q }) => q);

  // One soft opener at the end (optional coverage of tone/behavior).
  const warmups = audience === "company" ? COMPANY_WARMUP : PERSONA_WARMUP;
  if (out.length < maxQuestions) {
    for (const w of warmups) {
      const key = w.question.toLowerCase().replace(/\s+/g, " ").trim();
      if (seenNorm.has(key)) continue;
      seenNorm.add(key);
      out.push({
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
