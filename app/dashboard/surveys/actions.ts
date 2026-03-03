"use server";

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
    .select("id,survey_id,response_id,field_id,question")
    .maybeSingle();

  if (error) return { ok: false, message: "Antwort konnte nicht gespeichert werden." };

  try {
    const qRow = updatedQuestion;
    if (qRow && typeof qRow === "object") {
      const surveyId = (qRow as { survey_id?: string }).survey_id;
      const questionText = (qRow as { question?: string }).question ?? "";
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

          const subject = `Admin-Antwort: ${survey?.title ?? "Umfrage"}`;
          const text = [
            `Hallo,`,
            ``,
            `ein Admin hat eine Frage beantwortet.`,
            fieldTitle ? `Feld: ${fieldTitle}` : null,
            fieldDescription ? `Beschreibung: ${fieldDescription}` : null,
            ``,
            `Nutzer-Frage: ${questionText || "—"}`,
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
              intro: "Ein Admin hat eine Frage beantwortet.",
              details: [
                { label: "Umfrage", value: survey?.title ?? "Umfrage" },
                ...(fieldTitle ? [{ label: "Feld", value: fieldTitle }] : []),
                ...(fieldDescription ? [{ label: "Beschreibung", value: fieldDescription }] : []),
                { label: "Nutzer-Frage", value: questionText || "—" },
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

