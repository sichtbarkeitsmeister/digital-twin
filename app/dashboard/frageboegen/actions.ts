"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildFragebogenFromOrg } from "@/lib/surveys/build-fragebogen-from-org";
import {
  ANBIETER_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
} from "@/lib/surveys/core-question-templates";
import { loadOrgCrawlContext } from "@/lib/surveys/org-crawl-context";
import { assignSurveyOrganisation } from "@/lib/dt/survey-to-agent-service";

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

const createSchema = z.object({
  organisationId: z.string().uuid(),
  purpose: z.enum(["persona", "anbieter"]),
  wunschkundeLabel: z.string().trim().max(120).optional().nullable(),
  selectedCoreKeys: z.array(z.string().min(1)).min(1),
  includeAiExtras: z.boolean().default(true),
  extraPlacement: z.enum(["start", "end"]).default("end"),
  savePrefills: z.boolean().default(true),
});

export async function createFragebogenFromOrgAction(
  input: z.input<typeof createSchema>,
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

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  let draft;
  try {
    draft = await buildFragebogenFromOrg({
      organisationId: parsed.data.organisationId,
      purpose: parsed.data.purpose,
      wunschkundeLabel: parsed.data.wunschkundeLabel,
      selectedCoreKeys: parsed.data.selectedCoreKeys,
      includeAiExtras: parsed.data.includeAiExtras,
      extraPlacement: parsed.data.extraPlacement,
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Fragebogen konnte nicht erzeugt werden.",
    };
  }

  const service = createServiceClient();
  const { data: org } = await service
    .from("organisations")
    .select("id, name")
    .eq("id", parsed.data.organisationId)
    .maybeSingle();
  if (!org) return { ok: false, message: "Organisation nicht gefunden." };

  // Ensure folder named like the organisation (reuse if present).
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
      title: draft.title,
      description: draft.description,
      visibility: "private",
      slug: null,
      notification_emails: [],
      purpose: draft.purpose,
      definition: draft.definition,
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
  const answers =
    parsed.data.savePrefills && Object.keys(draft.suggestedAnswers).length > 0
      ? draft.suggestedAnswers
      : {};

  if (Object.keys(answers).length > 0 || parsed.data.savePrefills) {
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
    if (!responseError && response?.id) {
      responseId = response.id;
    }
  }

  revalidatePath("/dashboard/surveys");
  revalidatePath("/dashboard/frageboegen");
  revalidatePath(`/dashboard/surveys/${survey.id}/edit`);

  return {
    ok: true,
    message: "Fragebogen erstellt.",
    data: {
      surveyId: survey.id,
      responseId,
      extraCount: draft.extraQuestionTitles.length,
      prefillCount: Object.keys(draft.suggestedAnswers).length,
      crawlPageCount: draft.crawlPageCount,
    },
  };
}
