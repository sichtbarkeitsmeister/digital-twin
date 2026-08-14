"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { assignSurveyOrganisation } from "@/lib/dt/survey-to-agent-service";
import {
  buildFragebogenReviewDraft,
  buildSurveyAndAnswersFromReview,
  type FragebogenReviewDraft,
} from "@/lib/surveys/build-fragebogen-from-org";
import {
  ANBIETER_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
} from "@/lib/surveys/core-question-templates";
import { loadOrgCrawlContext } from "@/lib/surveys/org-crawl-context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionState<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false as const, message: "Nicht angemeldet.", userId: null };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return { ok: false as const, message: "Nur Plattform-Admins.", userId: null };
  }
  return { ok: true as const, message: "ok", userId: user.id, supabase };
}

export async function loadFragebogenWizardContextAction(input: {
  organisationId: string;
}): Promise<
  ActionState<{
    organisationName: string;
    websiteUrl: string | null;
    pageCount: number;
    anbieterCore: Array<{ key: string; title: string; description: string }>;
    personaCore: Array<{ key: string; title: string; description: string }>;
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const crawl = await loadOrgCrawlContext(parsed.data.organisationId);
  return {
    ok: true,
    message: "ok",
    data: {
      organisationName: crawl.organisationName,
      websiteUrl: crawl.websiteUrl,
      pageCount: crawl.pageCount,
      anbieterCore: ANBIETER_CORE_QUESTIONS.map((q) => ({
        key: q.key,
        title: q.title,
        description: q.description,
      })),
      personaCore: PERSONA_CORE_QUESTIONS.map((q) => ({
        key: q.key,
        title: q.title,
        description: q.description,
      })),
    },
  };
}

const previewSchema = z.object({
  organisationId: z.string().uuid(),
  purpose: z.enum(["persona", "anbieter"]),
  wunschkundeLabel: z.string().trim().max(120).optional().nullable(),
  selectedCoreKeys: z.array(z.string().min(1)).min(1),
  includeAiExtras: z.boolean().default(true),
  extraPlacement: z.enum(["start", "end"]).default("end"),
});

export async function previewFragebogenFromOrgAction(
  input: z.input<typeof previewSchema>,
): Promise<ActionState<{ draft: FragebogenReviewDraft }>> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  try {
    const draft = await buildFragebogenReviewDraft({
      organisationId: parsed.data.organisationId,
      purpose: parsed.data.purpose,
      wunschkundeLabel: parsed.data.wunschkundeLabel,
      selectedCoreKeys: parsed.data.selectedCoreKeys,
      includeAiExtras: parsed.data.includeAiExtras,
      extraPlacement: parsed.data.extraPlacement,
    });
    return { ok: true, message: "Entwurf zur Prüfung bereit.", data: { draft } };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Vorschau konnte nicht erzeugt werden.",
    };
  }
}

const reviewQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["core", "extra"]),
  coreKey: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  included: z.boolean(),
  answer: z.string().default(""),
  answerSource: z.enum(["organisation", "website", "crawl", "ai", "none"]),
  answerNote: z.string().default(""),
});

const createFromReviewSchema = z.object({
  organisationId: z.string().uuid(),
  savePrefills: z.boolean().default(true),
  draft: z.object({
    title: z.string().trim().min(1),
    description: z.string().default(""),
    purpose: z.enum(["persona", "anbieter"]),
    extraPlacement: z.enum(["start", "end"]),
    crawlPageCount: z.number().int().nonnegative(),
    websiteUrl: z.string().nullable(),
    organisationName: z.string(),
    questions: z.array(reviewQuestionSchema).min(1),
  }),
});

export async function createFragebogenFromReviewAction(
  input: z.input<typeof createFromReviewSchema>,
): Promise<
  ActionState<{
    surveyId: string;
    responseId?: string;
    extraCount: number;
    prefillCount: number;
    crawlPageCount: number;
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const parsed = createFromReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  let definition;
  let answers: Record<string, string>;
  try {
    const built = buildSurveyAndAnswersFromReview({
      draft: parsed.data.draft,
      savePrefills: parsed.data.savePrefills,
    });
    definition = built.definition;
    answers = built.answers;
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Fragebogen ungültig.",
    };
  }

  const service = createServiceClient();
  const { data: org } = await service
    .from("organisations")
    .select("id, name")
    .eq("id", parsed.data.organisationId)
    .maybeSingle();
  if (!org) return { ok: false, message: "Organisation nicht gefunden." };

  let folderId: string | null = null;
  const { data: existingFolder } = await service
    .from("survey_folders")
    .select("id, name")
    .ilike("name", org.name)
    .maybeSingle();
  if (existingFolder?.id) {
    folderId = existingFolder.id;
  } else {
    const { data: createdFolder } = await service
      .from("survey_folders")
      .insert({ name: org.name, created_by_user_id: auth.userId })
      .select("id")
      .single();
    folderId = createdFolder?.id ?? null;
  }

  const { data: survey, error: surveyError } = await service
    .from("surveys")
    .insert({
      title: parsed.data.draft.title,
      description: parsed.data.draft.description,
      visibility: "private",
      slug: null,
      notification_emails: [],
      purpose: parsed.data.draft.purpose,
      definition,
      organisation_id: parsed.data.organisationId,
      folder_id: folderId,
      created_by_user_id: auth.userId,
    })
    .select("id")
    .single();

  if (surveyError || !survey?.id) {
    return { ok: false, message: "Umfrage konnte nicht gespeichert werden." };
  }

  await assignSurveyOrganisation(survey.id, parsed.data.organisationId);

  let responseId: string | undefined;
  if (Object.keys(answers).length > 0) {
    const tokenHashHex = `\\x${randomBytes(32).toString("hex")}`;
    const { data: response, error: responseError } = await service
      .from("survey_responses")
      .insert({
        survey_id: survey.id,
        status: "in_progress",
        answers,
        token_hash: tokenHashHex,
      })
      .select("id")
      .single();
    if (!responseError && response?.id) responseId = response.id;
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath("/dashboard/frageboegen");
  revalidatePath(`/dashboard/surveys/${survey.id}/edit`);

  const extraCount = parsed.data.draft.questions.filter(
    (q) => q.kind === "extra" && q.included,
  ).length;

  return {
    ok: true,
    message: "Fragebogen erstellt.",
    data: {
      surveyId: survey.id,
      responseId,
      extraCount,
      prefillCount: Object.keys(answers).length,
      crawlPageCount: parsed.data.draft.crawlPageCount,
    },
  };
}
