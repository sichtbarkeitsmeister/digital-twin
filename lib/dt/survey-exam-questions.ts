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

/** Soft openers last — fact probes first. Tone: company employee talking to a prospect. */
const PERSONA_WARMUP: Array<{ id: string; question: string }> = [
  {
    id: "warmup_pain",
    question:
      "Was beschäftigt dich gerade am meisten — und worüber würdest du mit uns zuerst sprechen wollen?",
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
    /\b(?:kunden|patienten)-?avatar\b/.test(t) ||
    /\bdigitale[rn]?\s+(?:kunden|patienten)\b/.test(t) ||
    /\bavatar-?name\b/.test(t) ||
    /(?:wie\s+soll|name\s+des).{0,40}\bavatar\b/.test(t) ||
    /\bzielgruppe\b/.test(t) ||
    /\bpersona\b/.test(t)
  );
}

/** Avatar naming / setup fields → ask the persona for their name instead. */
function isAvatarNameField(title: string): boolean {
  const t = stripDecorations(title).toLowerCase();
  return (
    /^(name des digitalen (?:kunden|patienten)-?avatars|avatar-?name)$/i.test(t) ||
    /wie soll .{0,40}\bavatar\b.{0,20}heißen/.test(t) ||
    /(?:kunden|patienten)-?avatar.{0,20}(heißen|name)/.test(t) ||
    /name .{0,30}(?:kunden|patienten)-?avatar/.test(t)
  );
}

/**
 * Rewrite 3rd-person / formal “Wunschkunde” wording into a natural Du-question
 * as if a company employee is getting to know a prospect.
 */
export function rewriteCustomerThirdPersonToSecondPerson(question: string): string {
  let q = question.trim();

  // Multi-word subject phrases first (avoids “diese du”)
  q = q.replace(/\bdiese\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdieser\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdieses\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdie\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bder\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bden\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "dich");
  q = q.replace(/\bdem\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "dir");
  q = q.replace(
    /\bdiese\s+(?:Kund(?:en|innen)|Patient(?:en|innen)|Personen|Leute|Menschen)\b/gi,
    "du",
  );
  q = q.replace(/\bdie\s+(?:Personen|Leute|Menschen)\b/gi, "du");
  q = q.replace(/\bdieser\s+Person\b/gi, "dir");
  q = q.replace(/\bdiese\s+Person\b/gi, "du");
  q = q.replace(/\bdie\s+Person\b/gi, "du");

  q = q.replace(/\bWunsch-?Zahnärzt(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bideal(?:en|e|er|es)?\s+Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\btypische\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+(?:Kund(?:en|innen)|Patient(?:en|innen)|Personen)\b/gi, "du");
  q = q.replace(
    /\btypische[rns]?\s+(?:Kund(?:e|en|in|innen)|Patient(?:en|in|innen)|Personen)\b/gi,
    "du",
  );

  // Leftover determiners before du (“diese du”, “die du”)
  q = q.replace(/\b(?:diese[rns]?|jene[rns]?|solche[rns]?|die|der|das)\s+du\b/gi, "du");

  // Formal Sie/Ihr → du/dein
  q = q.replace(/\bIhnen\b/g, "dir");
  q = q.replace(/\bIhre[rnms]?\b/g, (m) => {
    const map: Record<string, string> = {
      Ihre: "deine",
      Ihrer: "deiner",
      Ihrem: "deinem",
      Ihren: "deinen",
      Ihres: "deines",
    };
    return map[m] ?? "deine";
  });
  q = q.replace(/\bSie\b/g, "du");
  q = q.replace(/\bihre[rnms]?\b/gi, (m) => {
    const lower = m.toLowerCase();
    const map: Record<string, string> = {
      ihre: "deine",
      ihrer: "deiner",
      ihrem: "deinem",
      ihren: "deinen",
      ihres: "deines",
    };
    return map[lower] ?? "deine";
  });

  // Brand after “zu …” → “zu uns” (only Capitalized brand tokens, not following verbs)
  q = q.replace(
    /\bzu\s+(?!uns\b|dir\b|mir\b|hause\b)(?:[A-ZÄÖÜ][\wÄÖÜäöüß-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]*){0,3})\b/g,
    "zu uns",
  );

  q = q.replace(/\bWie alt sind\b/gi, "Wie alt bist");
  q = q.replace(/\bWie nehmen\b/gi, "Wie nimmst");
  q = q.replace(/\bWie kommen\b/gi, "Wie kommst");
  q = q.replace(/\bWie wählen\b/gi, "Wie wählst");
  q = q.replace(/\bWie entscheiden\b/gi, "Wie entscheidest");
  q = q.replace(/\bWie suchen\b/gi, "Wie suchst");
  q = q.replace(/\bWie fühlen\b/gi, "Wie fühlst");
  q = q.replace(/\bWie reagieren\b/gi, "Wie reagierst");
  q = q.replace(/\bWie beschreiben\b/gi, "Wie beschreibst");
  q = q.replace(/\bWie erzählen\b/gi, "Wie erzählst");
  q = q.replace(/\bWorauf legen\b/gi, "Worauf legst");
  q = q.replace(/\bWelche Wege nutzen\b/gi, "Welche Wege nutzt");
  q = q.replace(/\bWas erwarten\b/gi, "Was erwartest");
  q = q.replace(/\bWas brauchen\b/gi, "Was brauchst");
  q = q.replace(/\bWas erzählen\b/gi, "Was erzählst");
  q = q.replace(/\bWas beschreiben\b/gi, "Was beschreibst");
  q = q.replace(/\bWas sagen\b/gi, "Was sagst");
  q = q.replace(/\bWollen\b/g, "Willst");
  q = q.replace(/\bWelche ([^?]{3,80}?)\bhaben\b/gi, "Welche $1hast");
  q = q.replace(/\bWelche Situation hat (?:dich|du)\b/gi, "Was hat dich");

  q = fixGermanDuVerbAgreement(q);

  q = q.replace(/\bdu\s+du\b/gi, "du");
  q = q.replace(/\bzu\s+du\b/gi, "zu dir");
  q = q.replace(/\bvon\s+du\b/gi, "von dir");
  q = q.replace(/\bbei\s+du\b/gi, "bei dir");
  q = q.replace(/\büber\s+sie\b/gi, "über dich");
  q = q.replace(/\bmit\s+sie\b/gi, "mit dir");
  q = q.replace(/\bwas sagen sie\b/gi, "was sagst du");
  q = q.replace(/\bsagst\s+sie\b/gi, "sagst du");
  q = q.replace(/\bhat\s+du\b/gi, "hast du");
  q = q.replace(/\s+/g, " ").trim();

  return q;
}

/** Repair leftover plural/formal verbs next to “du”. */
export function fixGermanDuVerbAgreement(text: string): string {
  let q = text;

  if (/\bdu\b/i.test(q)) {
    q = q.replace(/\bIhnen\b/g, "dir");
    q = q.replace(/\bIhre[rnms]?\b/g, (m) => {
      const map: Record<string, string> = {
        Ihre: "deine",
        Ihrer: "deiner",
        Ihrem: "deinem",
        Ihren: "deinen",
        Ihres: "deines",
      };
      return map[m] ?? "deine";
    });
    q = q.replace(/\bihre[rnms]?\b/gi, (m) => {
      const lower = m.toLowerCase();
      const map: Record<string, string> = {
        ihre: "deine",
        ihrer: "deiner",
        ihrem: "deinem",
        ihren: "deinen",
        ihres: "deines",
      };
      return map[lower] ?? "deine";
    });
    q = q.replace(/\büber\s+sie\b/gi, "über dich");
    q = q.replace(/\bmit\s+sie\b/gi, "mit dir");
  }

  const verbMap: Array<[RegExp, string]> = [
    [/\bhaben\s+du\b/gi, "hast du"],
    [/\bdu\s+haben\b/gi, "du hast"],
    [/\bsind\s+du\b/gi, "bist du"],
    [/\bdu\s+sind\b/gi, "du bist"],
    [/\bist\s+du\b/gi, "bist du"],
    [/\berzählen\s+du\b/gi, "erzählst du"],
    [/\bdu\s+erzählen\b/gi, "du erzählst"],
    [/\bbeschreiben\s+du\b/gi, "beschreibst du"],
    [/\bdu\s+beschreiben\b/gi, "du beschreibst"],
    [/\bmachen\s+du\b/gi, "machst du"],
    [/\bdu\s+machen\b/gi, "du machst"],
    [/\bnehmen\s+du\b/gi, "nimmst du"],
    [/\bdu\s+nehmen\b/gi, "du nimmst"],
    [/\bkommen\s+du\b/gi, "kommst du"],
    [/\bdu\s+kommen\b/gi, "du kommst"],
    [/\bsuchen\s+du\b/gi, "suchst du"],
    [/\bdu\s+suchen\b/gi, "du suchst"],
    [/\bwählen\s+du\b/gi, "wählst du"],
    [/\bdu\s+wählen\b/gi, "du wählst"],
    [/\bfühlen\s+du\b/gi, "fühlst du"],
    [/\bdu\s+fühlen\b/gi, "du fühlst"],
    [/\bsehen\s+du\b/gi, "siehst du"],
    [/\bdu\s+sehen\b/gi, "du siehst"],
    [/\bfinden\s+du\b/gi, "findest du"],
    [/\bdu\s+finden\b/gi, "du findest"],
    [/\bnutzen\s+du\b/gi, "nutzt du"],
    [/\bdu\s+nutzen\b/gi, "du nutzt"],
    [/\blegen\s+du\b/gi, "legst du"],
    [/\bdu\s+legen\b/gi, "du legst"],
    [/\bstehen\s+du\b/gi, "stehst du"],
    [/\bdu\s+stehen\b/gi, "du stehst"],
    [/\bgehen\s+du\b/gi, "gehst du"],
    [/\bdu\s+gehen\b/gi, "du gehst"],
    [/\bleben\s+du\b/gi, "lebst du"],
    [/\bdu\s+leben\b/gi, "du lebst"],
    [/\bdenken\s+du\b/gi, "denkst du"],
    [/\bdu\s+denken\b/gi, "du denkst"],
    [/\bwissen\s+du\b/gi, "weißt du"],
    [/\bdu\s+wissen\b/gi, "du weißt"],
    [/\bkennen\s+du\b/gi, "kennst du"],
    [/\bdu\s+kennen\b/gi, "du kennst"],
    [/\bkönnen\s+du\b/gi, "kannst du"],
    [/\bdu\s+können\b/gi, "du kannst"],
    [/\bmüssen\s+du\b/gi, "musst du"],
    [/\bdu\s+müssen\b/gi, "du musst"],
    [/\bwollen\s+du\b/gi, "willst du"],
    [/\bdu\s+wollen\b/gi, "du willst"],
    [/\bsollen\s+du\b/gi, "sollst du"],
    [/\bdu\s+sollen\b/gi, "du sollst"],
    [/\bwerden\s+du\b/gi, "wirst du"],
    [/\bdu\s+werden\b/gi, "du wirst"],
    [/\berwarten\s+du\b/gi, "erwartest du"],
    [/\bdu\s+erwarten\b/gi, "du erwartest"],
    [/\bbrauchen\s+du\b/gi, "brauchst du"],
    [/\bdu\s+brauchen\b/gi, "du brauchst"],
    [/\bentscheiden\s+du\b/gi, "entscheidest du"],
    [/\bdu\s+entscheiden\b/gi, "du entscheidest"],
    [/\barbeiten\s+du\b/gi, "arbeitest du"],
    [/\bdu\s+arbeiten\b/gi, "du arbeitest"],
    [/\breagieren\s+du\b/gi, "reagierst du"],
    [/\bdu\s+reagieren\b/gi, "du reagierst"],
    [/\bsagen\s+du\b/gi, "sagst du"],
    [/\bdu\s+sagen\b/gi, "du sagst"],
    [/\berzählen\s+sie\b/gi, "erzählst du"],
    [/\bbeschreiben\s+sie\b/gi, "beschreibst du"],
  ];

  for (const [pattern, replacement] of verbMap) {
    q = q.replace(pattern, replacement);
  }

  q = q.replace(/\b([a-zäöüß]{3,})en\s+du\b/gi, (_m, stem: string) => {
    const s = String(stem);
    if (/^(sei|werd|hab|k[oö]nn|m[uü]ss|woll|soll|wiss)$/i.test(s)) return `${s}en du`;
    if (/[td]$/i.test(s)) return `${s}est du`;
    return `${s}st du`;
  });

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
  q = q.replace(/\s*[—–-]\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*und wie lautet die komplette Reihenfolge\.?$/i, "");
  q = q.replace(/\s*was steht bei dir bei\s*[„"][^„"]+[“"]\s*an erster Stelle/gi, "");
  q = q.replace(/\s*[—–-]\s*bitte mit den Angaben aus dem Fragebogen\.?$/i, "");
  q = q.replace(/\s*bitte mit den Angaben aus dem Fragebogen\.?$/i, "");
  q = q.replace(/\s*aus dem Fragebogen\.?/gi, "");
  q = q.replace(/\s*laut Fragebogen\.?/gi, "");
  q = fixGermanDuVerbAgreement(q);
  q = q.replace(/\s+/g, " ").trim();
  if (!q || q.length < 8) return `${raw.replace(/[?？]+$/g, "")}?`;
  return `${q}?`;
}

/** Only true budget/price-range fields — not every question that mentions “Preis”. */
function isPrimaryBudgetField(raw: string): boolean {
  const t = raw.toLowerCase();
  if (/reagier|aussage|fester preis|ab welchem preis|lieber einen festen|preisspanne bewegen sich/i.test(t)) {
    return false;
  }
  if (looksLikeQuestion(raw) && /preis/i.test(t) && !/\bbudget\b/i.test(t) && raw.length > 55) {
    return false;
  }
  return (
    /^(typisches?\s+)?budget\b/i.test(t) ||
    /\bwelches budget\b/i.test(t) ||
    (/\bbudget\b/i.test(t) && raw.length < 70)
  );
}

function hintFromValue(value: string, max = 420): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "(keine Angabe im Fragebogen)";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

type FactSlice = { key: string; label: string; value: string };

/**
 * Pull concrete sub-facts out of long description answers
 * using the questionnaire's own labels (domain-agnostic).
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
    push(classifySliceKey(label), label, val);
  }

  // Slash-, semicolon- or comma-separated labeled chunks
  for (const part of text.split(/\s*[|;/]\s*|\s*,\s+/)) {
    const chunk = part.trim();
    if (!chunk) continue;
    const withColon = chunk.match(/^(.{2,40}?)\s*[:：]\s*(.+)$/);
    if (withColon) {
      const label = withColon[1]!.trim();
      push(classifySliceKey(label), label, withColon[2]!.trim());
      continue;
    }
    const agePart = chunk.match(/^alter(?:sgruppe)?\s+(.+)$/i);
    if (agePart?.[1]) {
      push("age", "Alter", agePart[1].trim());
      continue;
    }
    const sizePart = chunk.match(
      /^(.{0,24}?(?:größe|groesse|mitarbeiter|behandler|team|anzahl)[^:]{0,20})\s+(.+)$/i,
    );
    if (sizePart?.[1] && sizePart[2] && /\d/.test(sizePart[2])) {
      push("size", sizePart[1].trim(), sizePart[2].trim());
      continue;
    }
    const focusPart = chunk.match(/^(?:schwerpunkt(?:e)?|spezialisierung(?:en)?)\s+(.+)$/i);
    if (focusPart?.[1]) {
      push("focus", "Schwerpunkte", focusPart[1].trim());
    }
  }

  // Inline age only when explicitly labeled (avoid false positives like budgets).
  const age = text.match(/\balter(?:sgruppe)?\b[^0-9]{0,16}(\d{2}\s*[–\-bis]+\s*\d{2}|\d{2})/i);
  if (age?.[1]) push("age", "Alter", age[1].trim());

  return slices;
}

function classifySliceKey(label: string): string {
  const t = label.toLowerCase();
  if (/\balter\b/.test(t)) return "age";
  if (/größe|groesse|mitarbeiter|behandler|team|betriebs|\bma\b|anzahl|praxis/.test(t)) {
    return "size";
  }
  if (/schwerpunkt|spezial|fokus|fachricht/.test(t)) return "focus";
  if (/\bname\b|ansprech/.test(t)) return "name";
  if (/region|standort|einzugs|gebiet|ort/.test(t)) return "region";
  if (/kontakt/.test(t)) return "contact";
  if (/budget|kosten|preis|invest/.test(t)) return "budget";
  return "topic";
}

/**
 * Build a sales-style probe from the slice's own questionnaire label.
 * Industry terms only when they appear in the label/value.
 */
function concreteQuestionForSlice(slice: FactSlice): string {
  const label = shortTopic(slice.label);
  const hay = `${slice.label} ${slice.value}`.toLowerCase();

  switch (slice.key) {
    case "age":
      return "Darf ich fragen: Wie alt bist du ungefähr?";
    case "name":
      return "Wie heißt du — und wie darf ich dich ansprechen?";
    case "size":
      if (/behandler/i.test(hay)) {
        return "Wie viele Behandler seid ihr — wie groß ist die Praxis?";
      }
      if (/mitarbeiter|team|\bma\b/i.test(hay)) {
        return "Wie groß ist euer Team — wie viele Mitarbeiter seid ihr ungefähr?";
      }
      if (/praxis/i.test(hay)) {
        return "Wie groß ist eure Praxis ungefähr?";
      }
      return `Wie sieht das bei dir mit „${label}" aus — welche Größenordnung trifft zu?`;
    case "focus":
      return `Worauf liegt bei dir der Fokus — was ist dir bei „${label}" besonders wichtig?`;
    case "region":
      return `Wo bist du unterwegs — welche Region trifft bei „${label}" auf dich zu?`;
    case "contact":
      return "Wie kommst du typischerweise das erste Mal mit einem Anbieter ins Gespräch?";
    case "budget":
      return "In welcher Preisspanne bewegst du dich ungefähr?";
    default:
      return `Erzähl mir kurz zu „${label}" — was trifft auf dich zu?`;
  }
}

/** Priority: identity/facts before soft narrative probes. */
function factProbePriority(fact: SurveyFact, question: string): number {
  const hay = `${fact.fieldTitle} ${fact.label} ${question}`.toLowerCase();
  if (/wie heißt du|avatar-?name|name des digitalen/.test(hay)) return 10;
  if (/\balter\b|altersgruppe|wie alt/.test(hay)) return 20;
  if (/größe|groesse|mitarbeiter|behandler|team|anzahl|budget|preisspanne/.test(hay)) return 30;
  if (/schwerpunkt|spezial|situation|beschreibung|wer bist du/.test(hay)) return 40;
  if (/kontakt|aufmerksam|partner|anbieter|kanal/.test(hay)) return 50;
  if (/beschäftigt dich|mit uns zuerst/.test(hay)) return 90;
  return 60;
}

/**
 * Ask as a company employee getting to know the twin as a prospect.
 * Prefer rewritten survey questions over dry exam templates.
 */
function toPersonaInterviewQuestion(fact: SurveyFact): string | null {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  const hay = `${raw} ${fact.value}`;
  if (!raw) {
    return "Erzähl mir doch kurz: Wer bist du, und was beschäftigt dich gerade?";
  }

  if (isAvatarNameField(raw)) {
    return "Wie heißt du — und wie darf ich dich ansprechen?";
  }

  if (
    /\balter\b/i.test(raw) ||
    /^wie alt\b/i.test(raw) ||
    (/wie alt\b/i.test(raw) && /meist/i.test(raw))
  ) {
    return "Darf ich fragen: Wie alt bist du ungefähr?";
  }

  if (
    /praxisgröße|praxisgroesse|mitarbeiter|behandler|teamgröße|teamgroesse|betriebsgröße|anzahl.*(ma|mitarbeiter|behandler)/i.test(
      raw,
    )
  ) {
    if (/behandler/i.test(hay)) {
      return "Wie viele Behandler seid ihr — wie groß ist die Praxis?";
    }
    if (/mitarbeiter|team|\bma\b/i.test(hay)) {
      return "Wie groß ist euer Team — wie viele Mitarbeiter seid ihr ungefähr?";
    }
    if (/praxis/i.test(hay)) {
      return "Wie groß ist eure Praxis ungefähr?";
    }
    return `Wie sieht das bei dir mit „${shortTopic(raw)}" aus?`;
  }

  if (/schwerpunkt/i.test(raw) && !looksLikeQuestion(raw)) {
    return "Worauf liegt bei dir der Fokus — was ist dir besonders wichtig?";
  }

  if (/einzugsgebiet|region|standort|gebiet/i.test(raw) && !looksLikeQuestion(raw)) {
    return "Wo bist du unterwegs — welche Region trifft auf dich zu?";
  }

  if (/kontaktweg|kontakt auf|erstkontakt|erreichen|erstmals kontakt/i.test(raw)) {
    if (looksLikeQuestion(raw)) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return "Wie kommst du typischerweise das erste Mal mit einem Anbieter ins Gespräch?";
  }

  if (/sorg|einwand|hürde|problem|schmerz|ärger|frust/i.test(raw)) {
    return "Was beschäftigt dich gerade am meisten — und was würdest du uns dazu als Erstes erzählen?";
  }

  if (/entscheid|kriterium|wichtig/i.test(raw) && !looksLikeQuestion(raw)) {
    return "Wonach suchst du dir einen Anbieter aus — was muss für dich unbedingt stimmen?";
  }

  // True budget fields only — price-reaction / negotiation questions keep a sales rewrite.
  if (isPrimaryBudgetField(raw)) {
    return "In welcher Preisspanne bewegst du dich ungefähr?";
  }
  // Company-style price-range of “Aufträge” → ask the prospect about their range.
  if (/preisspanne|budget|preis/i.test(raw) && /\baufträge?\b/i.test(raw)) {
    return "In welcher Preisspanne bewegst du dich ungefähr?";
  }
  if (/reagier.*preis|preis.*reagier|fester preis|ab welchem preis|lieber einen festen/i.test(raw)) {
    if (looksLikeQuestion(raw)) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return "Wie gehst du mit dem Preis um — worauf achtest du besonders?";
  }

  if (
    /berufs|lebenssituation|lebenslage/i.test(raw) &&
    !/erzählen|beschreiben|erstgespräch|erzähl/i.test(raw)
  ) {
    return "Was machst du beruflich — bzw. wie sieht deine Lebenssituation gerade aus?";
  }

  // Description / bio: in-character sales discovery, no questionnaire meta.
  if (/beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)) {
    return "Erzähl mir doch kurz: Wer bist du, und was beschäftigt dich gerade?";
  }

  // Prefer natural rewrite of the original survey question (sales conversation).
  if (looksLikeQuestion(raw)) {
    if (
      isCustomerProfileMetaTitle(raw) ||
      /\b(kund|patient|wunsch|person|personen|leute|sie|ihre|haben|erzählen|beschreiben|sagen|diese|meist)\b/i.test(
        raw,
      )
    ) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return softenExistingQuestion(fixGermanDuVerbAgreement(raw));
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
        "Worüber findest du typischerweise einen neuen Anbieter oder Partner — " +
        "was kommt für dich zuerst?"
      );
    }
    if (/entscheid|anbieterwahl|kriterium|wichtig/i.test(`${topic} ${raw}`)) {
      return "Wonach entscheidest du dich für einen Anbieter — was hat für dich die höchste Priorität?";
    }
    return `Wenn du an „${shortTopic(topic)}" denkst: was ist dir am wichtigsten?`;
  }

  if (isCustomerProfileMetaTitle(raw)) {
    const topic = topicFromCustomerMetaTitle(raw);
    if (!topic || topic.length < 3) {
      return "Erzähl mir doch kurz: Wer bist du, und was beschäftigt dich gerade?";
    }
    return `Zu „${shortTopic(topic)}": Was trifft auf dich zu?`;
  }

  return `Erzähl mir kurz zu „${shortTopic(raw)}" — was trifft auf dich zu?`;
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

  // Firm ops / funnel metrics — not something to ask the Wunschkunde.
  if (
    /\binteressent/.test(t) &&
    /(nicht zurück|nicht wahrgenommen|absage|no-?show|kein termin|nicht erschienen)/.test(t)
  ) {
    return true;
  }
  if (/(termin|gespräch).{0,40}nicht wahrgenommen|nicht zurückgerufen/.test(t)) {
    return true;
  }
  // Staff observation about patients/customers (3rd person), not Du-discovery.
  if (/woran merkt man\b/.test(t)) return true;
  if (
    /welche fragen stellen\b/.test(t) &&
    /\b(patienten|kunden|interessenten|leute|menschen)\b/.test(t)
  ) {
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
  // Long / structured answers: split into probes from the questionnaire's own labels.
  if (isDescriptionMetaField(fact) || fact.value.length > 120) {
    const slices = extractConcreteFactSlices(fact.value);
    if (slices.length >= 2) {
      return slices.map((slice, index) => ({
        idSuffix: `_${slice.key}${index > 0 ? `_${index}` : ""}`,
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
 * Goal: verify that survey answers were transferred — probes follow each
 * questionnaire's own field titles/values (no fixed industry wording).
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
