/**
 * Far fewer customer questions, decided in code. Pure, so the rules are testable without
 * Supabase; `step-patch.ts` applies them after every step, `question-stop.ts` at the page's one
 * stop before the Watermark Entfernung.
 *
 *   - Every question gets a scope: „firma“ (the same on every page: Telefon, Adresse,
 *     Öffnungszeiten, Google-Profil …) or „seite“. The model proposes it; a question whose topic
 *     is in the topic map (`CONTENT_QUESTION_TOPICS`) is always „firma“.
 *   - Never ask what is known: a topic the Kontaktdaten, an answered company question, the
 *     editor's notes or the Anbieterfakten answer is dropped (`knownAnswerFor`), and so is a
 *     question an earlier answer on the page or in the pool already covers (loose text match).
 *   - „firma“ questions go into the organisation's pool (`dt_content_org_questions`), not on the
 *     page; the page keeps at most `CONTENT_MAX_PAGE_QUESTIONS` of its own, the most important
 *     first (severity, then order). The rest become open points that do not stop the page.
 *   - Only the Faktencheck may mark one question „grundlegend“ (the page's main topic itself is
 *     in doubt); that one stops the page right after the Faktencheck.
 */

import type { OrgContactData } from "@/lib/dt/contact-data";
import { extractContactTextFacts } from "@/lib/dt/contact-data-crawl";
import { CONTENT_STEP_FAKTENCHECK } from "@/lib/dt/content/pipeline/steps";
import { contentSectionName, hasContentGap } from "@/lib/dt/content/pipeline/gaps";
import { htmlToPlainText, type ContentTextBlock } from "@/lib/dt/content/render";
import type { ContentFinding, ContentQuestion } from "@/lib/dt/content/types";
import { extractGoogleProfileUrls } from "@/lib/surveys/org-crawl-prefill";

/** At most this many questions of its own per page; the rest become open points. */
export const CONTENT_MAX_PAGE_QUESTIONS = 3;

export type ContentQuestionScope = "firma" | "seite";

export const CONTENT_QUESTION_TOPIC_KEYS = [
  "mobil",
  "telefon",
  "email",
  "adresse",
  "oeffnungszeiten",
  "bewertungen",
  "google_profil",
  "website",
  "ansprechpartner",
] as const;
export type ContentQuestionTopicKey = (typeof CONTENT_QUESTION_TOPIC_KEYS)[number];

/**
 * The topic map: company facts that are the same on every page. Matched against the question,
 * its placeholder and its field (not the sentence around it: „Termin per Telefon vereinbaren
 * … [BITTE PRÜFEN: Preis]“ is a price question). Order matters: Mobil before Telefon.
 */
export const CONTENT_QUESTION_TOPICS: ReadonlyArray<{ key: ContentQuestionTopicKey; label: string; re: RegExp }> = [
  { key: "mobil", label: "Mobilnummer", re: /\b(?:mobil(?:nummer|telefon)?|handy(?:nummer)?|whats\s?app)\b/i },
  // „telefonisch“ (a way of working) is no question for the number.
  { key: "telefon", label: "Telefon", re: /\btelefon(?:nummer)?\b|rufnummer|\btel\.|festnetz|\bhotline\b/i },
  { key: "email", label: "E-Mail", re: /e-?mail|mailadresse/i },
  { key: "adresse", label: "Adresse", re: /\badresse\b|anschrift|stra(?:ß|ss)e und hausnummer|hausnummer|postleitzahl|\bplz\b|anfahrt/i },
  { key: "oeffnungszeiten", label: "Öffnungszeiten", re: /(?:ö|oe)ffnungszeit|sprechzeit|gesch(?:ä|ae)ftszeit|b(?:ü|ue)rozeit|telefonzeit|erreichbarkeit|ge(?:ö|oe)ffnet/i },
  // Reviews before the profile: a rating, a count or a quote is no link.
  { key: "bewertungen", label: "Bewertungen", re: /bewertung|rezension|\bsterne\b|erfahrungsbericht|kundenstimme|o-ton/i },
  { key: "google_profil", label: "Google-Profil", re: /google[- ]?(?:profil|unternehmensprofil|business|maps|eintrag)|google-?link|\bgoogle\b/i },
  { key: "website", label: "Website", re: /website-?adresse|internetadresse|homepage-?adresse|url der (?:website|seite)|\bdomain\b/i },
  { key: "ansprechpartner", label: "Ansprechpartner", re: /ansprechpartner|ansprechperson|\binhaber(?:in)?\b|gesch(?:ä|ae)ftsf(?:ü|ue)hr/i },
];

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function asTopicKey(value: unknown): ContentQuestionTopicKey | null {
  return typeof value === "string" && (CONTENT_QUESTION_TOPIC_KEYS as readonly string[]).includes(value) ? (value as ContentQuestionTopicKey) : null;
}

export function loose(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Every topic of the map a question is about („Öffnungszeiten und Telefonnummer“: two). */
export function questionTopics(q: Pick<ContentQuestion, "question" | "placeholder" | "field">): ContentQuestionTopicKey[] {
  const hay = `${q.question} ${q.placeholder ?? ""} ${q.field ?? ""}`;
  const found = CONTENT_QUESTION_TOPICS.filter((t) => t.re.test(hay)).map((t) => t.key);
  // A mobile number is a phone number too, and Google is the platform of a review: one topic, not two.
  return found.filter((k) => !(k === "telefon" && found.includes("mobil")) && !(k === "google_profil" && found.includes("bewertungen")));
}

/**
 * The one topic of a question, from its wording and placeholder; null for anything
 * page-specific, and null for a question about several topics (it is still a company question,
 * but its answer fits no single Kontaktdaten field).
 */
export function questionTopic(q: Pick<ContentQuestion, "question" | "placeholder" | "field">): ContentQuestionTopicKey | null {
  const topics = questionTopics(q);
  return topics.length === 1 ? topics[0]! : null;
}

/** A placeholder of the text ([BITTE PRÜFEN: …] …), as opposed to the Faktencheck's example answer. */
export function isTextPlaceholder(placeholder: string | null | undefined): boolean {
  return Boolean(placeholder) && hasContentGap(placeholder!);
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Stable id of a question on its page (the answer fields address it). */
export function contentQuestionId(q: Pick<ContentQuestion, "block_id" | "placeholder" | "question">): string {
  const what = isTextPlaceholder(q.placeholder) ? loose(q.placeholder) : loose(q.question);
  return `q${hash(`${q.block_id ?? ""}|${what}`)}`;
}

/** How the organisation's pool recognises the same question from another page: its topic, else its loose text. */
export function poolDedupeKey(q: Pick<ContentQuestion, "question" | "placeholder" | "field" | "topic">): string {
  const topic = q.topic ?? questionTopic(q);
  if (topic) return topic;
  const placeholder = isTextPlaceholder(q.placeholder) ? q.placeholder!.replace(/^\[[^:\]]*:?/, "") : "";
  return `text:${loose(placeholder || q.question).slice(0, 120)}`;
}

function words(text: string): Set<string> {
  return new Set(loose(text).split(" ").filter((w) => w.length >= 4));
}

/** Loose match like `gaps.ts`: one text contains the other, or most of the longer words are shared. */
export function similarQuestionText(a: string, b: string): boolean {
  const la = loose(a);
  const lb = loose(b);
  if (!la || !lb) return false;
  if (la.length > 8 && lb.length > 8 && (la.includes(lb) || lb.includes(la))) return true;
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.75 && shared >= 2;
}

/** Scope, topic, severity and id as the code sets them; a topic in the map is always „firma“. */
export function normalizeQuestionScope(q: ContentQuestion, step: number | null = null): ContentQuestion {
  const topic = questionTopic(q);
  const scope: ContentQuestionScope = questionTopics(q).length > 0 ? "firma" : q.scope === "firma" ? "firma" : "seite";
  const severity = q.severity && q.severity in SEVERITY_RANK ? q.severity : "medium";
  return {
    ...q,
    topic,
    scope,
    severity,
    id: q.id ?? contentQuestionId(q),
    origin_step: q.origin_step ?? step,
    grundlegend: q.grundlegend === true,
  };
}

// --- what is known ------------------------------------------------------------------------------------

/** One question of the organisation's pool as the planner needs it. */
export type ContentPoolQuestion = {
  id: string;
  dedupe_key: string;
  topic_key: string | null;
  question: string;
  status: "open" | "answered" | "no_answer";
  answer: string | null;
  page_slugs: string[];
};

/**
 * What the page and the organisation already know, for the question rules and the stop:
 * a value per topic (Kontaktdaten first, then the pool, the notes, the Anbieterfakten), the
 * topics that are known to have no answer, the pool and earlier answers on the page.
 */
export type ContentKnowledge = {
  values: Partial<Record<ContentQuestionTopicKey, { value: string; source: "kontaktdaten" | "pool" | "notiz" | "fakten" }>>;
  /** Known as „keine Angabe“: „Kein Google-Profil“, a pool question answered with „Keine Angabe“. */
  dropped: Partial<Record<ContentQuestionTopicKey, "kontaktdaten" | "pool">>;
  pool: ContentPoolQuestion[];
  /** Questions already answered on this page (its notes) or in the pool, never asked again. */
  answered: Array<{ question: string; answer: string | null }>;
};

export const EMPTY_CONTENT_KNOWLEDGE: ContentKnowledge = { values: {}, dropped: {}, pool: [], answered: [] };

function factValues(text: string): Partial<Record<ContentQuestionTopicKey, string>> {
  if (!text.trim()) return {};
  const facts = extractContactTextFacts(text);
  const out: Partial<Record<ContentQuestionTopicKey, string>> = {};
  if (facts.telefon) out.telefon = facts.telefon;
  if (facts.mobil) out.mobil = facts.mobil;
  if (facts.email) out.email = facts.email;
  if (facts.strasse && facts.ort) out.adresse = `${facts.strasse}, ${[facts.plz, facts.ort].filter(Boolean).join(" ")}`;
  if (facts.oeffnungszeiten) out.oeffnungszeiten = facts.oeffnungszeiten;
  const google = extractGoogleProfileUrls(text)[0];
  if (google) out.google_profil = google;
  return out;
}

/** The note an answer at the page's stop leaves for the later steps (`answeredInNotes` reads it back). */
export function customerAnswerNote(question: string, answer: string | null): string {
  return answer?.trim()
    ? `Antwort des Kunden auf „${question.trim()}“: ${answer.trim()}`
    : `Keine Angabe des Kunden zu „${question.trim()}“ – die Aussage weglassen.`;
}

/** The questions and answers the notes hold (`customerAnswerNote`); a „Keine Angabe“ has no answer. */
export function answeredInNotes(notes: readonly string[]): Array<{ question: string; answer: string | null }> {
  const out: Array<{ question: string; answer: string | null }> = [];
  for (const note of notes) {
    for (const line of note.split("\n")) {
      const answered = line.match(/^Antwort des Kunden auf „(.{4,600}?)“: (.+)$/);
      if (answered) out.push({ question: answered[1]!, answer: answered[2]!.trim() });
      const none = line.match(/^Keine Angabe des Kunden zu „(.{4,600}?)“/);
      if (none) out.push({ question: none[1]!, answer: null });
    }
  }
  return out;
}

export function buildContentKnowledge(input: {
  contact?: Pick<OrgContactData, "fields" | "no_google_profile"> | null;
  pool?: readonly ContentPoolQuestion[];
  notes?: readonly string[];
  anbieterText?: string;
}): ContentKnowledge {
  const values: ContentKnowledge["values"] = {};
  const dropped: ContentKnowledge["dropped"] = {};
  const set = (key: ContentQuestionTopicKey, value: string | null | undefined, source: "kontaktdaten" | "pool" | "notiz" | "fakten") => {
    const v = (value ?? "").trim();
    if (v && !values[key]) values[key] = { value: v, source };
  };
  const field = (key: keyof OrgContactData["fields"]) => input.contact?.fields[key]?.value.trim() ?? "";
  if (input.contact) {
    set("telefon", field("telefon") || field("mobil"), "kontaktdaten");
    set("mobil", field("mobil"), "kontaktdaten");
    set("email", field("email"), "kontaktdaten");
    if (field("strasse") && field("ort")) set("adresse", `${field("strasse")}, ${[field("plz"), field("ort")].filter(Boolean).join(" ")}`, "kontaktdaten");
    set("oeffnungszeiten", field("oeffnungszeiten"), "kontaktdaten");
    set("website", field("website"), "kontaktdaten");
    set("ansprechpartner", field("ansprechpartner"), "kontaktdaten");
    if (input.contact.no_google_profile) dropped.google_profil = "kontaktdaten";
    else set("google_profil", field("google_profil"), "kontaktdaten");
    // A rating or review only from the facts, never invented: with the profile known (or none),
    // a review placeholder is left out instead of asked; the text can point to the profile.
    if (input.contact.no_google_profile || field("google_profil")) dropped.bewertungen = "kontaktdaten";
  }
  const answered: ContentKnowledge["answered"] = [];
  for (const row of input.pool ?? []) {
    const topic = asTopicKey(row.topic_key);
    if (row.status === "answered" && row.answer?.trim()) {
      if (topic) set(topic, row.answer, "pool");
      answered.push({ question: row.question, answer: row.answer.trim() });
    } else if (row.status === "no_answer") {
      if (topic && !values[topic]) dropped[topic] ??= "pool";
      answered.push({ question: row.question, answer: null });
    }
  }
  const notes = input.notes ?? [];
  for (const [key, value] of Object.entries(factValues(notes.join("\n"))) as Array<[ContentQuestionTopicKey, string]>) set(key, value, "notiz");
  for (const [key, value] of Object.entries(factValues(input.anbieterText ?? "")) as Array<[ContentQuestionTopicKey, string]>) set(key, value, "fakten");
  answered.push(...answeredInNotes(notes));
  return { values, dropped, pool: [...(input.pool ?? [])], answered };
}

export type KnownAnswer =
  | { action: "answer"; value: string; source: "kontaktdaten" | "pool" | "notiz" | "fakten" | "antwort" }
  | { action: "drop"; source: "kontaktdaten" | "pool" | "antwort" };

/** Whether the question is answered already, and with what. Null when only the customer knows. */
export function knownAnswerFor(q: ContentQuestion, knowledge: ContentKnowledge): KnownAnswer | null {
  const topics = questionTopics(q);
  if (topics.length > 1) {
    // Several topics: known only when every one is; the answer names each value.
    if (!topics.every((t) => knowledge.values[t] || knowledge.dropped[t])) return null;
    const parts = topics.filter((t) => knowledge.values[t]).map((t) => `${CONTENT_QUESTION_TOPICS.find((x) => x.key === t)!.label}: ${knowledge.values[t]!.value}`);
    return parts.length > 0 ? { action: "answer", value: parts.join("; "), source: knowledge.values[topics.find((t) => knowledge.values[t])!]!.source } : { action: "drop", source: "kontaktdaten" };
  }
  const topic = asTopicKey(q.topic) ?? questionTopic(q);
  if (topic) {
    const value = knowledge.values[topic];
    if (value) return { action: "answer", value: value.value, source: value.source };
    const dropped = knowledge.dropped[topic];
    if (dropped) return { action: "drop", source: dropped };
  }
  const key = poolDedupeKey(q);
  const pooled = knowledge.pool.find((p) => p.dedupe_key === key || (!p.topic_key && !topic && similarQuestionText(p.question, q.question)));
  if (pooled?.status === "answered" && pooled.answer?.trim()) return { action: "answer", value: pooled.answer.trim(), source: "pool" };
  if (pooled?.status === "no_answer") return { action: "drop", source: "pool" };
  const earlier = knowledge.answered.find((a) => similarQuestionText(a.question, q.question));
  if (earlier) return earlier.answer ? { action: "answer", value: earlier.answer, source: "antwort" } : { action: "drop", source: "antwort" };
  return null;
}

/**
 * A question about several topics of which all but one are known („Telefon, E-Mail und
 * Erreichbarkeitszeiten“ with phone and e-mail in the Kontaktdaten) is a question about that
 * one: same pool entry as the plain question, its answer fills that Kontaktdaten field.
 */
export function narrowQuestionTopic(q: ContentQuestion, knowledge: ContentKnowledge): ContentQuestion {
  const topics = questionTopics(q);
  if (topics.length < 2) return q;
  const unknown = topics.filter((t) => !knowledge.values[t] && !knowledge.dropped[t]);
  return unknown.length === 1 ? { ...q, topic: unknown[0]! } : q;
}

// --- the plan after a step ----------------------------------------------------------------------------

function blockText(block: ContentTextBlock): string {
  return `${block.heading ?? ""} ${htmlToPlainText(block.html)}`;
}

/**
 * A question from an earlier step still applies: its placeholder is still in the text, or (a
 * Faktencheck question without one) its sentence is still there. A rewrite that removed the
 * statement settled it.
 */
export function questionStillRelevant(q: ContentQuestion, blocks: readonly ContentTextBlock[]): boolean {
  if (isTextPlaceholder(q.placeholder)) {
    const placeholder = loose(q.placeholder);
    return blocks.some((b) => loose(blockText(b)).includes(placeholder));
  }
  if (!q.excerpt?.trim()) return true;
  const excerpt = loose(q.excerpt).slice(0, 120);
  return excerpt.length < 12 || blocks.some((b) => loose(blockText(b)).includes(excerpt));
}

export type ContentQuestionPlan = {
  /** The page's own questions after this step: at most CONTENT_MAX_PAGE_QUESTIONS (a „grundlegend“ one included). */
  page: ContentQuestion[];
  /** Company questions for the pool, each once. */
  firma: ContentQuestion[];
  /** Page questions over the limit: not asked, open points instead. */
  overflow: ContentQuestion[];
  /** Questions the code dropped because the answer is known. */
  suppressed: Array<{ question: string; reason: string }>;
  /** The one question that stops the page right after the Faktencheck. */
  grundlegend: ContentQuestion | null;
};

function sameQuestion(a: ContentQuestion, b: ContentQuestion): boolean {
  if (a.id && a.id === b.id) return true;
  if (a.topic && a.topic === b.topic) return true;
  if (isTextPlaceholder(a.placeholder) && isTextPlaceholder(b.placeholder)) {
    return (a.block_id ?? "") === (b.block_id ?? "") && loose(a.placeholder) === loose(b.placeholder);
  }
  return (a.block_id ?? "") === (b.block_id ?? "") && similarQuestionText(a.question, b.question);
}

const KNOWN_REASON: Record<string, string> = {
  kontaktdaten: "steht in den Kontaktdaten",
  pool: "beantwortet unter „Fragen zum Unternehmen“",
  notiz: "steht in den Anmerkungen der Redaktion",
  fakten: "steht in den Anbieterfakten",
  antwort: "schon beantwortet",
};

/**
 * The page's questions after a step: the earlier ones that still apply first, then this step's
 * (model questions and placeholders of the text). Known ones are dropped, company ones go to the
 * pool, each question is kept once, and at most three stay on the page.
 */
export function planContentQuestions(input: {
  candidates: readonly ContentQuestion[];
  existing?: readonly ContentQuestion[];
  knowledge?: ContentKnowledge;
  blocks: readonly ContentTextBlock[];
  step: number;
}): ContentQuestionPlan {
  const knowledge = input.knowledge ?? EMPTY_CONTENT_KNOWLEDGE;
  const sectionOf = new Map(input.blocks.map((b) => [b.id, contentSectionName(b)]));
  const ids = new Set(input.blocks.map((b) => b.id));
  const existing = (input.existing ?? [])
    .filter((q) => questionStillRelevant(q, input.blocks))
    .map((q) => (q.block_id && !ids.has(q.block_id) ? { ...q, block_id: null, section: null } : q));
  const all = [...existing.map((q) => normalizeQuestionScope(q)), ...input.candidates.map((q) => normalizeQuestionScope(q, input.step))].map((q) => ({
    ...narrowQuestionTopic(q, knowledge),
    section: q.section ?? (q.block_id ? (sectionOf.get(q.block_id) ?? q.block_id) : null),
  }));

  const kept: ContentQuestion[] = [];
  const suppressed: ContentQuestionPlan["suppressed"] = [];
  for (const q of all) {
    if (kept.some((k) => sameQuestion(k, q))) continue;
    const known = knownAnswerFor(q, knowledge);
    if (known) {
      suppressed.push({ question: q.question, reason: KNOWN_REASON[known.source] ?? "bekannt" });
      continue;
    }
    kept.push(q);
  }

  const firma: ContentQuestion[] = [];
  for (const q of kept.filter((k) => k.scope === "firma")) {
    if (!firma.some((f) => poolDedupeKey(f) === poolDedupeKey(q))) firma.push({ ...q, grundlegend: false });
  }

  // Only the Faktencheck may stop early, and only for one question.
  let grundlegend: ContentQuestion | null = null;
  const pageOwn = kept.filter((k) => k.scope === "seite");
  if (input.step === CONTENT_STEP_FAKTENCHECK) {
    grundlegend =
      [...pageOwn]
        .filter((q) => q.grundlegend && q.origin_step === CONTENT_STEP_FAKTENCHECK)
        .sort((a, b) => (SEVERITY_RANK[a.severity ?? "medium"] ?? 1) - (SEVERITY_RANK[b.severity ?? "medium"] ?? 1))[0] ?? null;
  }
  const ranked = pageOwn
    .map((q, order) => ({ q: { ...q, grundlegend: grundlegend != null && q.id === grundlegend.id }, order }))
    .sort((a, b) => {
      if (a.q.grundlegend !== b.q.grundlegend) return a.q.grundlegend ? -1 : 1;
      return (SEVERITY_RANK[a.q.severity ?? "medium"] ?? 1) - (SEVERITY_RANK[b.q.severity ?? "medium"] ?? 1) || a.order - b.order;
    })
    .map((r) => r.q);
  return {
    page: ranked.slice(0, CONTENT_MAX_PAGE_QUESTIONS),
    firma,
    overflow: ranked.slice(CONTENT_MAX_PAGE_QUESTIONS),
    suppressed,
    grundlegend: grundlegend ? ranked.find((q) => q.grundlegend) ?? null : null,
  };
}

/** Page questions over the limit, as open points: they do not stop the page. */
export function overflowFindings(overflow: readonly ContentQuestion[]): ContentFinding[] {
  return overflow.map((q) => ({
    title: "Offene Frage (nicht gestellt)",
    problem: [q.question, q.excerpt ? `Stelle: „${q.excerpt}“` : ""].filter(Boolean).join(" "),
    proposal: isTextPlaceholder(q.placeholder)
      ? `Den Satz ohne die Angabe ${q.placeholder} formulieren oder die Angabe ergänzen.`
      : "Die Aussage ohne diese Angabe formulieren oder die Angabe ergänzen.",
    severity: "low",
    severity_label: "Hinweis",
    block_id: q.block_id ?? null,
  }));
}

/** What a step's row records of the plan (like `unasked_questions` of the Aktualitätsprüfung). */
export function questionPlanRecord(plan: ContentQuestionPlan): Record<string, unknown> {
  return {
    asked_on_page: plan.page.map((q) => q.question),
    company_questions: plan.firma.map((q) => q.question),
    unasked_questions: plan.overflow.map((q) => q.question),
    suppressed_questions: plan.suppressed,
    grundlegend: plan.grundlegend?.question ?? null,
  };
}
