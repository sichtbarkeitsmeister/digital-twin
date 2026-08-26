"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { surveySchema } from "@/lib/surveys/schema";
import {
  definitionForExistingSurvey,
  parseImportedSurveyJson,
} from "@/lib/surveys/import-survey-json";
import {
  buildDuplicatedSurveyTitle,
  withNewSurveyDefinitionId,
} from "@/lib/surveys/duplicate";
import { createClient } from "@/lib/supabase/server";
import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { canAccessSurveyForDashboard } from "@/lib/surveys/survey-dashboard-access";
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
  purpose: z.enum(["persona", "anbieter", "intern"]).default("persona"),
  definition: z.unknown(),
  organisationId: z.string().uuid().optional().nullable(),
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
        purpose: parsed.data.purpose,
        definition: definitionParsed.data,
      })
      .eq("id", parsed.data.surveyId)
      .is("deleted_at", null);

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
      purpose: parsed.data.purpose,
      definition: definitionParsed.data,
      created_by_user_id: userId,
      ...(parsed.data.organisationId
        ? { organisation_id: parsed.data.organisationId }
        : {}),
    })
    .select("id")
    .single();

  if (error || !data?.id) return { ok: false, message: "Entwurf konnte nicht erstellt werden." };

  revalidatePath("/dashboard/surveys");
  if (parsed.data.organisationId) {
    revalidatePath("/dashboard/frageboegen");
  }
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
    .is("deleted_at", null)
    .single();

  if (getError || !existing) return { ok: false, message: "Umfrage nicht gefunden." };

  const wasPrivate = existing.visibility !== "public";
  const slug = existing.slug ?? (await generateUniqueSlug(supabase, existing.title));
  const publishedAt = existing.published_at ?? new Date().toISOString();

  const { error } = await supabase
    .from("surveys")
    .update({ visibility: "public", slug, published_at: publishedAt })
    .eq("id", existing.id)
    .is("deleted_at", null);

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

const updateSlugSchema = z.object({
  surveyId: z.string().uuid(),
  slug: z
    .string()
    .trim()
    .min(1, "URL-Slug ist erforderlich.")
    .max(64, "URL-Slug darf maximal 64 Zeichen haben.")
    .regex(/^[a-z0-9-]+$/, "URL-Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten."),
});

export async function updateSurveySlugAction(
  input: z.input<typeof updateSlugSchema>,
): Promise<ActionState<{ surveyId: string; slug: string }>> {
  const parsed = updateSlugSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const nextSlug = parsed.data.slug.toLowerCase();

  const { data: existingCollision } = await supabase
    .from("surveys")
    .select("id")
    .eq("slug", nextSlug)
    .neq("id", parsed.data.surveyId)
    .maybeSingle();
  if (existingCollision?.id) {
    return { ok: false, message: "Diese URL ist bereits vergeben." };
  }

  const { data: currentSurvey } = await supabase
    .from("surveys")
    .select("slug")
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  const { error } = await supabase
    .from("surveys")
    .update({ slug: nextSlug })
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null);
  if (error) return { ok: false, message: "URL konnte nicht gespeichert werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
  if (currentSurvey?.slug) revalidatePath(`/s/${currentSurvey.slug}`);
  revalidatePath(`/s/${nextSlug}`);

  return {
    ok: true,
    message: "URL gespeichert.",
    data: { surveyId: parsed.data.surveyId, slug: nextSlug },
  };
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
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null);

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
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const { supabase, userId } = auth;
  const { error } = await supabase
    .from("surveys")
    .update({ deleted_at: new Date().toISOString(), deleted_by_user_id: userId })
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null);
  if (error) return { ok: false, message: "Umfrage konnte nicht gelöscht werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Umfrage gelöscht (archiviert).", data: { surveyId: parsed.data.surveyId } };
}

const restoreSurveySchema = z.object({ surveyId: z.string().uuid() });

export async function restoreSurveyAction(
  input: z.input<typeof restoreSurveySchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = restoreSurveySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { supabase } = auth;
  const { error } = await supabase
    .from("surveys")
    .update({ deleted_at: null, deleted_by_user_id: null })
    .eq("id", parsed.data.surveyId);
  if (error) return { ok: false, message: "Umfrage konnte nicht wiederhergestellt werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
  return { ok: true, message: "Umfrage wiederhergestellt.", data: { surveyId: parsed.data.surveyId } };
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

const updateSurveyFolderSchema = z.object({
  folderId: z.string().uuid(),
  name: z.string().trim().min(1, "Ordnername ist erforderlich.").max(80, "Maximal 80 Zeichen."),
});

export async function updateSurveyFolderAction(
  input: z.input<typeof updateSurveyFolderSchema>,
): Promise<ActionState<{ folderId: string }>> {
  const parsed = updateSurveyFolderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const { data: folder } = await supabase
    .from("survey_folders")
    .select("id,name")
    .eq("id", parsed.data.folderId)
    .maybeSingle();
  if (!folder) return { ok: false, message: "Ordner nicht gefunden." };

  const newName = parsed.data.name;
  if (folder.name.toLowerCase() === newName.toLowerCase()) {
    return { ok: true, message: "Keine Änderung.", data: { folderId: folder.id } };
  }

  const { data: nameConflict } = await supabase
    .from("survey_folders")
    .select("id,name")
    .ilike("name", newName)
    .neq("id", parsed.data.folderId)
    .maybeSingle();
  if (nameConflict?.id) {
    return { ok: false, message: `Ordner „${nameConflict.name}“ existiert bereits.` };
  }

  const { error } = await supabase
    .from("survey_folders")
    .update({ name: newName })
    .eq("id", parsed.data.folderId);
  if (error) return { ok: false, message: "Ordner konnte nicht umbenannt werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Ordner umbenannt.", data: { folderId: parsed.data.folderId } };
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
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null);
  if (error) return { ok: false, message: "Ordner-Zuordnung konnte nicht gespeichert werden." };

  revalidatePath("/dashboard/surveys");
  return { ok: true, message: "Ordner aktualisiert.", data: { surveyId: parsed.data.surveyId } };
}

const updateSurveyMetadataSchema = z.object({
  surveyId: z.string().uuid(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
});

export async function updateSurveyMetadataAction(
  input: z.input<typeof updateSurveyMetadataSchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = updateSurveyMetadataSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const patch: { title?: string; description?: string } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (!("title" in patch) && !("description" in patch)) {
    return { ok: false, message: "Keine Änderungen übergeben." };
  }

  const { error } = await supabase
    .from("surveys")
    .update(patch)
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null);
  if (error) return { ok: false, message: "Metadaten konnten nicht gespeichert werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
  return { ok: true, message: "Metadaten aktualisiert.", data: { surveyId: parsed.data.surveyId } };
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

  // Keep surveys, only remove folder assignment before deleting folder.
  const { error: unassignError } = await supabase
    .from("surveys")
    .update({ folder_id: null })
    .eq("folder_id", parsed.data.folderId);
  if (unassignError) {
    return { ok: false, message: "Ordner-Zuordnung konnte nicht entfernt werden." };
  }

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
    .is("deleted_at", null)
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
  input: { payload: unknown; organisationId?: string | null },
): Promise<ActionState<{ surveyId: string; responseId?: string }>> {
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
      ...(input.organisationId ? { organisation_id: input.organisationId } : {}),
    })
    .select("id")
    .single();
  if (surveyError || !createdSurvey?.id) {
    return { ok: false, message: "Umfrage konnte nicht importiert werden." };
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
      return { ok: false, message: "Antworten konnten nicht importiert werden." };
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
        return { ok: false, message: "Rückfragen konnten nicht importiert werden." };
      }
    }
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${createdSurvey.id}/edit`);
  if (input.organisationId) {
    revalidatePath("/dashboard/frageboegen");
  }
  if (createdResponseId) {
    revalidatePath(`/dashboard/surveys/${createdSurvey.id}/responses/${createdResponseId}`);
  }
  return {
    ok: true,
    message: "Umfrage (inkl. Antworten) importiert.",
    data: { surveyId: createdSurvey.id, responseId: createdResponseId },
  };
}

const rawFilledImportSchema = z.object({
  text: z.string().trim().min(50, "Text ist zu kurz."),
  title: z.string().trim().max(120).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

/**
 * Import a raw filled questionnaire (paste or file text) as a new private survey
 * + completed response. Tries deterministic parsers first, then KI extraction.
 */
export async function importRawFilledQuestionnaireAction(
  input: z.input<typeof rawFilledImportSchema>,
): Promise<ActionState<{ surveyId: string; responseId?: string; fieldCount: number; answeredCount: number }>> {
  const parsed = rawFilledImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const { parseRawFilledQuestionnaire, rawFilledToImportBundle } = await import(
    "@/lib/surveys/raw-filled-questionnaire"
  );

  let converted = parseRawFilledQuestionnaire(parsed.data.text, {
    title: parsed.data.title,
  });

  if (!converted.ok) {
    const { extractFilledQuestionnaireWithAi } = await import(
      "@/lib/surveys/raw-filled-questionnaire-ai"
    );
    const ai = await extractFilledQuestionnaireWithAi({
      text: parsed.data.text,
      title: parsed.data.title,
    });
    if (!ai.ok) {
      return {
        ok: false,
        message: `${converted.message} KI: ${ai.message}`,
      };
    }
    converted = { ok: true, data: ai.data };
  }

  const bundle = rawFilledToImportBundle(converted.data);
  const imported = await importSurveyBundleAction({ payload: bundle });
  if (!imported.ok || !imported.data?.surveyId) {
    return { ok: false, message: imported.message };
  }

  const surveyId = imported.data.surveyId;
  const responseId = imported.data.responseId;

  if (parsed.data.folderId) {
    await auth.supabase
      .from("surveys")
      .update({ folder_id: parsed.data.folderId })
      .eq("id", surveyId);
  }

  if (responseId) {
    revalidatePath(`/dashboard/surveys/${surveyId}/responses/${responseId}`);
  }

  return {
    ok: true,
    message: `Fragebogen mit ${converted.data.answeredCount} Antworten importiert (${converted.data.fieldCount} Fragen).`,
    data: {
      surveyId,
      responseId,
      fieldCount: converted.data.fieldCount,
      answeredCount: converted.data.answeredCount,
    },
  };
}

const rawFilledBatchSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().trim().min(50),
        title: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(30),
  folderId: z.string().uuid().nullable().optional(),
});

/**
 * Import one or more raw filled questionnaires (multi-file / multi-paste).
 * Prefer `/api/surveys/import-raw` from the client for large Word/KI imports
 * (Server Actions are hard-capped around ~120s on Vercel).
 */
export async function importRawFilledQuestionnairesBatchAction(
  input: z.input<typeof rawFilledBatchSchema>,
): Promise<
  ActionState<{
    results: Array<{
      title: string;
      surveyId: string;
      responseId?: string;
      fieldCount: number;
      answeredCount: number;
    }>;
    failed: Array<{ title: string; message: string }>;
  }>
> {
  const parsed = rawFilledBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const { runRawFilledQuestionnairesBatch } = await import(
    "@/lib/surveys/raw-filled-import"
  );
  const result = await runRawFilledQuestionnairesBatch({
    items: parsed.data.items,
    folderId: parsed.data.folderId,
  });

  return {
    ok: result.ok,
    message: result.message,
    data: { results: result.results, failed: result.failed },
  };
}

const replaceQuestionsSchema = z.object({
  surveyId: z.string().uuid(),
  payload: z.unknown(),
});

/** Replace steps/fields of an existing survey from JSON (definition or export bundle). */
export async function replaceSurveyQuestionsFromJsonAction(
  input: z.input<typeof replaceQuestionsSchema>,
): Promise<ActionState<{ surveyId: string; stepCount: number; fieldCount: number }>> {
  const parsed = replaceQuestionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const imported = parseImportedSurveyJson(parsed.data.payload);
  if (!imported.ok) return { ok: false, message: imported.error };

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };
  const { supabase } = auth;

  const { data: existing } = await supabase
    .from("surveys")
    .select("id,title,description,definition")
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return { ok: false, message: "Umfrage nicht gefunden." };

  const existingDef = surveySchema.safeParse(existing.definition);
  const existingDefinitionId = existingDef.success
    ? existingDef.data.id
    : imported.data.definition.id;

  const nextDefinition = definitionForExistingSurvey({
    existingDefinitionId,
    existingTitle: existing.title ?? imported.data.title,
    existingDescription: existing.description ?? imported.data.description,
    imported: imported.data.definition,
  });

  const { error } = await supabase
    .from("surveys")
    .update({ definition: nextDefinition })
    .eq("id", existing.id)
    .is("deleted_at", null);
  if (error) return { ok: false, message: "Fragen konnten nicht ersetzt werden." };

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${existing.id}/edit`);

  const fieldCount = nextDefinition.steps.reduce((n, step) => n + step.fields.length, 0);
  return {
    ok: true,
    message: `Fragen ersetzt: ${nextDefinition.steps.length} Schritte, ${fieldCount} Felder.`,
    data: {
      surveyId: existing.id,
      stepCount: nextDefinition.steps.length,
      fieldCount,
    },
  };
}

const duplicateSurveySchema = z.object({
  surveyId: z.string().uuid(),
  /** When true, copy the first response + field questions (if any). */
  includeAnswers: z.boolean().optional().default(false),
});

export async function duplicateSurveyAction(
  input: z.input<typeof duplicateSurveySchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = duplicateSurveySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };
  const { supabase, userId } = auth;

  const { data: source } = await supabase
    .from("surveys")
    .select(
      "id,title,description,notification_emails,purpose,folder_id,definition",
    )
    .eq("id", parsed.data.surveyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!source?.definition) return { ok: false, message: "Umfrage nicht gefunden." };

  const definitionParsed = surveySchema.safeParse(source.definition);
  if (!definitionParsed.success) {
    return {
      ok: false,
      message: definitionParsed.error.issues[0]?.message ?? "Ungültige Umfrage-Definition.",
    };
  }

  const purpose =
    source.purpose === "anbieter" || source.purpose === "persona" || source.purpose === "intern"
      ? source.purpose
      : "persona";
  const notificationEmails = normalizeEmails(
    ((source.notification_emails ?? []) as string[]).filter(Boolean),
  );

  const { data: createdSurvey, error: surveyError } = await supabase
    .from("surveys")
    .insert({
      title: buildDuplicatedSurveyTitle(source.title ?? "Umfrage"),
      description: source.description ?? "",
      visibility: "private",
      slug: null,
      published_at: null,
      notification_emails: notificationEmails,
      purpose,
      folder_id: source.folder_id ?? null,
      // Do not copy organisation_id — assignment stays explicit on the responses flow.
      definition: withNewSurveyDefinitionId(definitionParsed.data),
      created_by_user_id: userId,
    })
    .select("id")
    .single();

  if (surveyError || !createdSurvey?.id) {
    return { ok: false, message: "Umfrage konnte nicht dupliziert werden." };
  }

  if (parsed.data.includeAnswers) {
    const { data: sourceResponse } = await supabase
      .from("survey_responses")
      .select("id,status,answers,completed_at")
      .eq("survey_id", source.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sourceResponse) {
      const tokenHashHex = `\\x${randomBytes(32).toString("hex")}`;
      const { data: createdResponse, error: responseError } = await supabase
        .from("survey_responses")
        .insert({
          survey_id: createdSurvey.id,
          status: sourceResponse.status,
          answers: sourceResponse.answers ?? {},
          completed_at: sourceResponse.completed_at ?? null,
          token_hash: tokenHashHex,
        })
        .select("id")
        .single();

      if (responseError || !createdResponse?.id) {
        return {
          ok: false,
          message: "Umfrage dupliziert, aber Antworten konnten nicht kopiert werden.",
          data: { surveyId: createdSurvey.id },
        };
      }

      const { data: sourceQuestions } = await supabase
        .from("survey_field_questions")
        .select("field_id,kind,question,asked_at,answer,answered_at")
        .eq("survey_id", source.id)
        .eq("response_id", sourceResponse.id)
        .order("asked_at", { ascending: true });

      if ((sourceQuestions ?? []).length > 0) {
        const rows = (sourceQuestions ?? []).map((q) => ({
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
            message: "Umfrage dupliziert, aber Rückfragen konnten nicht kopiert werden.",
            data: { surveyId: createdSurvey.id },
          };
        }
      }
    }
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath(`/dashboard/surveys/${createdSurvey.id}/edit`);
  return {
    ok: true,
    message: parsed.data.includeAnswers
      ? "Umfrage inkl. Antworten dupliziert."
      : "Umfrage dupliziert.",
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

const assignSurveyOrgSchema = z.object({
  surveyId: z.string().uuid(),
  organisationId: z.string().uuid().nullable(),
});

export async function assignSurveyOrganisationAction(
  input: z.input<typeof assignSurveyOrgSchema>,
): Promise<ActionState<{ surveyId: string }>> {
  const parsed = assignSurveyOrgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  const userId = user?.id;
  if (authError || !userId) {
    return { ok: false, message: "Not authenticated." };
  }

  const platformAdmin = await isPlatformAdmin(supabase, userId);
  if (!platformAdmin) {
    if (!parsed.data.organisationId) {
      return {
        ok: false,
        message: "Nur Plattform-Admins können die Organisations-Zuordnung entfernen.",
      };
    }
    const [canManage, canAccess] = await Promise.all([
      canManageDtAgents(supabase, userId, parsed.data.organisationId),
      canAccessSurveyForDashboard({ userId, surveyId: parsed.data.surveyId }),
    ]);
    if (!canManage || !canAccess) {
      return { ok: false, message: "Forbidden." };
    }
  }

  const { assignSurveyOrganisation } = await import("@/lib/dt/survey-to-agent-service");
  const result = await assignSurveyOrganisation(
    parsed.data.surveyId,
    parsed.data.organisationId,
  );
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/dashboard/surveys");
  revalidatePath("/dashboard/frageboegen");
  revalidatePath("/dashboard/organisations");
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/edit`);
  revalidatePath(`/dashboard/surveys/${parsed.data.surveyId}/responses`);
  return { ok: true, message: result.message, data: { surveyId: parsed.data.surveyId } };
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
          .is("deleted_at", null)
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

