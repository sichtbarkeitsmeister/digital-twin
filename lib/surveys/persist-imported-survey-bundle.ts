import "server-only";

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { surveySchema } from "@/lib/surveys/schema";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmails(emails: string[]): string[] {
  return emails.map((e) => e.trim()).filter(Boolean);
}

/**
 * Persist a survey export bundle (definition + optional completed response).
 * Used by JSON import and raw-filled import — avoids calling a Server Action
 * from the long-running `/api/surveys/import-raw` route.
 */
export async function persistImportedSurveyBundle(input: {
  payload: unknown;
  folderId?: string | null;
}): Promise<
  | { ok: true; message: string; surveyId: string; responseId?: string }
  | { ok: false; message: string }
> {
  const parsed = importBundleSchema.safeParse(input.payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Ungültiger Import.",
    };
  }

  const definitionParsed = surveySchema.safeParse(parsed.data.survey.definition);
  if (!definitionParsed.success) {
    return {
      ok: false,
      message:
        definitionParsed.error.issues[0]?.message ??
        "Ungültige Umfrage-Definition.",
    };
  }

  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok || !auth.userId) {
    return { ok: false, message: auth.message };
  }
  const { supabase, userId } = auth;

  const notificationEmails = normalizeEmails(
    parsed.data.survey.notification_emails ?? [],
  );
  const invalid = notificationEmails.find((e) => !isValidEmail(e));
  if (invalid) return { ok: false, message: `Ungültige E-Mail: ${invalid}` };

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
      ...(input.folderId ? { folder_id: input.folderId } : {}),
    })
    .select("id")
    .single();

  if (surveyError || !createdSurvey?.id) {
    return {
      ok: false,
      message: surveyError?.message
        ? `Umfrage konnte nicht importiert werden (${surveyError.message}).`
        : "Umfrage konnte nicht importiert werden.",
    };
  }

  const firstResponse = parsed.data.responses[0];
  let createdResponseId: string | undefined;
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
      return {
        ok: false,
        message: responseError?.message
          ? `Antworten konnten nicht importiert werden (${responseError.message}).`
          : "Antworten konnten nicht importiert werden.",
      };
    }
    createdResponseId = createdResponse.id;

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
        return {
          ok: false,
          message: "Rückfragen konnten nicht importiert werden.",
        };
      }
    }
  }

  return {
    ok: true,
    message: "Umfrage (inkl. Antworten) importiert.",
    surveyId: createdSurvey.id,
    responseId: createdResponseId,
  };
}
