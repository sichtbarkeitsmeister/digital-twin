"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { ensureOrganisationSurveyFolder } from "@/lib/dt/ensure-organisation-survey-folder";
import { assignSurveyOrganisation } from "@/lib/dt/survey-to-agent-service";
import {
  buildFragebogenReviewDraft,
  buildSurveyAndAnswersFromReview,
  type FragebogenReviewDraft,
} from "@/lib/surveys/build-fragebogen-from-org";
import {
  ANBIETER_CORE_QUESTIONS,
  INTERN_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
} from "@/lib/surveys/core-question-templates";
import { loadOrgCrawlContext } from "@/lib/surveys/org-crawl-context";
import {
  extractImpressumFacts,
  extractServiceLabels,
} from "@/lib/surveys/org-crawl-prefill";
import {
  firstConversationFilledCount,
  firstConversationHasContent,
  firstConversationSummaryLines,
} from "@/lib/surveys/first-conversation";
import { loadFirstConversation } from "@/lib/surveys/first-conversation-store";
import { mergeAudienceVocab, type ClientAudienceVocab } from "@/lib/surveys/client-audience";
import { resolveAudienceVocabSuggestion } from "@/lib/surveys/suggest-audience-vocab-ai";
import {
  loadOrgCrawlStatusSnapshot,
  startOrganisationSiteCrawl,
  type OrgCrawlProgress,
} from "@/lib/dt/seo/start-org-crawl";
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
    lastCrawledAt: string | null;
    lastCrawlError: string | null;
    activeCrawl: OrgCrawlProgress | null;
    seoSummary: string | null;
    firstConversation: {
      hasContent: boolean;
      filled: number;
      total: number;
      summaryLines: string[];
      wunschkundeLabel: string;
      updatedAt: string | null;
    };
    anbieterCore: Array<{
      key: string;
      title: string;
      description: string;
      stepTitle: string;
    }>;
    personaCore: Array<{
      key: string;
      title: string;
      description: string;
      stepTitle: string;
    }>;
    internCore: Array<{
      key: string;
      title: string;
      description: string;
      stepTitle: string;
    }>;
    extractedServices: string[];
    impressum: {
      legalName: string | null;
      address: string | null;
      ownerName: string | null;
    };
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const [crawl, status, conversation] = await Promise.all([
    loadOrgCrawlContext(parsed.data.organisationId),
    loadOrgCrawlStatusSnapshot(parsed.data.organisationId),
    loadFirstConversation(parsed.data.organisationId),
  ]);
  const counts = firstConversationFilledCount(conversation.record);

  return {
    ok: true,
    message: "ok",
    data: {
      organisationName: crawl.organisationName,
      websiteUrl: crawl.websiteUrl ?? status.websiteUrl,
      pageCount: crawl.pageCount,
      lastCrawledAt: status.lastCrawledAt,
      lastCrawlError: status.lastCrawlError,
      activeCrawl: status.crawl,
      seoSummary: crawl.seoMetrics
        ? `Impressionen ${crawl.seoMetrics.impressions} · Klicks ${crawl.seoMetrics.totalClicks} · Top-10 ${crawl.seoMetrics.rankingsTop10}`
        : null,
      firstConversation: {
        hasContent: firstConversationHasContent(conversation.record),
        filled: counts.filled,
        total: counts.total,
        summaryLines: firstConversationSummaryLines(conversation.record),
        wunschkundeLabel: conversation.record.wunschkundeLabel,
        updatedAt: conversation.updatedAt,
      },
      anbieterCore: ANBIETER_CORE_QUESTIONS.map((q) => ({
        key: q.key,
        title: q.title,
        description: q.description,
        stepTitle: q.stepTitle,
      })),
      personaCore: PERSONA_CORE_QUESTIONS.map((q) => ({
        key: q.key,
        title: q.title,
        description: q.description,
        stepTitle: q.stepTitle,
      })),
      internCore: INTERN_CORE_QUESTIONS.map((q) => ({
        key: q.key,
        title: q.title,
        description: q.description,
        stepTitle: q.stepTitle,
      })),
      extractedServices: extractServiceLabels(crawl),
      impressum: extractImpressumFacts(
        [
          crawl.summaryText,
          ...crawl.pageExcerpts.map((page) => `${page.title ?? ""}\n${page.text}`),
        ].join("\n"),
      ),
    },
  };
}

export async function requestFragebogenCrawlAction(input: {
  organisationId: string;
}): Promise<
  ActionState<{
    crawlId: string;
    reused: boolean;
    status: string;
    pageCount: number;
    activeCrawl: OrgCrawlProgress | null;
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const started = await startOrganisationSiteCrawl({
    organisationId: parsed.data.organisationId,
    userId: auth.userId,
  });
  if (!started.ok) return { ok: false, message: started.message };

  const status = await loadOrgCrawlStatusSnapshot(parsed.data.organisationId);
  return {
    ok: true,
    message: started.message,
    data: {
      crawlId: started.crawlId,
      reused: started.reused,
      status: started.status,
      pageCount: status.pageCount,
      activeCrawl: status.crawl,
    },
  };
}

export async function loadFragebogenCrawlStatusAction(input: {
  organisationId: string;
}): Promise<
  ActionState<{
    pageCount: number;
    websiteUrl: string | null;
    lastCrawledAt: string | null;
    lastCrawlError: string | null;
    activeCrawl: OrgCrawlProgress | null;
  }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const status = await loadOrgCrawlStatusSnapshot(parsed.data.organisationId);
  return {
    ok: true,
    message: "ok",
    data: {
      pageCount: status.pageCount,
      websiteUrl: status.websiteUrl,
      lastCrawledAt: status.lastCrawledAt,
      lastCrawlError: status.lastCrawlError,
      activeCrawl: status.crawl,
    },
  };
}

const meetingBriefingSchema = z
  .object({
    legalCompanyName: z.string().trim().max(200).optional().nullable(),
    ownerName: z.string().trim().max(200).optional().nullable(),
    competitors: z.string().trim().max(4000).optional().nullable(),
    goodCompetitors: z.string().trim().max(4000).optional().nullable(),
    pagesOrLinks: z.string().trim().max(4000).optional().nullable(),
    notes: z.string().trim().max(8000).optional().nullable(),
    focus: z.string().trim().max(2000).optional().nullable(),
    services: z.string().trim().max(2000).optional().nullable(),
    usp: z.string().trim().max(2000).optional().nullable(),
    region: z.string().trim().max(500).optional().nullable(),
    targetGroup: z.string().trim().max(2000).optional().nullable(),
    employeeCount: z.string().trim().max(120).optional().nullable(),
    website: z.string().trim().max(500).optional().nullable(),
  })
  .optional()
  .nullable();

const audienceKindSchema = z.enum(["kanzlei", "praxis", "handwerk", "unternehmen"]);
const nounGenderSchema = z.enum(["m", "f", "n"]);
const wordSchema = z.string().trim().min(1).max(40);
const audienceVocabSchema = z.object({
  kind: audienceKindSchema,
  label: z.string().trim().min(1).max(80).optional(),
  hint: z.string().trim().max(240).optional(),
  business: wordSchema,
  businessPlural: wordSchema,
  businessGender: nounGenderSchema,
  singular: wordSchema,
  plural: wordSchema,
  engagement: wordSchema,
  engagementPlural: wordSchema,
  engagementGender: nounGenderSchema,
  project: wordSchema,
  projectPlural: wordSchema,
  projectGender: nounGenderSchema,
  booking: wordSchema,
  bookingPlural: wordSchema,
  bookingGender: nounGenderSchema,
});

const previewSchema = z.object({
  organisationId: z.string().uuid(),
  purpose: z.enum(["persona", "anbieter", "intern"]),
  clientAudience: audienceKindSchema,
  audienceVocab: audienceVocabSchema.optional(),
  wunschkundeLabel: z.string().trim().max(120).optional().nullable(),
  selectedCoreKeys: z.array(z.string().min(1)).min(1),
  includeAiExtras: z.boolean().default(true),
  extraPlacement: z.enum(["start", "end"]).default("end"),
  meetingBriefing: meetingBriefingSchema,
  sourceDocuments: z
    .array(
      z.object({
        name: z.string().trim().max(200),
        text: z.string().trim().min(20).max(40_000),
      }),
    )
    .max(8)
    .optional()
    .default([]),
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
  if (parsed.data.purpose === "intern") {
    return {
      ok: false,
      message: "Interne Recherche-Fragebögen (TEIL C) werden derzeit nicht angelegt.",
    };
  }
  if (parsed.data.purpose === "persona") {
    const label = parsed.data.wunschkundeLabel?.trim() ?? "";
    if (label.length < 3) {
      return {
        ok: false,
        message:
          "Bitte angeben, welche Zielgruppe dieser Persona-Fragebogen beschreibt — z. B. Privatpatient mit Vorsorge oder Laser-Interessent.",
      };
    }
  }

  try {
    const draft = await buildFragebogenReviewDraft({
      organisationId: parsed.data.organisationId,
      purpose: parsed.data.purpose,
      clientAudience: parsed.data.clientAudience,
      audienceVocab: mergeAudienceVocab(
        parsed.data.clientAudience,
        parsed.data.audienceVocab,
      ),
      wunschkundeLabel: parsed.data.wunschkundeLabel,
      selectedCoreKeys: parsed.data.selectedCoreKeys,
      includeAiExtras: parsed.data.includeAiExtras,
      extraPlacement: parsed.data.extraPlacement,
      meetingBriefing: parsed.data.meetingBriefing,
      sourceDocuments: parsed.data.sourceDocuments,
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
  title: z.string(),
  description: z.string().default(""),
  included: z.boolean(),
  required: z.boolean().default(true),
  type: z
    .enum(["text", "text_list", "radio", "checkbox", "rating", "ranking"])
    .default("text"),
  options: z
    .array(z.object({ id: z.string().min(1), label: z.string() }))
    .default([]),
  allowOtherOption: z.boolean().optional(),
  allowExtraEntries: z.boolean().optional(),
  allowCustomEntries: z.boolean().optional(),
  addEntryLabel: z.string().optional(),
  scaleMin: z.number().int().optional(),
  scaleMax: z.number().int().optional(),
  answer: z.string().default(""),
  answerSource: z.enum(["organisation", "website", "crawl", "ai", "meeting", "upload", "none"]),
  answerNote: z.string().default(""),
});

const createFromReviewSchema = z.object({
  organisationId: z.string().uuid(),
  savePrefills: z.boolean().default(true),
  draft: z.object({
    title: z.string().trim().min(1),
    description: z.string().default(""),
    purpose: z.enum(["persona", "anbieter", "intern"]),
    extraPlacement: z.enum(["start", "end"]),
    crawlPageCount: z.number().int().nonnegative(),
    websiteUrl: z.string().nullable(),
    organisationName: z.string(),
    clientAudience: audienceKindSchema.optional(),
    audienceVocab: audienceVocabSchema.optional(),
    definitionId: z.string().uuid().optional(),
    questions: z.array(reviewQuestionSchema).min(1),
    aiWarning: z.string().nullable().optional(),
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
  if (parsed.data.draft.purpose === "intern") {
    return {
      ok: false,
      message: "Interne Recherche-Fragebögen (TEIL C) werden derzeit nicht angelegt.",
    };
  }

  let definition;
  let answers: Record<string, unknown>;
  try {
    const built = buildSurveyAndAnswersFromReview({
      draft: {
        ...parsed.data.draft,
        audienceVocab: parsed.data.draft.audienceVocab
          ? mergeAudienceVocab(
              parsed.data.draft.audienceVocab.kind,
              parsed.data.draft.audienceVocab,
            )
          : undefined,
      },
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
    .select("id")
    .eq("id", parsed.data.organisationId)
    .maybeSingle();
  if (!org) return { ok: false, message: "Organisation nicht gefunden." };

  const folder = await ensureOrganisationSurveyFolder({
    organisationId: parsed.data.organisationId,
    createdByUserId: auth.userId,
  });
  const folderId = folder.ok ? folder.folderId : null;

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

const suggestAudienceSchema = z.object({
  industry: z.string().trim().max(120).optional().nullable(),
  organisationName: z.string().trim().max(200).optional().nullable(),
  services: z.array(z.string().trim().max(80)).max(20).optional(),
});

export async function suggestFragebogenAudienceVocabAction(
  input: z.input<typeof suggestAudienceSchema>,
): Promise<
  ActionState<{ vocab: ClientAudienceVocab; source: "heuristic" | "ai"; note: string }>
> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const parsed = suggestAudienceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const industry = parsed.data.industry?.trim() || "";
  const organisationName = parsed.data.organisationName?.trim() || "";
  const services = parsed.data.services ?? [];
  if (!industry && !organisationName && services.length === 0) {
    return {
      ok: false,
      message: "Bitte Branche eintippen — oder Organisation mit Namen/Leistungen wählen.",
    };
  }

  const suggestion = await resolveAudienceVocabSuggestion({
    industry,
    organisationName,
    services,
  });
  return {
    ok: true,
    message: suggestion.note,
    data: {
      vocab: suggestion.vocab,
      source: suggestion.source,
      note: suggestion.note,
    },
  };
}

export async function ensureOrganisationSurveyFolderAction(input: {
  organisationId: string;
}): Promise<ActionState<{ folderId: string; folderName: string; created: boolean }>> {
  const auth = await requirePlatformAdmin();
  if (!auth.ok || !auth.userId) return { ok: false, message: auth.message };

  const parsed = z.object({ organisationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Organisation." };

  const folder = await ensureOrganisationSurveyFolder({
    organisationId: parsed.data.organisationId,
    createdByUserId: auth.userId,
  });
  if (!folder.ok) return { ok: false, message: folder.message };

  revalidatePath("/dashboard/frageboegen");
  revalidatePath("/dashboard/surveys");
  return {
    ok: true,
    message: folder.created
      ? `Fragebogen-Ordner „${folder.folderName}“ wurde angelegt.`
      : `Fragebogen-Ordner „${folder.folderName}“ war bereits vorhanden.`,
    data: {
      folderId: folder.folderId,
      folderName: folder.folderName,
      created: folder.created,
    },
  };
}
