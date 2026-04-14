"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { surveySchema } from "@/lib/surveys/schema";
import { createClient } from "@/lib/supabase/server";
import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import { renderBrandedEmail } from "@/lib/email/templates";
import { getFieldMetaFromSurveyDefinition } from "@/lib/surveys/utils";

export type ActionState<T = unknown> = {
  ok: boolean;
  message: string;
  data?: T;
};

export type SurveyExportBundle = {
  version: 1;
  exported_at: string;
  survey: {
    id: string;
    title: string;
    description: string;
    visibility: "private" | "public";
    slug: string | null;
    notification_emails: string[];
    definition: unknown;
    created_at: string | null;
    updated_at: string | null;
    published_at: string | null;
  };
  responses: Array<{
    id: string;
    status: "in_progress" | "completed";
    answers: unknown;
    created_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
  }>;
  fieldQuestions: Array<{
    id: string;
    response_id: string;
    field_id: string;
    kind: "question" | "remark";
    question: string;
    asked_at: string | null;
    answer: string | null;
    answered_at: string | null;
  }>;
};

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const userId = user?.id;
  if (authError || !userId) {
    return { ok: false as const, message: "Not authenticated.", supabase, userId: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isPlatformAdmin = profile?.role === "admin";
  if (!isPlatformAdmin) {
    return { ok: false as const, message: "Forbidden.", supabase, userId: null };
  }

  return { ok: true as const, message: "ok", supabase, userId };
}

function slugifyTitle(input: string) {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || "survey";
}

async function generateUniqueSlug(supabase: Awaited<ReturnType<typeof createClient>>, title: string) {
  const base = slugifyTitle(title);
  const { data } = await supabase.from("surveys").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug).filter(Boolean) as string[]);

  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Extremely unlikely; last resort.
  return `${base}-${Date.now()}`;
}

const upsertDraftSchema = z.object({
  surveyId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().default(""),
  notificationEmails: z.array(z.string().trim()).default([]),
  definition: z.unknown(),
});

function normalizeEmails(input: string[]) {
  const cleaned = input
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique;
}

function isValidEmail(v: string) {
  // Intentionally basic; avoids blocking valid corporate addresses.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function upsertSurveyDraftAction(
  input: z.input<typeof upsertDraftSchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = upsertDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const definitionParsed = surveySchema.safeParse(parsed.data.definition);
  if (!definitionParsed.success) {
    return { ok: false, message: definitionParsed.error.issues[0]?.message ?? "Invalid survey." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const { supabase, userId } = auth;

  const notificationEmails = normalizeEmails(parsed.data.notificationEmails);
  const invalid = notificationEmails.find((e) => !isValidEmail(e));
  if (invalid) return { ok: false, message: `Ungültige E-Mail: ${invalid}` };

  if (parsed.data.surveyId) {
    const { error } = await supabase
      .from("surveys")
      .update({
        title: parsed.data.title,
        description: parsed.data.description,
        notification_emails: notificationEmails,
        definition: definitionParsed.data,
      })
      .eq("id", parsed.data.surveyId);

    if (error) return { ok: false, message: "Entwurf konnte nicht gespeichert werden." };

    revalidatePath("/dashboard/surveys");
    revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
    return { ok: true, message: "Entwurf gespeichert.", data: { surveyId: parsed.data.surveyId } };
  }

  const { data, error } = await supabase
    .from("surveys")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      visibility: "private",
      slug: null,
      notification_emails: notificationEmails,
      definition: definitionParsed.data,
      created_by_user_id: userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) return { ok: false, message: "Entwurf konnte nicht erstellt werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Entwurf erstellt.", data: { surveyId: data.id } };
}

const publishSchema = z.object({ surveyId: z.string().uuid() });

export async function publishSurveyAction(
  input: z.input<typeof publishSchema>,
): Promise<ActionState<{ surveyId: string; slug: string }>> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { supabase } = auth;
  const { data: existing, error: getError } = await supabase
    .from("surveys")
    .select("id,title,slug,published_at,visibility,notification_emails")
    .eq("id", parsed.data.surveyId)
    .single();

  if (getError || !existing) return { ok: false, message: "Umfrage nicht gefunden." };

  const wasPrivate = existing.visibility !== "public";
  const slug = existing.slug ?? (await generateUniqueSlug(supabase, existing.title));
  const publishedAt = existing.published_at ?? new Date().toISOString();

  const { error } = await supabase
    .from("surveys")
    .update({ visibility: "public", slug, published_at: publishedAt })
    .eq("id", existing.id);

  if (error) return { ok: false, message: "Umfrage konnte nicht veröffentlicht werden." };

  if (wasPrivate) {
    try {
      const recipients = (existing.notification_emails ?? []).filter(Boolean) as string[];
      const baseUrl = getAppBaseUrl();
      const link = `${baseUrl}/s/${slug}`;

      await sendEmail({
        to: recipients,
        subject: `Umfrage: ${existing.title}`,
        text: `Hallo,\n\nbitte fülle die Umfrage aus:\n${link}\n\nDanke!`,
        html: renderBrandedEmail({
          title: `Umfrage: ${existing.title}`,
          headline: "Neue Umfrage verfügbar",
          intro: "Bitte fülle die Umfrage aus.",
          details: [{ label: "Umfrage", value: existing.title }],
          actions: [{ label: "Umfrage öffnen", href: link }],
          preheader: `Umfrage: ${existing.title}`,
        }),
      });
    } catch (e) {
      // Non-blocking: publishing should still succeed even if SMTP fails.
      console.error("Failed to send publish notification email", e);
    }
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${existing.id}/edit`);
  revalidatePath(`/s/${slug}`);
  return { ok: true, message: "Umfrage veröffentlicht.", data: { surveyId: existing.id, slug } };
}

const unpublishSchema = z.object({ surveyId: z.string().uuid() });

export async function unpublishSurveyAction(
  input: z.input<typeof unpublishSchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = unpublishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { supabase } = auth;

  const { error } = await supabase
    .from("surveys")
    .update({ visibility: "private" })
    .eq("id", parsed.data.surveyId);

  if (error) return { ok: false, message: "Umfrage konnte nicht privat gemacht werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
  return { ok: true, message: "Umfrage ist jetzt privat.", data: { surveyId: parsed.data.surveyId } };
}

const deleteSurveySchema = z.object({ surveyId: z.string().uuid() });

export async function deleteSurveyAction(
  input: z.input<typeof deleteSurveySchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = deleteSurveySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { supabase } = auth;
  const { error } = await supabase.from("surveys").delete().eq("id", parsed.data.surveyId);
  if (error) return { ok: false, message: "Umfrage konnte nicht gelöscht werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Umfrage gelöscht.", data: { surveyId: parsed.data.surveyId } };
}

const createSurveyFolderSchema = z.object({
  name: z.string().trim().min(1, "Ordnername ist erforderlich.").max(80, "Maximal 80 Zeichen."),
});

export async function createSurveyFolderAction(
  input: z.input<typeof createSurveyFolderSchema>,
): Promise<ActionState<{ folderId: string }>> {
  const parsed = createSurveyFolderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };
  const { supabase, userId } = auth;

  const folderName = parsed.data.name;
  const { data: existing } = await supabase
    .from("survey_folders")
    .select("id,name")
    .ilike("name", folderName)
    .maybeSingle();
  if (existing?.id) {
    return { ok: false, message: `Ordner „${existing.name}“ existiert bereits.` };
  }

  const { data, error } = await supabase
    .from("survey_folders")
    .insert({
      name: folderName,
      created_by_user_id: userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) return { ok: false, message: "Ordner konnte nicht erstellt werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Ordner erstellt.", data: { folderId: data.id } };
}

const assignSurveyFolderSchema = z.object({
  surveyId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
});

export async function assignSurveyFolderAction(
  input: z.input<typeof assignSurveyFolderSchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = assignSurveyFolderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  if (parsed.data.folderId) {
    const { data: folderExists } = await supabase
      .from("survey_folders")
      .select("id")
      .eq("id", parsed.data.folderId)
      .maybeSingle();
    if (!folderExists) return { ok: false, message: "Ordner nicht gefunden." };
  }

  const { error } = await supabase
    .from("surveys")
    .update({ folder_id: parsed.data.folderId })
    .eq("id", parsed.data.surveyId);
  if (error) return { ok: false, message: "Ordner-Zuordnung konnte nicht gespeichert werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Ordner aktualisiert.", data: { surveyId: parsed.data.surveyId } };
}

const deleteSurveyFolderSchema = z.object({ folderId: z.string().uuid() });

export async function deleteSurveyFolderAction(
  input: z.input<typeof deleteSurveyFolderSchema>,
): Promise<ActionState<{ folderId: string }>> {
  const parsed = deleteSurveyFolderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const { error } = await supabase.from("survey_folders").delete().eq("id", parsed.data.folderId);
  if (error) return { ok: false, message: "Ordner konnte nicht gelöscht werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Ordner gelöscht.", data: { folderId: parsed.data.folderId } };
}

const exportSurveySchema = z.object({ surveyId: z.string().uuid() });

export async function exportSurveyBundleAction(
  input: z.input<typeof exportSurveySchema>,
): Promise<ActionState<SurveyExportBundle>> {
  const parsed = exportSurveySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const { data: survey } = await supabase
    .from("surveys")
    .select("id,title,description,visibility,slug,notification_emails,definition,created_at,updated_at,published_at")
    .eq("id", parsed.data.surveyId)
    .maybeSingle();
  if (!survey) return { ok: false, message: "Umfrage nicht gefunden." };

  const { data: responses } = await supabase
    .from("survey_responses")
    .select("id,status,answers,created_at,updated_at,completed_at")
    .eq("survey_id", parsed.data.surveyId)
    .order("created_at", { ascending: true });

  const { data: fieldQuestions } = await supabase
    .from("survey_field_questions")
    .select("id,response_id,field_id,kind,question,asked_at,answer,answered_at")
    .eq("survey_id", parsed.data.surveyId)
    .order("asked_at", { ascending: true });

  return {
    ok: true,
    message: "Export erstellt.",
    data: {
      version: 1,
      exported_at: new Date().toISOString(),
      survey: {
        id: survey.id,
        title: survey.title,
        description: survey.description ?? "",
        visibility: survey.visibility,
        slug: survey.slug ?? null,
        notification_emails: (survey.notification_emails ?? []) as string[],
        definition: survey.definition,
        created_at: survey.created_at ?? null,
        updated_at: survey.updated_at ?? null,
        published_at: survey.published_at ?? null,
      },
      responses: ((responses ?? []) as SurveyExportBundle["responses"]) ?? [],
      fieldQuestions:
        ((fieldQuestions ?? []) as SurveyExportBundle["fieldQuestions"]) ?? [],
    },
  };
}

const importResponseSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["in_progress", "completed"]),
  answers: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
});

const importQuestionSchema = z.object({
  id: z.string().optional(),
  response_id: z.string().optional(),
  field_id: z.string().min(1),
  kind: z.enum(["question", "remark"]).optional().default("question"),
  question: z.string().min(1),
  asked_at: z.string().nullable().optional(),
  answer: z.string().nullable().optional(),
  answered_at: z.string().nullable().optional(),
});

const importBundleSchema = z.object({
  version: z.literal(1),
  survey: z.object({
    title: z.string().trim().min(1, "Title is required"),
    description: z.string().optional().default(""),
    notification_emails: z.array(z.string()).optional().default([]),
    definition: z.unknown(),
  }),
  responses: z.array(importResponseSchema).optional().default([]),
  fieldQuestions: z.array(importQuestionSchema).optional().default([]),
});

export async function importSurveyBundleAction(
  input: { payload: unknown },
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = importBundleSchema.safeParse(input.payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültiger Import." };
  }

  const definitionParsed = surveySchema.safeParse(parsed.data.survey.definition);
  if (!definitionParsed.success) {
    return { ok: false, message: definitionParsed.error.issues[0]?.message ?? "Ungültige Umfrage-Definition." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };
  const { supabase, userId } = auth;

  const notificationEmails = normalizeEmails(parsed.data.survey.notification_emails);
  const invalid = notificationEmails.find((e) => !isValidEmail(e));
  if (invalid) return { ok: false, message: `Ungültige E-Mail: ${invalid}` };

  // Import into a private draft to avoid accidental public overwrite/collision.
  const { data: createdSurvey, error: surveyError } = await supabase
    .from("surveys")
    .insert({
      title: parsed.data.survey.title,
      description: parsed.data.survey.description ?? "",
      visibility: "private",
      slug: null,
      published_at: null,
      notification_emails: notificationEmails,
      definition: definitionParsed.data,
      created_by_user_id: userId,
    })
    .select("id")
    .single();
  if (surveyError || !createdSurvey?.id) {
    return { ok: false, message: "Umfrage konnte nicht importiert werden." };
  }

  const firstResponse = parsed.data.responses[0];
  if (firstResponse) {
    const tokenHashHex = `\\x${randomBytes(32).toString("hex")}`;
    const { data: createdResponse, error: responseError } = await supabase
      .from("survey_responses")
      .insert({
        survey_id: createdSurvey.id,
        status: firstResponse.status,
        answers: firstResponse.answers ?? {},
        completed_at: firstResponse.completed_at ?? null,
        token_hash: tokenHashHex,
      })
      .select("id")
      .single();

    if (responseError || !createdResponse?.id) {
      return { ok: false, message: "Antworten konnten nicht importiert werden." };
    }

    const sourceResponseId = firstResponse.id;
    const importQuestions = parsed.data.fieldQuestions.filter((q) =>
      sourceResponseId ? q.response_id === sourceResponseId : true,
    );

    if (importQuestions.length > 0) {
      const rows = importQuestions.map((q) => ({
        survey_id: createdSurvey.id,
        response_id: createdResponse.id,
        field_id: q.field_id,
        kind: q.kind ?? "question",
        question: q.question,
        asked_at: q.asked_at ?? undefined,
        answer: q.answer ?? null,
        answered_at: q.answered_at ?? null,
      }));
      const { error: questionError } = await supabase
        .from("survey_field_questions")
        .insert(rows);
      if (questionError) {
        return { ok: false, message: "Rückfragen konnten nicht importiert werden." };
      }
    }
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${createdSurvey.id}/edit`);
  return {
    ok: true,
    message: "Umfrage (inkl. Antworten) importiert.",
    data: { surveyId: createdSurvey.id },
  };
}

const reopenResponseSchema = z.object({
  surveyId: z.string().uuid(),
  responseId: z.string().uuid(),
});

export async function reopenSurveyResponseAction(
  input: z.input<typeof reopenResponseSchema>,
): Promise<ActionState<{ responseId: string }>> {
  const parsed = reopenResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { supabase } = auth;
  const { error } = await supabase
    .from("survey_responses")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", parsed.data.responseId)
    .eq("survey_id", parsed.data.surveyId);

  if (error) return { ok: false, message: "Status konnte nicht zurückgesetzt werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/responses/${parsed.data.responseId}`);
  return { ok: true, message: "Status zurückgesetzt.", data: { responseId: parsed.data.responseId } };
}

const answerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().trim().min(1, "Answer is required"),
});

export async function answerSurveyFieldQuestionAction(
  input: z.input<typeof answerSchema>,
): Promise<ActionState<{ questionId: string }>> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const { supabase, userId } = auth;

  const { data: updatedQuestion, error } = await supabase
    .from("survey_field_questions")
    .update({
      answer: parsed.data.answer,
      answered_at: new Date().toISOString(),
      answered_by_user_id: userId,
    })
    .eq("id", parsed.data.questionId)
    .eq("kind", "question")
    .select("id,survey_id,response_id,field_id,kind,question")
    .maybeSingle();

  if (error) return { ok: false, message: "Antwort konnte nicht gespeichert werden." };
  if (!updatedQuestion) {
    return { ok: false, message: "Bemerkungen sind nur informativ und müssen nicht beantwortet werden." };
  }

  try {
    const qRow = updatedQuestion;
    if (qRow && typeof qRow === "object") {
      const surveyId = (qRow as { survey_id?: string }).survey_id;
      const questionText = (qRow as { question?: string }).question ?? "";
      const questionKind = (qRow as { kind?: string }).kind === "remark" ? "remark" : "question";
      const fieldId = (qRow as { field_id?: string }).field_id ?? "";

      if (surveyId) {
        const { data: survey } = await supabase
          .from("surveys")
          .select("title,slug,notification_emails,definition")
          .eq("id", surveyId)
          .maybeSingle();

        const recipients = ((survey?.notification_emails ?? []) as string[]).filter(Boolean);
        if (recipients.length > 0) {
          const baseUrl = getAppBaseUrl();
          const publicLink = survey?.slug ? `${baseUrl}/s/${survey.slug}` : null;

          const fieldMeta = getFieldMetaFromSurveyDefinition(survey?.definition, fieldId);
          const fieldTitle = fieldMeta?.title?.trim() || fieldId || "—";
          const fieldDescription = fieldMeta?.description?.trim() || "";

          const kindLabel = questionKind === "remark" ? "Bemerkung" : "Frage";
          const subject = `Admin-Antwort: ${survey?.title ?? "Umfrage"}`;
          const text = [
            `Hallo,`,
            ``,
            `ein Admin hat eine ${kindLabel.toLowerCase()} beantwortet.`,
            fieldTitle ? `Feld: ${fieldTitle}` : null,
            fieldDescription ? `Beschreibung: ${fieldDescription}` : null,
            ``,
            `Nutzer-${kindLabel}: ${questionText || "—"}`,
            ``,
            `Admin-Antwort: ${parsed.data.answer}`,
            ``,
            publicLink ? `Öffentliche Umfrage: ${publicLink}` : null,
          ]
            .filter(Boolean)
            .join("\n");

          const html = `
            ${renderBrandedEmail({
              title: subject,
              headline: "Admin-Antwort",
              intro: `Ein Admin hat eine ${kindLabel.toLowerCase()} beantwortet.`,
              details: [
                { label: "Umfrage", value: survey?.title ?? "Umfrage" },
                ...(fieldTitle ? [{ label: "Feld", value: fieldTitle }] : []),
                ...(fieldDescription ? [{ label: "Beschreibung", value: fieldDescription }] : []),
                { label: `Nutzer-${kindLabel}`, value: questionText || "—" },
                { label: "Admin-Antwort", value: parsed.data.answer },
              ],
              actions: [
                ...(publicLink ? [{ label: "Öffentliche Umfrage öffnen", href: publicLink }] : []),
              ],
              preheader: subject,
            })}
          `;

          await sendEmail({ to: recipients, subject, text, html });
        }
      }
    }
  } catch (e) {
    console.error("Failed to send admin reply notification email", e);
  }

  // Response detail pages are nested; revalidate broadly.
  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Antwort gespeichert.", data: { questionId: parsed.data.questionId } };
}

