import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildGroundingPagesPrompt,
  emptyGroundingHubFacts,
} from "@/lib/dt/prompts/grounding-pages-prompt";
import {
  GROUNDING_CONFIG_SELECT,
  parseGroundingEntityPages,
  type GroundingCommand,
  type GroundingConfigRow,
} from "@/lib/dt/seo/grounding-pages";
import { loadWunschkundenKnowledgeForSeo } from "@/lib/dt/seo/wunschkunden-knowledge";

function asCompetitors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

/**
 * Full grounding-page instructions for a chat started from the Grounding tab.
 * Returns null when this chat is a normal conversation.
 * A missing jobs table must not break other chats.
 */
export async function loadGroundingPagesInstructions(
  supabase: SupabaseClient,
  input: { chatId: string; organisationId: string },
): Promise<string | null> {
  const { data: job, error: jobError } = await supabase
    .from("dt_grounding_jobs")
    .select("command")
    .eq("chat_id", input.chatId)
    .maybeSingle();

  if (jobError || !job) return null;
  const command = job.command;
  if (command !== "erstelle" && command !== "pruefe" && command !== "aktualisiere") {
    return null;
  }

  let audienceText: string | null = null;
  try {
    audienceText = await loadWunschkundenKnowledgeForSeo(supabase, input.organisationId);
  } catch (err) {
    console.error(
      "[grounding-pages] zielgruppen:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const [configResult, orgResult, onboardingResult] = await Promise.all([
      supabase
        .from("dt_org_config")
        .select(GROUNDING_CONFIG_SELECT)
        .eq("organisation_id", input.organisationId)
        .maybeSingle(),
      supabase
        .from("organisations")
        .select("slug")
        .eq("id", input.organisationId)
        .maybeSingle(),
      supabase
        .from("dt_org_onboarding")
        .select("competitors")
        .eq("organisation_id", input.organisationId)
        .maybeSingle(),
    ]);

    if (configResult.error) throw new Error(configResult.error.message);
    const row = (configResult.data ?? null) as GroundingConfigRow | null;
    const orgSlug =
      orgResult.data && typeof orgResult.data.slug === "string" ? orgResult.data.slug : null;
    const customerSlug = row?.grounding_customer_slug?.trim() || orgSlug;
    const entities = parseGroundingEntityPages(row?.grounding_entity_pages);

    return buildGroundingPagesPrompt({
      websiteUrl: row?.website_url ?? null,
      customerSlug,
      competitors: asCompetitors(onboardingResult.data?.competitors),
      llmsTxtUrl: row?.grounding_llms_txt_url ?? null,
      hubUrl: row?.grounding_page_url ?? null,
      hub: {
        url: row?.grounding_page_url ?? null,
        uploadedAt: row?.grounding_page_uploaded_at ?? null,
        dateModified: row?.grounding_page_date_modified ?? null,
        lastReviewed: row?.grounding_page_last_reviewed ?? null,
        reviewedBy: row?.grounding_page_reviewed_by ?? null,
        notes: row?.grounding_page_notes ?? null,
        releaseStatus:
          row?.grounding_page_release_status === "draft" ||
          row?.grounding_page_release_status === "released"
            ? row.grounding_page_release_status
            : null,
        standardVersion: row?.grounding_page_standard_version ?? null,
      },
      entities,
      command: command as GroundingCommand,
      explicitRebuild: command === "erstelle",
      audienceText,
    });
  } catch (err) {
    console.error(
      "[grounding-pages] tool context:",
      err instanceof Error ? err.message : err,
    );
    return buildGroundingPagesPrompt({
      websiteUrl: null,
      customerSlug: null,
      competitors: [],
      llmsTxtUrl: null,
      hubUrl: null,
      hub: emptyGroundingHubFacts(),
      entities: [],
      command: command as GroundingCommand,
      explicitRebuild: command === "erstelle",
      audienceText,
      dataWarning:
        "Die gespeicherten Grounding-Daten konnten nicht gelesen werden. Sage das zu Beginn und arbeite nur mit dem, was der Nutzer in diesem Chat liefert.",
    });
  }
}
