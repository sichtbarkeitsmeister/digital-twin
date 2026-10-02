import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureSeoAdvisorAgent } from "@/lib/dt/seo/ensure-seo-agent";
import { mergeMarkedBlock } from "@/lib/dt/transcripts/apply-knowledge";
import {
  TRANSCRIPT_ANBIETER_END,
  TRANSCRIPT_ANBIETER_START,
} from "@/lib/dt/transcripts/types";
import { resolveTranscriptReading } from "@/lib/dt/transcripts/markdown-file";
import {
  WORKSHOP_CORPUS_END,
  WORKSHOP_CORPUS_START,
  type AnbieterState,
  type AvatarPlanState,
  type WorkshopAvatar,
  type WorkshopSource,
  buildCurrentAnbieterMarkdown,
  corpusFingerprint,
  emptyAnbieterState,
  emptyAvatarPlan,
  forgetMissingAvatarAgents,
  readAnbieterState,
  readAvatarPlan,
} from "@/lib/dt/transcripts/workshop-model";

const SOURCE_SELECT =
  "id,title,filename,source_kind,spoken_on,created_at,updated_at,summary,raw_text";

type SourceRow = {
  id: string;
  title: string | null;
  filename: string | null;
  source_kind: string | null;
  spoken_on: string | null;
  created_at: string;
  updated_at: string;
  summary: string | null;
  raw_text: string;
};

function sourceFromRow(row: SourceRow): WorkshopSource {
  const reading = resolveTranscriptReading({
    filename: row.filename,
    sourceKind: row.source_kind,
    summary: row.summary,
    rawText: row.raw_text,
  });
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    sourceKind: reading.sourceKind,
    spokenOn: row.spoken_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: reading.summary,
    rawText: row.raw_text ?? "",
  };
}

export async function loadWorkshopSources(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<WorkshopSource[]> {
  const { data, error } = await supabase
    .from("dt_meeting_transcripts")
    .select(SOURCE_SELECT)
    .eq("organisation_id", organisationId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SourceRow[]).map(sourceFromRow);
}

export async function loadWorkshopState(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<{ fingerprint: string; sources: WorkshopSource[]; anbieter: AnbieterState; avatarPlan: AvatarPlanState }> {
  const sources = await loadWorkshopSources(supabase, organisationId);
  const fingerprint = corpusFingerprint(sources);
  const { data, error } = await supabase
    .from("dt_workshop_corpus")
    .select("anbieter,avatar_plan")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    fingerprint,
    sources,
    anbieter: data ? readAnbieterState(data.anbieter, fingerprint) : emptyAnbieterState(),
    avatarPlan: data ? readAvatarPlan(data.avatar_plan, fingerprint) : emptyAvatarPlan(),
  };
}

async function saveCorpus(
  supabase: SupabaseClient,
  organisationId: string,
  patch: { anbieter?: AnbieterState; avatarPlan?: AvatarPlanState },
): Promise<void> {
  const current = await loadWorkshopState(supabase, organisationId);
  const anbieter = patch.anbieter ?? current.anbieter;
  const avatarPlan = patch.avatarPlan ?? current.avatarPlan;
  const { error } = await supabase.from("dt_workshop_corpus").upsert(
    {
      organisation_id: organisationId,
      anbieter,
      avatar_plan: avatarPlan,
    },
    { onConflict: "organisation_id" },
  );
  if (error) throw new Error(error.message);
}

export async function saveAnbieterState(
  supabase: SupabaseClient,
  organisationId: string,
  anbieter: AnbieterState,
): Promise<void> {
  await saveCorpus(supabase, organisationId, { anbieter });
}

export async function reconcileAvatarAgents(
  supabase: SupabaseClient,
  organisationId: string,
  plan: AvatarPlanState,
): Promise<AvatarPlanState> {
  const ids = [
    ...new Set(
      plan.avatars
        .map((avatar) => avatar.agentId)
        .filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id))),
    ),
  ];
  let live = new Set<string>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("dt_agents")
      .select("id")
      .eq("organisation_id", organisationId)
      .in("id", ids);
    if (error) return plan;
    live = new Set((data ?? []).map((row) => String(row.id)));
  }
  const next = forgetMissingAvatarAgents(plan, live);
  if (next === plan) return plan;
  await saveAvatarPlan(supabase, organisationId, next);
  return next;
}

export async function saveAvatarPlan(
  supabase: SupabaseClient,
  organisationId: string,
  avatarPlan: AvatarPlanState,
): Promise<void> {
  await saveCorpus(supabase, organisationId, { avatarPlan });
}

export function replaceAvatar(
  plan: AvatarPlanState,
  key: string,
  next: WorkshopAvatar,
): AvatarPlanState {
  return {
    ...plan,
    avatars: plan.avatars.map((avatar) => (avatar.key === key ? next : avatar)),
  };
}

export async function syncAnbieterToSeoAdvisor(input: {
  supabase: SupabaseClient;
  organisationId: string;
  organisationName: string;
  anbieter: AnbieterState;
}): Promise<{ agentId: string | null; error: string | null }> {
  const ensured = await ensureSeoAdvisorAgent(input.supabase, input.organisationId);
  if (!ensured.agentId) return ensured;

  const { data: seoAgent, error: loadError } = await input.supabase
    .from("dt_agents")
    .select("id,prompt_append")
    .eq("id", ensured.agentId)
    .maybeSingle();
  if (loadError || !seoAgent) {
    return { agentId: null, error: loadError?.message ?? "SEO-Berater nicht gefunden." };
  }

  const body = buildCurrentAnbieterMarkdown({
    organisationName: input.organisationName,
    items: input.anbieter.items,
  });
  const withCorpus = mergeMarkedBlock(
    seoAgent.prompt_append,
    WORKSHOP_CORPUS_START,
    WORKSHOP_CORPUS_END,
    body,
    "## Anbieter-Wissen (Workshops, aktueller Stand)",
  );
  const withoutPerTranscript = mergeMarkedBlock(
    withCorpus,
    TRANSCRIPT_ANBIETER_START,
    TRANSCRIPT_ANBIETER_END,
    "",
    "## Anbieter-Wissen (Meeting-Transkripte)",
  );

  const { error } = await input.supabase.rpc("dt_update_agent", {
    p_agent_id: seoAgent.id,
    p_patch: { prompt_append: withoutPerTranscript },
  });
  if (error) return { agentId: null, error: error.message };
  return { agentId: seoAgent.id, error: null };
}
