import Anthropic from "@anthropic-ai/sdk";

import {
  escapeControlCharsInJsonStrings,
  extractAnthropicText,
  extractFirstJsonObject,
  isAnthropicModelNotFoundError,
  stripTrailingCommasInJson,
} from "@/lib/ai/anthropic-helpers";
import { examHintTokens } from "@/lib/dt/exam-answer-check";
import {
  withoutEmDashes,
  type SurveyExamAudience,
  type SurveyExamQuestion,
} from "@/lib/dt/survey-exam-questions";

/**
 * Persona-Test without a completed questionnaire.
 * Reads the twin's own settings (prompt, avatar_data) and builds probes for
 * DISG, pain points, decision criteria and the Hormozi value equation.
 * The existing SOLL/IST check then grades the twin's answer.
 */

export type PersonaConfigExamVia = "persona_ai" | "persona_config";

export type PersonaConfigExamInput = {
  name?: string | null;
  role?: string | null;
  audience?: SurveyExamAudience;
  promptTemplate?: string | null;
  promptAppend?: string | null;
  avatarData?: unknown;
  /** When true, prompt_template is the shared DigitalTwin prompt, not this avatar. */
  usesGlobalPrompt?: boolean | null;
};

const THEME_ORDER = [
  "pain",
  "hormozi_dream",
  "hurdle",
  "hormozi_urgency",
  "hormozi_effort",
  "hormozi_likelihood",
  "trigger",
  "demo_age",
  "demo_job",
  "demo_family",
  "demo_region",
  "demo_budget",
  "intro",
  "disg",
  "personality",
  "criteria",
  "objections",
  "experience",
  "trust",
  "language",
  "decision",
  "alternatives",
  "firm_name",
  "firm_since",
  "firm_place",
  "firm_team",
  "firm_offer",
] as const;

type PersonaTheme = (typeof THEME_ORDER)[number];

const MAX_EXAM_QUESTIONS = 28;

/**
 * Spoken in every settings-based exam, even when that point is not a labeled
 * field. The Soll is the extracted fact, or this sentence when the prompt
 * never states one.
 */
export const OPEN_TOPIC_SOLL =
  "Kein festes Soll zu diesem Punkt. Die Antwort muss zur hinterlegten Persona passen und darf nichts erfinden, was dort nicht steht.";

const ALWAYS_THEMES: PersonaTheme[] = [
  "pain",
  "hormozi_dream",
  "hurdle",
  "hormozi_urgency",
  "hormozi_effort",
  "hormozi_likelihood",
  "trigger",
  "demo_age",
  "demo_job",
  "demo_family",
  "demo_region",
  "demo_budget",
  "intro",
  "disg",
  "criteria",
  "objections",
  "experience",
  "trust",
  "language",
  "decision",
  "alternatives",
];

export function isOpenTopicSoll(hint: string): boolean {
  return hint.trim().startsWith("Kein festes Soll zu diesem Punkt.");
}

const THEME_KEYS: Partial<Record<PersonaTheme, string[]>> = {
  pain: ["pain", "painpoints", "painpoint", "schmerz", "schmerzpunkte", "sorgen", "tiefsteangst"],
  hormozi_dream: [
    "traum",
    "traumergebnis",
    "traumziel",
    "dreamoutcome",
    "wunschoutcome",
    "hormozidream",
    "perfekterausgang",
    "grosserwunsch",
  ],
  hurdle: ["huerde", "hurdle", "zurueckhaltung"],
  hormozi_urgency: ["dringlichkeit", "urgency", "warumjetzt", "zeitdruck", "hormoziurgency"],
  hormozi_effort: ["aufwand", "effort", "opfer", "sacrifice", "verzicht", "hormozieffort"],
  hormozi_likelihood: ["wahrscheinlichkeit", "likelihood", "erfolgswahrscheinlichkeit"],
  trigger: ["ausloeser", "trigger"],
  demo_age: ["alter", "altersgruppe", "altersbereich", "age"],
  demo_job: ["beruf", "lebenssituation", "taetigkeit"],
  demo_family: ["familie", "familiensituation"],
  demo_region: ["herkunft", "wohnort"],
  demo_budget: ["budget", "preisbereich", "preisspanne"],
  intro: ["situation"],
  disg: ["disg", "disc", "disgtyp", "disgtype"],
  criteria: ["entscheidungskriterien", "entscheidungskriterium", "kriterien"],
  objections: ["einwaende", "einwande", "objections", "bedenken"],
  experience: ["vorerfahrungen"],
  trust: ["vertrauen", "vertrauenssignale"],
  language: ["sprachstil", "formulierungen"],
  decision: ["entscheidungsprozess"],
  alternatives: ["alternativen"],
  firm_name: ["praxisname", "firmenname", "unternehmensname"],
  firm_since: ["gruendung", "gegruendet"],
  firm_place: ["standort", "einzugsgebiet", "adresse"],
  firm_team: ["praxisform"],
  firm_offer: ["leistungen", "leistungsangebot"],
};

const HINT_STOPWORDS = new Set([
  "nicht",
  "einer",
  "einem",
  "einen",
  "diese",
  "dieser",
  "dieses",
  "sollte",
  "werden",
  "wurde",
  "haben",
  "durch",
  "beim",
  "schon",
  "noch",
  "dann",
  "weil",
  "wenn",
  "oder",
  "dass",
  "eine",
  "muss",
  "alles",
  "deine",
  "deiner",
  "deinem",
  "seine",
  "seiner",
  "persona",
  "antwort",
  "frage",
  "bitte",
  "unbedingt",
  "wuerde",
  "würde",
]);

function normKey(key: string): string {
  const last = key.split(".").pop() ?? key;
  return last
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function keyMatches(key: string, aliases: string[]): boolean {
  const n = normKey(key);
  return aliases.some((alias) => n === alias || (alias.length >= 6 && n.endsWith(alias)));
}

function clipHint(value: string, max = 420): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()} …`;
}

function uniqueJoin(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.join(" · ");
}

function isAvatarPromptStub(prompt: string, name?: string | null): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (name && text === `Avatar: ${name}`) return true;
  return /^Avatar:\s+\S/i.test(text) && text.length < 120;
}

function isSharedGlobalTwinPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 400) return false;
  const hasTwin = /Du bist der DigitalTwin von/i.test(trimmed);
  const hasFrame = /\bPERSPEKTIVE\b/.test(trimmed);
  const hasAvatarFacts =
    /entscheidungskriterien|pain\s*points|tiefste\s+angst|\bdisg\b|hormozi|traumergebnis/i.test(
      trimmed,
    );
  return hasTwin && hasFrame && !hasAvatarFacts;
}

/** Prompt + structured avatar fields the exam generator is allowed to use. */
export function personaConfigSourceText(input: PersonaConfigExamInput, maxChars?: number): string {
  const name = input.name?.trim() || "";
  const template = input.promptTemplate?.trim() ?? "";
  const append = input.promptAppend?.trim() ?? "";
  const templateUseful =
    Boolean(template) &&
    !isAvatarPromptStub(template, name) &&
    !(input.usesGlobalPrompt && isSharedGlobalTwinPrompt(template)) &&
    !isSharedGlobalTwinPrompt(template);

  const parts: string[] = [];
  if (templateUseful) parts.push(template);
  if (append) parts.push(append);
  if (parts.length === 0 && template && !isAvatarPromptStub(template, name)) {
    parts.push(template);
  }

  const avatar = formatAvatarData(input.avatarData);
  if (avatar) parts.push(`Strukturierte Felder:\n${avatar}`);

  const text = parts.join("\n\n").trim();
  if (!maxChars || text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function formatAvatarData(data: unknown): string {
  const rows = flattenAvatar(data);
  if (rows.length === 0) return "";
  return rows
    .slice(0, 40)
    .map((row) => `${row.key}: ${clipHint(row.value, 280)}`)
    .join("\n");
}

function flattenAvatar(data: unknown, prefix = ""): Array<{ key: string; value: string }> {
  if (Array.isArray(data)) {
    const joined = data
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
      .filter(Boolean)
      .join(", ");
    return prefix && joined ? [{ key: prefix, value: joined }] : [];
  }
  if (!data || typeof data !== "object") return [];

  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value).trim();
      if (text) out.push({ key: path, value: text });
      continue;
    }
    out.push(...flattenAvatar(value, path));
  }
  return out;
}

function themeForAvatarKey(key: string): PersonaTheme | null {
  const n = normKey(key);
  if (n === "team") return "firm_team";
  for (const theme of THEME_ORDER) {
    const aliases = THEME_KEYS[theme];
    if (aliases && keyMatches(key, aliases)) return theme;
  }
  return null;
}

function plainFactLine(line: string): string {
  return line.replace(/\*\*/g, "").replace(/^[-*•]\s*/, "").trim();
}

function labelAndValue(line: string): { label: string; value: string } | null {
  const plain = plainFactLine(line);
  const match = plain.match(/^(.{2,70}?)\s*[:：]\s*(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (!value || label.length > 60) return null;
  return { label, value };
}

function isContainerHeading(title: string): boolean {
  return /transkript|workshop|anbieter-wissen|\bwissen\b|anker|notizen|kontext|rohdaten|quelle|anhang/i.test(
    title,
  );
}

function isFirmTheme(theme: PersonaTheme): boolean {
  return theme.startsWith("firm_");
}

function headingFromLine(line: string): string | null {
  const trimmed = line.trim();
  const markdown = /^(#{1,3})\s+(.+)$/.exec(trimmed);
  if (markdown) return markdown[2].replace(/[#*`]+$/g, "").trim();
  const bold = /^\*\*(.+)\*\*$/.exec(trimmed);
  if (bold && bold[1].trim().length >= 3 && bold[1].trim().length <= 80) return bold[1].trim();
  return null;
}

function splitPromptSections(text: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = [];
  let title = "";
  let body: string[] = [];
  const flush = () => {
    const joined = body.join("\n").trim();
    if (title || joined) sections.push({ title, body: joined });
  };
  for (const line of text.split("\n")) {
    const heading = headingFromLine(line);
    if (heading) {
      flush();
      title = heading;
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

function themeForLabel(label: string): PersonaTheme | null {
  const heading = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!heading || isContainerHeading(heading)) return null;
  if (/^praxisname|^firmenname|^unternehmensname|^name der (praxis|firma)/.test(heading)) {
    return "firm_name";
  }
  if (/^gründ|^gegründ|^seit wann/.test(heading)) return "firm_since";
  if (/^standort|^einzugsgebiet|^adresse/.test(heading)) return "firm_place";
  if (/^praxisform|^team$|^ärzteteam|^aerzteteam/.test(heading)) return "firm_team";
  if (/^leistungen|^angebot/.test(heading)) return "firm_offer";
  if (/\bdisg\b|\bdisc\b/.test(heading)) return "disg";
  if (/hürde|huerde|zurückhaltung|zurueckhaltung|hält .{0,24}ab|haelt .{0,24}ab/.test(heading)) {
    return "hurdle";
  }
  if (/wunsch-?outcome|traum|perfekte|gro[sß]e[rn]?\s+wunsch|dream\s*outcome/.test(heading)) {
    return "hormozi_dream";
  }
  if (/schmerz|pain\s*point|sorge|ängste|aengste|\bangst\b|\bproblem\b/.test(heading)) return "pain";
  if (/dringlich|warum jetzt|zeitdruck|urgency/.test(heading)) return "hormozi_urgency";
  if (/aufwand|opfer|verzicht|sacrifice/.test(heading)) return "hormozi_effort";
  if (/wahrscheinlichkeit|likelihood/.test(heading)) return "hormozi_likelihood";
  if (/auslöser|ausloeser|\btrigger\b/.test(heading)) return "trigger";
  if (/altersbereich|altersgruppe|^alter\b|wie alt/.test(heading)) return "demo_age";
  if (/beruf|lebenssituation|lebenslage/.test(heading)) return "demo_job";
  if (/famili/.test(heading)) return "demo_family";
  if (/herkunft|wohnort|welche gegend/.test(heading)) return "demo_region";
  if (/budget|preisbereich|preisspanne/.test(heading)) return "demo_budget";
  if (/entscheidungskriter|\bkriterien\b/.test(heading)) return "criteria";
  if (/einwänd|einwaend|bedenken|zweifel/.test(heading)) return "objections";
  if (/vorerfahrung|schlechte erfahrung/.test(heading)) return "experience";
  if (/vertrauen|nachweis|überzeugt|ueberzeugt/.test(heading)) return "trust";
  if (/formulierung|sprachstil|erste[rn]? satz|erster kontakt/.test(heading)) return "language";
  if (/entscheidungsprozess|wer entscheidet|wer redet/.test(heading)) return "decision";
  if (/alternative/.test(heading)) return "alternatives";
  if (/persönlichkeit|persoenlichkeit/.test(heading)) return "personality";
  if (/^situation\b|identit|^name$|vorname/.test(heading)) return "intro";
  return null;
}

function labeledFacts(body: string): Array<{ theme: PersonaTheme; value: string }> {
  const found: Array<{ theme: PersonaTheme; value: string }> = [];
  for (const line of body.split("\n")) {
    const labeled = labelAndValue(line);
    if (!labeled) continue;
    const theme = themeForLabel(labeled.label);
    if (!theme) continue;
    found.push({ theme, value: labeled.value });
  }
  return found;
}

function themeForHeading(title: string, body: string): PersonaTheme | null {
  const fromLabel = themeForLabel(title);
  if (fromLabel === "personality" && /\bdisg\b|\bdisc\b/i.test(body)) return "disg";
  if (fromLabel) return fromLabel;
  if (/hormozi/i.test(title) && /hürde|huerde/i.test(title)) return "hurdle";
  if (/hormozi/i.test(title)) return "hormozi_dream";
  return null;
}

function isBoilerplateBody(text: string): boolean {
  return /globalen digitaltwin-prompt|verbindlichen regeln stehen/i.test(text) && text.length < 700;
}

function collectThemeValues(input: PersonaConfigExamInput): Map<PersonaTheme, string[]> {
  const buckets = new Map<PersonaTheme, string[]>();
  const push = (theme: PersonaTheme, value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean || isBoilerplateBody(clean)) return;
    const minLength =
      theme === "disg" ? 1 : theme === "intro" || theme === "demo_age" ? 2 : 8;
    if (clean.length < minLength) return;
    const list = buckets.get(theme) ?? [];
    list.push(clean);
    buckets.set(theme, list);
  };

  for (const row of flattenAvatar(input.avatarData)) {
    const theme = themeForAvatarKey(row.key);
    if (theme) push(theme, row.value);
  }

  const prompt = personaConfigSourceText({ ...input, avatarData: null });
  for (const section of splitPromptSections(prompt)) {
    const labeled = labeledFacts(section.body);
    for (const fact of labeled) push(fact.theme, fact.value);
    const theme = themeForHeading(section.title, section.body);
    if (!theme || !section.body || isContainerHeading(section.title)) continue;
    if (labeled.length === 0) {
      push(theme, section.body);
      continue;
    }
    const remainder = section.body
      .split("\n")
      .filter((line) => labeledFacts(line).length === 0)
      .join("\n")
      .trim();
    if (remainder) push(theme, remainder);
  }

  return buckets;
}

function questionForTheme(
  theme: PersonaTheme,
  audience: SurveyExamAudience,
  hint: string,
): string {
  const company = audience === "company";
  switch (theme) {
    case "pain":
      return company
        ? "Wie beschreibt euer Wunschkunde sein Problem im ersten Gespräch, möglichst in seinen Worten?"
        : "Wie würdest du dein Problem beschreiben, so wie du es im ersten Gespräch sagen würdest?";
    case "hormozi_dream":
      return company
        ? "Wie würde dieser Kunde den perfekten Ausgang beschreiben, wenn alles optimal gelaufen ist?"
        : "Wie würdest du den perfekten Ausgang beschreiben, wenn alles optimal gelaufen ist?";
    case "hurdle":
      return company
        ? "Was hält diesen Kunden davon ab, sich zu melden, obwohl eigentlich Interesse besteht?"
        : "Was hält dich davon ab, dich zu melden, obwohl du eigentlich Interesse hast?";
    case "hormozi_urgency":
      return company
        ? "Warum sollte sich dieser Kunde jetzt entscheiden und nicht erst später?"
        : "Warum würdest du dich jetzt entscheiden und nicht erst später?";
    case "hormozi_effort":
      return company
        ? "Was wäre diesem Kunden an Aufwand, Risiko oder Verzicht zu viel?"
        : "Was wäre dir an Aufwand, Risiko oder Verzicht zu viel, bevor du zusagst?";
    case "hormozi_likelihood":
      return company
        ? "Was müsste passieren, damit dieser Kunde glaubt, dass es bei ihm wirklich klappt?"
        : "Was müsste passieren, damit du glaubst, dass das bei dir wirklich klappt?";
    case "trigger":
      return company
        ? "Was ist der Auslöser, der diesen Kunden dazu bringt, überhaupt nach einer Lösung zu suchen?"
        : "Was hat dich dazu gebracht, überhaupt nach einer Lösung zu suchen?";
    case "demo_age":
      return company
        ? "In welchem Altersbereich ist dieser Kunde?"
        : "Darf ich fragen: Wie alt bist du ungefähr?";
    case "demo_job":
      return company
        ? "Welcher Beruf oder welche Lebenssituation kommt bei diesem Kunden am häufigsten vor?"
        : "Was machst du beruflich, und wie sieht deine Lebenssituation gerade aus?";
    case "demo_family":
      return company
        ? "Wie sieht die familiäre Situation dieses Kunden meistens aus?"
        : "Wie sieht deine familiäre Situation gerade aus?";
    case "demo_region":
      return company
        ? "Aus welcher Gegend kommt dieser Kunde hauptsächlich?"
        : "Aus welcher Gegend kommst du?";
    case "demo_budget":
      return company
        ? "In welchem Preisbereich bewegt sich dieser Kunde?"
        : "In welcher Preisspanne bewegst du dich ungefähr?";
    case "intro":
      return "Stell dich bitte vor: Wie heißt du, und was ist gerade deine Situation?";
    case "disg":
      if (company) {
        return hint.length < 40
          ? "Welcher DISG-Typ ist dieser Kunde?"
          : "Welcher DISG-Typ ist dieser Kunde, und wie zeigt sich das im Gespräch?";
      }
      return hint.length < 40
        ? "Welcher DISG-Typ bist du?"
        : "Welcher DISG-Typ bist du, und wie zeigt sich das im Gespräch?";
    case "personality":
      return company
        ? "Wie lässt sich die Art dieses Kunden beschreiben, und wie merkt man das im Gespräch?"
        : "Wie würdest du deine Art beschreiben, und wie merkt man das im Gespräch?";
    case "criteria":
      return company
        ? "Wonach sucht sich dieser Kunde einen Anbieter aus, und was muss für ihn unbedingt stimmen?"
        : "Wonach suchst du dir einen Anbieter aus, und was muss für dich unbedingt stimmen?";
    case "objections":
      return company
        ? "Welche Bedenken oder Zweifel äußert dieser Kunde vor der Entscheidung?"
        : "Welche Bedenken oder Einwände hast du, bevor du dich entscheidest?";
    case "experience":
      return company
        ? "Welche schlechten Erfahrungen mit früheren Lösungen oder Anbietern prägen diesen Kunden?"
        : "Gab es schon schlechte Erfahrungen mit anderen Anbietern oder eigenen Versuchen?";
    case "trust":
      return company
        ? "Welche Nachweise oder Signale überzeugen diesen Kunden am meisten?"
        : "Was überzeugt dich am ehesten, es mit einem Anbieter zu versuchen?";
    case "language":
      return company
        ? "Welche Sätze verwendet dieser Kunde beim allerersten Kontakt, möglichst wortwörtlich?"
        : "Was sagst du typischerweise als Erstes, wenn du Kontakt aufnimmst?";
    case "decision":
      return company
        ? "Wie trifft dieser Kunde die Entscheidung, und wer redet dabei mit?"
        : "Wie triffst du so eine Entscheidung, und wer redet dabei mit?";
    case "alternatives":
      return company
        ? "Welche anderen Lösungen oder Anbieter zieht dieser Kunde ernsthaft in Betracht?"
        : "Welche anderen Lösungen ziehst du ernsthaft in Betracht?";
    case "firm_name":
      return "Wie heißt ihr, und wer steht dahinter?";
    case "firm_since":
      return "Seit wann gibt es euch?";
    case "firm_place":
      return "Wo seid ihr tätig, und welches Einzugsgebiet bedient ihr?";
    case "firm_team":
      return "Wer gehört zum Team, und wie seid ihr fachlich aufgestellt?";
    case "firm_offer":
      return "Welche Leistungen bietet ihr an?";
    default:
      return company
        ? "Was sollten wir über euren Wunschkunden dazu noch wissen?"
        : "Was ist dir in deiner Situation gerade am wichtigsten?";
  }
}

function hintLabel(theme: PersonaTheme): string {
  switch (theme) {
    case "intro":
      return "Vorstellung";
    case "disg":
      return "DISG";
    case "personality":
      return "Persönlichkeit";
    case "pain":
      return "Schmerz";
    case "hurdle":
      return "Hürde";
    case "trigger":
      return "Auslöser";
    case "demo_age":
      return "Alter";
    case "demo_job":
      return "Beruf und Lebenssituation";
    case "demo_family":
      return "Familie";
    case "demo_region":
      return "Herkunft";
    case "demo_budget":
      return "Preisbereich";
    case "criteria":
      return "Entscheidungskriterien";
    case "objections":
      return "Einwände";
    case "hormozi_dream":
      return "Wunsch-Ergebnis";
    case "hormozi_urgency":
      return "Dringlichkeit";
    case "hormozi_effort":
      return "Aufwand und Verzicht";
    case "hormozi_likelihood":
      return "Wahrscheinlichkeit";
    case "decision":
      return "Entscheidungsprozess";
    case "experience":
      return "Vorerfahrungen";
    case "trust":
      return "Vertrauen";
    case "language":
      return "Sprache im Erstkontakt";
    case "alternatives":
      return "Alternativen";
    case "firm_name":
      return "Name";
    case "firm_since":
      return "Gründung";
    case "firm_place":
      return "Standort";
    case "firm_team":
      return "Team";
    case "firm_offer":
      return "Leistungen";
    default:
      return "Angabe";
  }
}

function toExamQuestion(
  theme: PersonaTheme,
  hint: string,
  audience: SurveyExamAudience,
): SurveyExamQuestion {
  const expectedHint = clipHint(hint);
  return {
    id: `cfg_${theme}`,
    question: withoutEmDashes(questionForTheme(theme, audience, expectedHint)),
    expectedHint,
    factId: "persona_config",
    kind: "answer",
  };
}

function buildIntroHint(input: PersonaConfigExamInput, buckets: Map<PersonaTheme, string[]>): string {
  const parts: string[] = [];
  const name = input.name?.trim();
  const role = input.role?.trim();
  if (name) parts.push(`Name: ${name}`);
  if (role && role.length > 2) parts.push(`Rolle: ${role}`);
  const extra = uniqueJoin(buckets.get("intro") ?? []);
  if (extra) parts.push(extra);
  return uniqueJoin(parts);
}

function isAwkwardExamQuestion(question: string): boolean {
  return /was gilt bei euch zu/i.test(question) || /bitte mit den konkreten angaben/i.test(question);
}

/**
 * The full questionnaire interview, every time.
 * Hormozi, demographics, DISG and the discovery questions are always asked.
 * A labeled fact becomes the Soll. A missing label stays an open point:
 * the question is still asked, and the checker does not invent a fact.
 * Firm facts are extra and only appear when the company prompt states them.
 */
export function buildPersonaConfigExamQuestions(
  input: PersonaConfigExamInput,
): SurveyExamQuestion[] {
  const audience = input.audience === "company" ? "company" : "persona";
  const buckets = collectThemeValues(input);
  const questions: SurveyExamQuestion[] = [];

  for (const theme of THEME_ORDER) {
    if (isFirmTheme(theme) && audience !== "company") continue;
    if (theme === "intro" && audience === "company") continue;
    if (theme === "personality" && (buckets.get("disg") ?? []).length > 0) continue;

    const required =
      ALWAYS_THEMES.includes(theme) && !(theme === "intro" && audience === "company");

    let body = "";
    if (theme === "intro") {
      body = buildIntroHint(input, buckets);
    } else {
      body = uniqueJoin(buckets.get(theme) ?? []);
    }
    if (!body && !required) continue;
    const hint = body ? `${hintLabel(theme)}: ${body}` : OPEN_TOPIC_SOLL;
    const question = toExamQuestion(theme, hint, audience);
    if (isAwkwardExamQuestion(question.question)) continue;
    questions.push(question);
  }

  return questions.slice(0, MAX_EXAM_QUESTIONS);
}

export function buildPersonaConfigExamAiPrompt(
  sourceText: string,
  audience: SurveyExamAudience = "persona",
): string {
  const shared = [
    "Das ist das ganze Fragebogen-Gespräch, nicht nur die Überschriften, die du findest.",
    "Erzeuge für JEDES dieser Themen genau eine Frage, in dieser Reihenfolge:",
    "1. Hormozi: Schmerz, Wunsch-Ergebnis/perfekter Ausgang, Hürde (was hält vom Melden ab), Dringlichkeit (warum jetzt), Aufwand/Verzicht, Wahrscheinlichkeit, Auslöser",
    "2. Demografie: Alter, Beruf/Lebenssituation, Familie, Herkunft, Preisbereich",
    "3. Vorstellung, dann DISG-Typ und wie er sich im Gespräch zeigt",
    "4. Entscheidungskriterien, Einwände, Vorerfahrungen, Vertrauen, Sprache im Erstkontakt, Entscheidungsprozess, Alternativen",
    "Formuliere wie im Fragebogen: eine gesprochene Frage. Nie die Überschrift zitieren. Nie „Was gilt bei euch zu …“. Nie „bitte mit den konkreten Angaben“.",
    "expectedHint ist der Soll-Text aus dem Material. Steht das Thema nicht im Material, setze expectedHint exakt auf: Kein festes Soll zu diesem Punkt. Die Antwort muss zur hinterlegten Persona passen und darf nichts erfinden, was dort nicht steht.",
    "Erfinde keinen Schmerz, kein Wunsch-Ergebnis, kein Alter und keinen DISG-Typ.",
  ];

  if (audience === "company") {
    return [
      "Erstelle Prüffragen an den Firmen-Assistenten. Nutze ausschließlich das Material. Erfinde nichts.",
      "Frag nach dem Wunschkunden in der dritten Person (dieser Kunde / euer Wunschkunde), plus konkrete Praxisfakten (Name, seit wann, Standort, Team, Leistungen), wenn sie dastehen.",
      ...shared,
      "",
      "Material:",
      sourceText.trim(),
      "",
      'Antworte NUR als JSON: {"questions":[{"id":"cfg_pain","question":"Wie beschreibt euer Wunschkunde sein Problem im ersten Gespräch, möglichst in seinen Worten?","expectedHint":"Soll aus dem Material"}]}',
      "Erlaubte ids: cfg_pain, cfg_hormozi_dream, cfg_hurdle, cfg_hormozi_urgency, cfg_hormozi_effort, cfg_hormozi_likelihood, cfg_trigger, cfg_demo_age, cfg_demo_job, cfg_demo_family, cfg_demo_region, cfg_demo_budget, cfg_disg, cfg_criteria, cfg_objections, cfg_experience, cfg_trust, cfg_language, cfg_decision, cfg_alternatives, cfg_firm_name, cfg_firm_since, cfg_firm_place, cfg_firm_team, cfg_firm_offer.",
    ].join("\n");
  }

  return [
    "Erstelle Prüffragen an diese Wunschkunden-Persona. Du darfst NUR Fakten verwenden, die im Material stehen. Erfinde keinen DISG-Typ, keinen Schmerz und kein Wunsch-Ergebnis.",
    "Du-Form, so als spräche ein Mitarbeiter mit dem Interessenten.",
    ...shared,
    "",
    "Material:",
    sourceText.trim(),
    "",
    'Antworte NUR als JSON: {"questions":[{"id":"cfg_pain","question":"Wie würdest du dein Problem beschreiben, so wie du es im ersten Gespräch sagen würdest?","expectedHint":"Soll aus dem Material"}]}',
    "Erlaubte ids: cfg_pain, cfg_hormozi_dream, cfg_hurdle, cfg_hormozi_urgency, cfg_hormozi_effort, cfg_hormozi_likelihood, cfg_trigger, cfg_demo_age, cfg_demo_job, cfg_demo_family, cfg_demo_region, cfg_demo_budget, cfg_intro, cfg_disg, cfg_criteria, cfg_objections, cfg_experience, cfg_trust, cfg_language, cfg_decision, cfg_alternatives.",
  ].join("\n");
}

export function parsePersonaConfigExamQuestions(raw: string): SurveyExamQuestion[] {
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommasInJson(jsonText));
    } catch {
      return [];
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  const questions: SurveyExamQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; question?: unknown; expectedHint?: unknown };
    const question = typeof row.question === "string" ? withoutEmDashes(row.question.trim()) : "";
    const expectedHint = typeof row.expectedHint === "string" ? clipHint(row.expectedHint.trim(), 500) : "";
    if (question.length < 8 || expectedHint.length < 2 || isAwkwardExamQuestion(question)) continue;
    const rawId = typeof row.id === "string" ? row.id.trim().slice(0, 64) : "";
    const id = rawId ? (rawId.startsWith("cfg_") ? rawId : `cfg_${rawId}`) : `cfg_ai_${questions.length + 1}`;
    questions.push({
      id,
      question: question.slice(0, 400),
      expectedHint,
      factId: "persona_config",
      kind: "answer",
    });
    if (questions.length >= MAX_EXAM_QUESTIONS) break;
  }
  return questions;
}

function distinctiveHintTokens(expectedHint: string): string[] {
  return examHintTokens(expectedHint).filter(
    (token) => token.length >= 5 && !HINT_STOPWORDS.has(token),
  );
}

export function personaExamHintIsGrounded(expectedHint: string, sourceText: string): boolean {
  const source = sourceText.toLowerCase().replace(/\s+/g, " ");
  const compact = expectedHint.toLowerCase().replace(/\s+/g, " ").trim();
  if (compact.length >= 8) {
    const slice = compact.slice(0, Math.min(compact.length, 80));
    if (source.includes(slice)) return true;
  }
  const tokens = distinctiveHintTokens(expectedHint);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => source.includes(token));
  if (tokens.length === 1) return hits.length === 1;
  return hits.length >= 2 && hits.length / tokens.length >= 0.45;
}

export function filterGroundedPersonaExamQuestions(
  questions: SurveyExamQuestion[],
  sourceText: string,
): SurveyExamQuestion[] {
  return questions.filter((question) => personaExamHintIsGrounded(question.expectedHint, sourceText));
}

function themeIdOf(question: SurveyExamQuestion): string {
  const fromId = question.id.replace(/^cfg_/, "");
  if ((THEME_ORDER as readonly string[]).includes(fromId)) return fromId;
  const hay = `${question.question} ${question.expectedHint}`;
  if (/wie heißt ihr|wer steht dahinter/i.test(hay)) return "firm_name";
  if (/seit wann gibt es euch|gründung/i.test(hay)) return "firm_since";
  if (/einzugsgebiet|wo seid ihr tätig/i.test(hay)) return "firm_place";
  if (/wer gehört zum team|fachlich aufgestellt/i.test(hay)) return "firm_team";
  if (/welche leistungen bietet ihr/i.test(hay)) return "firm_offer";
  if (/\bdisg\b|\bdisc\b/i.test(hay)) return "disg";
  if (/hält dich davon ab|hält diesen kunden davon ab|hürde/i.test(hay)) return "hurdle";
  if (/perfekte[rn]? ausgang|wunsch-ergebnis|optimal gelaufen/i.test(hay)) return "hormozi_dream";
  if (/wie alt|altersbereich/i.test(hay)) return "demo_age";
  if (/beruflich|lebenssituation/i.test(hay)) return "demo_job";
  if (/familiäre situation|familiaere situation/i.test(hay)) return "demo_family";
  if (/welcher gegend|aus welcher gegend/i.test(hay)) return "demo_region";
  if (/preisspanne|preisbereich/i.test(hay)) return "demo_budget";
  if (/schmerz|problem im ersten gespräch|dein problem/i.test(hay)) return "pain";
  if (/jetzt entscheiden|dringlich|nicht erst später|nicht erst spaeter/i.test(hay)) return "hormozi_urgency";
  if (/aufwand|verzicht/i.test(hay)) return "hormozi_effort";
  if (/wirklich klappt|wahrscheinlichkeit/i.test(hay)) return "hormozi_likelihood";
  if (/überhaupt nach einer lösung|auslöser/i.test(hay)) return "trigger";
  if (/entscheidungskriter|unbedingt stimmen|anbieter aus/i.test(hay)) return "criteria";
  if (/einwand|bedenken|zweifel/i.test(hay)) return "objections";
  if (/schlechte erfahrungen|vorerfahrung/i.test(hay)) return "experience";
  if (/überzeugen|vertrauen/i.test(hay)) return "trust";
  if (/als erstes|allerersten kontakt/i.test(hay)) return "language";
  if (/wer redet|entscheidungsprozess/i.test(hay)) return "decision";
  if (/in betracht/i.test(hay)) return "alternatives";
  if (/stell dich|wie heißt du|wie heisst du/i.test(hay)) return "intro";
  return fromId;
}

/** Keep model questions, then fill themes the model skipped but the config contains. */
export function mergePersonaExamQuestions(
  primary: SurveyExamQuestion[],
  extra: SurveyExamQuestion[],
  max = MAX_EXAM_QUESTIONS,
): SurveyExamQuestion[] {
  const out: SurveyExamQuestion[] = [];
  const themes = new Set<string>();
  const seen = new Set<string>();
  for (const question of [...primary, ...extra]) {
    if (isAwkwardExamQuestion(question.question)) continue;
    const key = question.question.toLowerCase().replace(/\s+/g, " ").trim();
    const theme = themeIdOf(question);
    if (!key || seen.has(key) || themes.has(theme)) continue;
    seen.add(key);
    themes.add(theme);
    out.push(question);
  }
  const rank = (question: SurveyExamQuestion) => {
    const index = THEME_ORDER.indexOf(themeIdOf(question) as PersonaTheme);
    return index === -1 ? THEME_ORDER.length : index;
  };
  out.sort((a, b) => rank(a) - rank(b));
  return out.slice(0, max);
}

export function chooseExamQuestionBank(input: {
  surveyQuestions: SurveyExamQuestion[] | null;
  personaQuestions: SurveyExamQuestion[];
}): { questionSource: "survey" | "persona"; questions: SurveyExamQuestion[] } {
  if (input.surveyQuestions && input.surveyQuestions.length > 0) {
    return { questionSource: "survey", questions: input.surveyQuestions };
  }
  return { questionSource: "persona", questions: input.personaQuestions };
}

function resolveExamGenModels(): string[] {
  const preferred =
    process.env.ANTHROPIC_DT_TITLE_MODEL?.trim() ||
    process.env.ANTHROPIC_DT_PERSONA_MODEL?.trim() ||
    "claude-haiku-4-5-20251001";
  return Array.from(
    new Set([preferred, "claude-haiku-4-5-20251001", "claude-3-5-haiku-latest"].filter(Boolean)),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("persona exam generation timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function generatePersonaConfigExamQuestionsWithAi(
  input: PersonaConfigExamInput,
  sourceText: string,
): Promise<SurveyExamQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return [];

  const audience = input.audience === "company" ? "company" : "persona";
  const client = new Anthropic({ apiKey });
  const userPrompt = buildPersonaConfigExamAiPrompt(sourceText.slice(0, 12_000), audience);
  const system =
    audience === "company"
      ? "Du erstellst Prüffragen wie im Fragebogen: Wunschkunde (Schmerz, Wunsch-Ergebnis, Hürde, Demografie, DISG) und konkrete Praxisfakten. Kein Markdown, nur JSON. Nichts erfinden. Keine Überschriften zitieren."
      : "Du erstellst Prüffragen wie im Wunschkunden-Fragebogen: Schmerz, Wunsch-Ergebnis, Hürde, Demografie, DISG. Du-Form. Kein Markdown, nur JSON. Nichts erfinden.";

  for (const model of resolveExamGenModels()) {
    try {
      const res = await withTimeout(
        client.messages.create({
          model,
          max_tokens: 1800,
          system,
          messages: [{ role: "user", content: userPrompt }],
        }),
        12_000,
      );
      const questions = parsePersonaConfigExamQuestions(extractAnthropicText(res));
      if (questions.length > 0) return questions;
    } catch (error) {
      if (isAnthropicModelNotFoundError(error)) continue;
      console.warn("[dt] persona config exam generation failed", { model }, error);
    }
  }
  return [];
}

/**
 * Questions for a twin that has no usable questionnaire.
 * The model reads the persona settings; structured fields fill any gap it skips.
 */
export async function loadPersonaConfigExamQuestions(
  input: PersonaConfigExamInput,
): Promise<{ questions: SurveyExamQuestion[]; via: PersonaConfigExamVia }> {
  const deterministic = buildPersonaConfigExamQuestions(input);
  const sourceText = personaConfigSourceText(input);
  if (sourceText.trim().length < 180) {
    return { questions: deterministic, via: "persona_config" };
  }

  try {
    const generated = await generatePersonaConfigExamQuestionsWithAi(input, sourceText);
    const grounded = filterGroundedPersonaExamQuestions(generated, sourceText);
    if (grounded.length >= 2) {
      return {
        questions: mergePersonaExamQuestions(grounded, deterministic),
        via: "persona_ai",
      };
    }
  } catch (error) {
    console.warn(
      "[dt] persona config exam generation failed",
      error instanceof Error ? error.message : error,
    );
  }

  return { questions: deterministic, via: "persona_config" };
}
