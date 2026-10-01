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
  "intro",
  "disg",
  "personality",
  "pain",
  "criteria",
  "objections",
  "hormozi_dream",
  "hormozi_urgency",
  "hormozi_effort",
  "hormozi_likelihood",
  "decision",
  "experience",
] as const;

type PersonaTheme = (typeof THEME_ORDER)[number];

const THEME_KEYS: Record<Exclude<PersonaTheme, "personality">, string[]> = {
  intro: ["alter", "age", "situation", "lebenssituation"],
  disg: ["disg", "disc", "disgtyp", "disgtype"],
  pain: [
    "pain",
    "painpoints",
    "painpoint",
    "schmerz",
    "schmerzpunkte",
    "sorgen",
    "aengste",
    "angste",
    "tiefsteangst",
  ],
  criteria: ["entscheidungskriterien", "entscheidungskriterium", "kriterien"],
  objections: ["einwaende", "einwande", "objections", "bedenken"],
  hormozi_dream: [
    "traum",
    "traumergebnis",
    "traumziel",
    "dreamoutcome",
    "hormozidream",
    "personahormozidream",
    "perfekterausgang",
    "grosserwunsch",
  ],
  hormozi_urgency: [
    "dringlichkeit",
    "urgency",
    "warumjetzt",
    "zeitdruck",
    "hormoziurgency",
    "personahormoziurgency",
  ],
  hormozi_effort: ["aufwand", "effort", "opfer", "sacrifice", "verzicht", "hormozieffort"],
  hormozi_likelihood: ["wahrscheinlichkeit", "likelihood", "erfolgswahrscheinlichkeit", "hormozilikelihood"],
  decision: ["entscheidungsprozess"],
  experience: ["vorerfahrungen"],
};

const LINE_THEMES: Array<{ theme: PersonaTheme; re: RegExp }> = [
  { theme: "disg", re: /^(?:disg(?:[-\s]?typ)?|disc)\s*[:：-]\s*(.+)$/i },
  {
    theme: "pain",
    re: /^(?:pain\s*points?|schmerz(?:punkte)?|sorgen|ängste|aengste|tiefste\s+angst)\s*[:：-]\s*(.+)$/i,
  },
  { theme: "criteria", re: /^(?:entscheidungskriterien|kriterien)\s*[:：-]\s*(.+)$/i },
  { theme: "objections", re: /^(?:einwände|einwaende|bedenken)\s*[:：-]\s*(.+)$/i },
  {
    theme: "hormozi_dream",
    re: /^(?:traumergebnis|traumziel|perfekter\s+ausgang|dream\s*outcome|gro[sß]e[rn]?\s+wunsch)\s*[:：-]\s*(.+)$/i,
  },
  { theme: "hormozi_urgency", re: /^(?:dringlichkeit|warum\s+jetzt|zeitdruck)\s*[:：-]\s*(.+)$/i },
  { theme: "hormozi_effort", re: /^(?:aufwand|opfer|verzicht)\s*[:：-]\s*(.+)$/i },
  { theme: "hormozi_likelihood", re: /^(?:wahrscheinlichkeit|erfolgswahrscheinlichkeit)\s*[:：-]\s*(.+)$/i },
  { theme: "decision", re: /^(?:entscheidungsprozess)\s*[:：-]\s*(.+)$/i },
  { theme: "experience", re: /^(?:vorerfahrungen)\s*[:：-]\s*(.+)$/i },
  { theme: "intro", re: /^(?:alter|situation|lebenssituation)\s*[:：-]\s*(.+)$/i },
];

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

const COMPANY_HEADING_SKIP =
  /anker|aktuelles datum|perspektive|gesprächsrahmen|gespraechsrahmen|rollen-ausrichtung|identität|identitaet|wer mit dir spricht|zusätzliche nutzerregeln|globale/i;

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
  for (const theme of Object.keys(THEME_KEYS) as Array<keyof typeof THEME_KEYS>) {
    if (keyMatches(key, THEME_KEYS[theme])) return theme;
  }
  return null;
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

function labeledFacts(body: string): Array<{ theme: PersonaTheme; value: string }> {
  const found: Array<{ theme: PersonaTheme; value: string }> = [];
  for (const line of body.split("\n")) {
    const trimmed = line.replace(/^[-*•]\s*/, "").trim();
    if (!trimmed) continue;
    for (const spec of LINE_THEMES) {
      const match = spec.re.exec(trimmed);
      const value = match?.[1]?.trim();
      if (value) {
        found.push({ theme: spec.theme, value });
        break;
      }
    }
  }
  return found;
}

function themeForHeading(title: string, body: string): PersonaTheme | null {
  const heading = title.toLowerCase();
  if (!heading) return null;
  if (/disg|disc/.test(heading)) return "disg";
  if (/persönlichkeit|persoenlichkeit/.test(heading)) {
    return /\bdisg\b|\bdisc\b/i.test(body) ? "disg" : "personality";
  }
  if (/schmerz|pain\s*point|sorgen|ängste|aengste|\bangst\b/.test(heading)) return "pain";
  if (/entscheidungskriter|kriterien/.test(heading)) return "criteria";
  if (/einwänd|einwaend|bedenken/.test(heading)) return "objections";
  if (/traum|perfekte|gro[sß]e[rn]?\s+wunsch|dream/.test(heading)) return "hormozi_dream";
  if (/dringlich|warum jetzt|zeitdruck|urgency/.test(heading)) return "hormozi_urgency";
  if (/aufwand|opfer|verzicht|sacrifice/.test(heading)) return "hormozi_effort";
  if (/wahrscheinlichkeit|likelihood/.test(heading)) return "hormozi_likelihood";
  if (/entscheidungsprozess/.test(heading)) return "decision";
  if (/vorerfahrung/.test(heading)) return "experience";
  if (/situation|identit/.test(heading)) return "intro";
  if (/hormozi/.test(heading)) return "hormozi_dream";
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
    const minLength = theme === "disg" ? 1 : theme === "intro" ? 2 : 8;
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
    if (!theme || !section.body) continue;
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

function questionForTheme(theme: PersonaTheme, hint: string): string {
  switch (theme) {
    case "intro":
      return "Stell dich bitte vor: Wie heißt du, wie alt bist du ungefähr, und was ist gerade deine Situation?";
    case "disg":
      return hint.length < 40
        ? "Welcher DISG-Typ bist du?"
        : "Welcher DISG-Typ bist du, und wie zeigt sich das in deinem Verhalten?";
    case "personality":
      return "Wie würdest du deine Art beschreiben, und wie merkt man das im Gespräch?";
    case "pain":
      return "Was beschäftigt dich gerade am meisten, und was ist dein eigentlicher Schmerz dabei?";
    case "criteria":
      return "Wonach suchst du dir einen Anbieter aus, und was muss für dich unbedingt stimmen?";
    case "objections":
      return "Welche Bedenken oder Einwände hast du, bevor du dich entscheidest?";
    case "hormozi_dream":
      return "Wie sähe für dich der perfekte Ausgang aus, wenn alles optimal läuft?";
    case "hormozi_urgency":
      return "Warum würdest du dich jetzt entscheiden und nicht erst später?";
    case "hormozi_effort":
      return "Was wäre dir an Aufwand, Risiko oder Verzicht zu viel, bevor du zusagst?";
    case "hormozi_likelihood":
      return "Was müsste passieren, damit du glaubst, dass das bei dir wirklich klappt?";
    case "decision":
      return "Wie triffst du so eine Entscheidung, und wer redet dabei mit?";
    case "experience":
      return "Welche früheren Erfahrungen mit Anbietern oder Lösungen prägen dich noch?";
    default:
      return "Was ist dir in deiner Situation gerade am wichtigsten?";
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
      return "Pain Points";
    case "criteria":
      return "Entscheidungskriterien";
    case "objections":
      return "Einwände";
    case "hormozi_dream":
      return "Traumergebnis";
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
    default:
      return "Persona";
  }
}

function toExamQuestion(theme: PersonaTheme, hint: string): SurveyExamQuestion {
  const expectedHint = clipHint(hint);
  return {
    id: `cfg_${theme}`,
    question: withoutEmDashes(questionForTheme(theme, expectedHint)),
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

function buildCompanyExamQuestions(input: PersonaConfigExamInput): SurveyExamQuestion[] {
  const prompt = personaConfigSourceText({ ...input, avatarData: null });
  const questions: SurveyExamQuestion[] = [];
  const seen = new Set<string>();
  for (const section of splitPromptSections(prompt)) {
    if (!section.title || !section.body || section.body.length < 40) continue;
    if (COMPANY_HEADING_SKIP.test(section.title)) continue;
    const question = withoutEmDashes(
      `Was gilt bei euch zu „${section.title.replace(/[?？]/g, "")}", bitte mit den konkreten Angaben?`,
    );
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push({
      id: `cfg_company_${questions.length + 1}`,
      question,
      expectedHint: clipHint(section.body),
      factId: "persona_config",
      kind: "answer",
    });
    if (questions.length >= 8) break;
  }
  return questions;
}

/**
 * Deterministic probes from avatar_data and prompt headings.
 * Only themes that are actually configured become questions.
 */
export function buildPersonaConfigExamQuestions(
  input: PersonaConfigExamInput,
): SurveyExamQuestion[] {
  const audience = input.audience === "company" ? "company" : "persona";
  if (audience === "company") return buildCompanyExamQuestions(input);

  const buckets = collectThemeValues(input);
  const introHint = buildIntroHint(input, buckets);
  const hasAgeOrSituation = (buckets.get("intro") ?? []).length > 0;
  const hasRole = Boolean(input.role?.trim() && input.role.trim().length > 8);
  const otherThemes = THEME_ORDER.filter((theme) => theme !== "intro" && theme !== "personality");
  const hasOther = otherThemes.some((theme) => (buckets.get(theme) ?? []).length > 0);
  const hasPersonality = (buckets.get("personality") ?? []).length > 0;
  if (!hasAgeOrSituation && !hasRole && !hasOther && !hasPersonality) return [];

  const questions: SurveyExamQuestion[] = [];
  if ((hasAgeOrSituation || hasRole || input.name?.trim()) && introHint) {
    questions.push(toExamQuestion("intro", `${hintLabel("intro")}: ${introHint}`));
  }

  for (const theme of THEME_ORDER) {
    if (theme === "intro") continue;
    if (theme === "personality" && (buckets.get("disg") ?? []).length > 0) continue;
    const values = buckets.get(theme);
    if (!values || values.length === 0) continue;
    const body = uniqueJoin(values);
    if (!body) continue;
    questions.push(toExamQuestion(theme, `${hintLabel(theme)}: ${body}`));
  }

  return questions.slice(0, 12);
}

export function buildPersonaConfigExamAiPrompt(
  sourceText: string,
  audience: SurveyExamAudience = "persona",
): string {
  if (audience === "company") {
    return [
      "Erstelle Prüffragen an den Firmen-/SEO-Assistenten. Nutze ausschließlich den folgenden Text. Erfinde nichts.",
      "",
      sourceText.trim(),
      "",
      'Antworte NUR als JSON: {"questions":[{"id":"cfg_company_1","question":"deutsche Prüffrage","expectedHint":"Soll-Inhalt wörtlich aus dem Text"}]}',
      "4 bis 8 Fragen. expectedHint ist der konkrete Soll-Inhalt, den die Antwort sinngemäß treffen muss.",
      "Keine Fragen zu DISG oder Wunschkunden-Psychologie, nur zu den Firmenfakten im Text.",
    ].join("\n");
  }

  return [
    "Erstelle Prüffragen an diese Wunschkunden-Persona. Du darfst NUR Fakten verwenden, die im Material stehen. Erfinde keinen DISG-Typ, keine Pain Points und keine Kriterien.",
    "",
    "Pflicht, aber nur wenn das Material es hergibt:",
    "- Vorstellung (Name, Alter, Situation)",
    "- DISG-Typ und das dazu beschriebene Verhalten",
    "- Pain Points, Ängste, Sorgen",
    "- Entscheidungskriterien",
    "- Einwände",
    "- Hormozi-Wertgleichung: Traumergebnis, Dringlichkeit (warum jetzt), Aufwand/Opfer, gefühlte Wahrscheinlichkeit",
    "- Entscheidungsprozess und Vorerfahrungen, falls genannt",
    "",
    "Material:",
    sourceText.trim(),
    "",
    'Antworte NUR als JSON: {"questions":[{"id":"cfg_disg","question":"deutsche Du-Frage als Mitarbeiter an die Persona","expectedHint":"kurzer Soll-Text aus dem Material"}]}',
    "Erlaubte ids: cfg_intro, cfg_disg, cfg_personality, cfg_pain, cfg_criteria, cfg_objections, cfg_hormozi_dream, cfg_hormozi_urgency, cfg_hormozi_effort, cfg_hormozi_likelihood, cfg_decision, cfg_experience.",
    "6 bis 12 Fragen, fehlende Themen weglassen. expectedHint muss so im Material stehen, dass man die Antwort daran prüfen kann.",
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
    if (question.length < 8 || expectedHint.length < 2) continue;
    const rawId = typeof row.id === "string" ? row.id.trim().slice(0, 64) : "";
    const id = rawId ? (rawId.startsWith("cfg_") ? rawId : `cfg_${rawId}`) : `cfg_ai_${questions.length + 1}`;
    questions.push({
      id,
      question: question.slice(0, 400),
      expectedHint,
      factId: "persona_config",
      kind: "answer",
    });
    if (questions.length >= 12) break;
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
  if (/\bdisg\b|\bdisc\b/i.test(hay)) return "disg";
  if (/pain|schmerz|sorge|ängste|aengste|belastet/i.test(hay)) return "pain";
  if (/entscheidungskriter|unbedingt stimmen|anbieter aus/i.test(hay)) return "criteria";
  if (/einwand|bedenken/i.test(hay)) return "objections";
  if (/perfekte ausgang|traumergebnis|optimal läuft|optimal laeuft/i.test(hay)) return "hormozi_dream";
  if (/jetzt entscheiden|dringlich|nicht erst später|nicht erst spaeter/i.test(hay)) return "hormozi_urgency";
  if (/aufwand|verzicht/i.test(hay)) return "hormozi_effort";
  if (/wirklich klappt|wahrscheinlichkeit/i.test(hay)) return "hormozi_likelihood";
  if (/wer redet|entscheidungsprozess/i.test(hay)) return "decision";
  if (/früheren erfahrungen|frueheren erfahrungen|vorerfahrung/i.test(hay)) return "experience";
  if (/stell dich|wie heißt du|wie heisst du/i.test(hay)) return "intro";
  return fromId;
}

/** Keep model questions, then fill themes the model skipped but the config contains. */
export function mergePersonaExamQuestions(
  primary: SurveyExamQuestion[],
  extra: SurveyExamQuestion[],
  max = 12,
): SurveyExamQuestion[] {
  const out: SurveyExamQuestion[] = [];
  const themes = new Set<string>();
  const seen = new Set<string>();
  for (const question of [...primary, ...extra]) {
    if (out.length >= max) break;
    const key = question.question.toLowerCase().replace(/\s+/g, " ").trim();
    const theme = themeIdOf(question);
    if (!key || seen.has(key) || themes.has(theme)) continue;
    seen.add(key);
    themes.add(theme);
    out.push(question);
  }
  return out;
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
      ? "Du erstellst Prüffragen aus Firmenwissen. Kein Markdown, nur JSON. Nichts erfinden."
      : "Du erstellst Prüffragen aus Persona-Einstellungen (DISG, Pain Points, Entscheidungskriterien, Hormozi). Kein Markdown, nur JSON. Nichts erfinden.";

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
