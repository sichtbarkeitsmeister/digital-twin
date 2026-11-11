/**
 * „Fragen zum Unternehmen“: the organisation's pool of company questions
 * (`dt_content_org_questions`, migration 20261104). A question about the company (Telefon,
 * Öffnungszeiten, Google-Profil …) is asked once here instead of on every page; one answer
 * applies to all pages. Service client: routes check access first, the job runner has none.
 */

import { isKundePrueft } from "@/lib/dt/content/pipeline/kunde-prueft";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTACT_FIELD_KEYS, type ContactFieldKey } from "@/lib/dt/contact-data";
import { splitAddress } from "@/lib/dt/contact-data-crawl";
import { saveOrgContactData } from "@/lib/dt/contact-data-store";
import {
  asTopicKey,
  poolDedupeKey,
  questionTopic,
  type ContentPoolQuestion,
  type ContentQuestionTopicKey,
} from "@/lib/dt/content/pipeline/questions";
import type { ContentQuestion } from "@/lib/dt/content/types";
import { extractGoogleProfileUrls } from "@/lib/surveys/org-crawl-prefill";

export const CONTENT_ORG_QUESTIONS_MIGRATION_FILE = "database/migrations/20261104_dt_content_fewer_questions.sql";

const COLUMNS = "id, organisation_id, dedupe_key, topic_key, question, placeholder, excerpt, status, answer, answered_by, answered_at, page_slugs, created_at, updated_at";

export type ContentOrgQuestionRow = ContentPoolQuestion & {
  organisation_id: string;
  placeholder: string | null;
  excerpt: string | null;
  answered_by: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
};

export class ContentOrgQuestionsMigrationError extends Error {
  constructor() {
    super(`Die Datenbank kennt die Fragen zum Unternehmen noch nicht: Bitte ${CONTENT_ORG_QUESTIONS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin läuft in Texte kein Schritt.`);
    this.name = "ContentOrgQuestionsMigrationError";
  }
}

export function isMissingOrgQuestionsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return /dt_content_org_questions/i.test(error.message ?? "") && (error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? ""));
}

function rowFrom(raw: Record<string, unknown>): ContentOrgQuestionRow {
  const status = raw.status === "answered" || raw.status === "no_answer" ? raw.status : "open";
  return {
    ...(raw as unknown as ContentOrgQuestionRow),
    status,
    topic_key: typeof raw.topic_key === "string" ? raw.topic_key : null,
    answer: typeof raw.answer === "string" ? raw.answer : null,
    page_slugs: Array.isArray(raw.page_slugs) ? raw.page_slugs.filter((s): s is string => typeof s === "string") : [],
  };
}

export async function loadOrgQuestions(service: SupabaseClient, organisationId: string): Promise<ContentOrgQuestionRow[]> {
  const { data, error } = await service.from("dt_content_org_questions").select(COLUMNS).eq("organisation_id", organisationId).order("created_at", { ascending: true });
  if (error) {
    if (isMissingOrgQuestionsError(error)) throw new ContentOrgQuestionsMigrationError();
    throw new Error(`Fragen zum Unternehmen konnten nicht geladen werden: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(rowFrom);
}

/**
 * Company questions of a page into the pool: a question the pool has (same topic or text) only
 * gets the page added; a new one is created open. Returns the rows as they are now.
 */
export async function addOrgQuestions(
  service: SupabaseClient,
  organisationId: string,
  slug: string,
  questions: readonly ContentQuestion[],
): Promise<ContentOrgQuestionRow[]> {
  if (questions.length === 0) return loadOrgQuestions(service, organisationId);
  const rows = await loadOrgQuestions(service, organisationId);
  for (const q of questions) {
    const key = poolDedupeKey(q);
    const existing = rows.find((r) => r.dedupe_key === key);
    if (existing) {
      if (!existing.page_slugs.includes(slug)) {
        const page_slugs = [...existing.page_slugs, slug].slice(-200);
        const { error } = await service.from("dt_content_org_questions").update({ page_slugs }).eq("id", existing.id);
        if (error) throw new Error(`Frage zum Unternehmen konnte nicht gespeichert werden: ${error.message}`);
        existing.page_slugs = page_slugs;
      }
      continue;
    }
    const insert = {
      organisation_id: organisationId,
      dedupe_key: key,
      topic_key: asTopicKey(q.topic) ?? questionTopic(q),
      question: q.question.slice(0, 600),
      placeholder: q.placeholder ?? null,
      excerpt: q.excerpt ?? null,
      status: "open",
      page_slugs: [slug],
    };
    const { data, error } = await service.from("dt_content_org_questions").upsert(insert, { onConflict: "organisation_id,dedupe_key" }).select(COLUMNS);
    if (error) {
      if (isMissingOrgQuestionsError(error)) throw new ContentOrgQuestionsMigrationError();
      throw new Error(`Frage zum Unternehmen konnte nicht gespeichert werden: ${error.message}`);
    }
    const saved = Array.isArray(data) && data[0] ? rowFrom(data[0] as Record<string, unknown>) : rowFrom({ ...insert, id: `new-${rows.length}` });
    rows.push(saved);
  }
  return rows;
}

/** The Kontaktdaten field(s) an answer of a topic fills; null when it is a fact only. */
export function contactFieldsForAnswer(topic: ContentQuestionTopicKey | null, answer: string): Partial<Record<ContactFieldKey, string>> | null {
  const value = answer.trim();
  if (!topic || !value) return null;
  switch (topic) {
    case "telefon":
    case "mobil":
    case "email":
    case "oeffnungszeiten":
    case "website":
    case "ansprechpartner":
      return { [topic]: value };
    case "adresse": {
      const parts = splitAddress(value);
      return parts ? { strasse: parts.strasse, plz: parts.plz, ort: parts.ort } : null;
    }
    case "google_profil": {
      const link = extractGoogleProfileUrls(value)[0];
      return link ? { google_profil: link } : null;
    }
    default:
      return null;
  }
}

export type AnswerOrgQuestionResult = { row: ContentOrgQuestionRow; contactFields: ContactFieldKey[] };

/**
 * One answer for all pages: the row is answered (or „Keine Angabe“); a contact topic also goes
 * into the Kontaktdaten with source „antwort“ (manual values win over it only if newer; an
 * answer is a person's value too), into the Firmenprofil's change log.
 */
export async function answerOrgQuestion(
  service: SupabaseClient,
  input: { organisationId: string; id: string; action: "answer" | "no_answer" | "reopen"; answer?: string | null; userId: string },
): Promise<AnswerOrgQuestionResult> {
  const rows = await loadOrgQuestions(service, input.organisationId);
  const row = rows.find((r) => r.id === input.id);
  if (!row) throw Object.assign(new Error("Frage nicht gefunden."), { status: 404 });
  const answer = input.action === "answer" ? (input.answer ?? "").trim().slice(0, 2_000) : null;
  if (input.action === "answer" && !answer) throw Object.assign(new Error("Bitte eine Antwort eingeben oder „Keine Angabe“ wählen."), { status: 400 });
  const patch =
    input.action === "reopen"
      ? { status: "open", answer: null, answered_by: null, answered_at: null }
      : { status: input.action === "answer" ? "answered" : "no_answer", answer, answered_by: input.userId, answered_at: new Date().toISOString() };
  const { error } = await service.from("dt_content_org_questions").update(patch).eq("id", row.id).eq("organisation_id", input.organisationId);
  if (error) throw new Error(`Antwort konnte nicht gespeichert werden: ${error.message}`);

  let contactFields: ContactFieldKey[] = [];
  const fields = input.action === "answer" && answer ? contactFieldsForAnswer(asTopicKey(row.topic_key), answer) : null;
  if (fields) {
    await saveOrgContactData(service, {
      organisationId: input.organisationId,
      userId: input.userId,
      values: { fields },
      source: "antwort",
      note: `Antwort auf „${row.question.slice(0, 200)}“ (Fragen zum Unternehmen, Texte)`,
    });
    contactFields = (Object.keys(fields) as ContactFieldKey[]).filter((k) => (CONTACT_FIELD_KEYS as readonly string[]).includes(k));
  }
  return { row: { ...row, ...(patch as Partial<ContentOrgQuestionRow>) }, contactFields };
}

/** Answers that are no Kontaktdaten field: confirmed facts for every later step („Antworten des Kunden“). */
export function customerAnswersFromPool(rows: readonly ContentPoolQuestion[]): Array<{ question: string; answer: string }> {
  return rows
    // „KUNDE PRÜFT“ is no answer: it goes to the prompts as an open check (`pendingChecksBlock`).
    .filter((r) => r.status === "answered" && r.answer?.trim() && !isKundePrueft(r.answer) && !contactFieldsForAnswer(asTopicKey(r.topic_key), r.answer))
    .map((r) => ({ question: r.question, answer: r.answer!.trim() }));
}
