import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  FocusedDtAgentPrompt,
  FocusedDtAgentSurveyFacts,
  KnownDtAgentSnapshot,
} from "@/lib/ai/chat-context";
import { loadAgentSurveyFactsBundle } from "@/lib/dt/agent-survey-coverage";

const EXCERPT_LEN = 420;
const MAX_KNOWN_AGENTS = 40;
const MAX_FOCUSED_PROMPT_CHARS = 24_000;
const MAX_FACTS_CHECKLIST_CHARS = 28_000;

function excerpt(text: string | null | undefined, max = EXCERPT_LEN): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function clip(text: string | null | undefined, max = MAX_FOCUSED_PROMPT_CHARS): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[gekürzt]`;
}

type AgentRow = {
  id: string;
  organisation_id: string;
  name: string;
  role: string | null;
  slug: string;
  kind: string;
  uses_global_prompt: boolean | null;
  prompt_template: string | null;
  prompt_append: string | null;
  source_survey_id: string | null;
  source_survey_response_id: string | null;
};

const AGENT_SELECT =
  "id,organisation_id,name,role,slug,kind,uses_global_prompt,prompt_template,prompt_append,source_survey_id,source_survey_response_id";

/**
 * Load DigitalTwin agents for the Survey KI assistant context.
 * Prefer the active organisation; otherwise agents linked to known surveys.
 * Focused agents with survey lineage also get filled questionnaire answers.
 */
export async function loadDtAgentsForSurveyAssistant(input: {
  supabase: SupabaseClient;
  organisationId?: string | null;
  agentId?: string | null;
  surveyOrganisationIds?: string[];
  userMessage?: string;
}): Promise<{
  knownAgents: KnownDtAgentSnapshot[];
  focusedAgentPrompts: FocusedDtAgentPrompt[];
  focusedAgentSurveyFacts: FocusedDtAgentSurveyFacts[];
}> {
  const orgIds = new Set<string>();
  if (input.organisationId) orgIds.add(input.organisationId);
  for (const id of input.surveyOrganisationIds ?? []) {
    if (id) orgIds.add(id);
  }

  let query = input.supabase
    .from("dt_agents")
    .select(AGENT_SELECT)
    .neq("kind", "seo_advisor")
    .order("name", { ascending: true })
    .limit(MAX_KNOWN_AGENTS);

  if (orgIds.size > 0) {
    query = query.in("organisation_id", Array.from(orgIds));
  }

  const { data: rows } = await query;
  let agents = (rows ?? []) as AgentRow[];

  // If no org filter yielded nothing, fall back to a small global sample (platform admin).
  if (agents.length === 0 && orgIds.size === 0) {
    const { data: fallback } = await input.supabase
      .from("dt_agents")
      .select(AGENT_SELECT)
      .neq("kind", "seo_advisor")
      .order("updated_at", { ascending: false })
      .limit(MAX_KNOWN_AGENTS);
    agents = (fallback ?? []) as AgentRow[];
  }

  const orgNameById = new Map<string, string>();
  const uniqueOrgIds = Array.from(new Set(agents.map((a) => a.organisation_id)));
  if (uniqueOrgIds.length > 0) {
    const { data: orgs } = await input.supabase
      .from("organisations")
      .select("id,name")
      .in("id", uniqueOrgIds);
    for (const o of orgs ?? []) {
      orgNameById.set(o.id, o.name);
    }
  }

  const knownAgents: KnownDtAgentSnapshot[] = agents.map((a) => ({
    id: a.id,
    organisationId: a.organisation_id,
    organisationName: orgNameById.get(a.organisation_id) ?? null,
    name: a.name,
    role: a.role,
    slug: a.slug,
    kind: a.kind,
    usesGlobalPrompt: Boolean(a.uses_global_prompt),
    promptExcerpt: excerpt(a.prompt_template),
    appendExcerpt: a.prompt_append?.trim() ? excerpt(a.prompt_append) : null,
    sourceSurveyId: a.source_survey_id,
    sourceSurveyResponseId: a.source_survey_response_id,
  }));

  const focusedIds = new Set<string>();
  if (input.agentId) focusedIds.add(input.agentId);

  const msg = (input.userMessage ?? "").toLowerCase();
  if (msg.trim()) {
    for (const a of agents) {
      const name = a.name.toLowerCase();
      const slug = a.slug.toLowerCase();
      if (
        (name.length >= 3 && msg.includes(name)) ||
        (slug.length >= 3 && msg.includes(slug))
      ) {
        focusedIds.add(a.id);
      }
    }
  }

  // Cap focused full prompts.
  const focusedAgents = agents.filter((a) => focusedIds.has(a.id)).slice(0, 3);
  const focusedAgentPrompts: FocusedDtAgentPrompt[] = focusedAgents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    slug: a.slug,
    usesGlobalPrompt: Boolean(a.uses_global_prompt),
    promptTemplate: clip(a.prompt_template),
    promptAppend: a.prompt_append?.trim() ? clip(a.prompt_append) : null,
    sourceSurveyId: a.source_survey_id,
    sourceSurveyResponseId: a.source_survey_response_id,
  }));

  const focusedAgentSurveyFacts: FocusedDtAgentSurveyFacts[] = [];
  for (const a of focusedAgents) {
    if (!a.source_survey_id || !a.source_survey_response_id) continue;
    const loaded = await loadAgentSurveyFactsBundle(
      a.source_survey_id,
      a.source_survey_response_id,
    );
    if (!loaded.ok) continue;
    focusedAgentSurveyFacts.push({
      agentId: a.id,
      agentName: a.name,
      surveyId: loaded.bundle.surveyId,
      responseId: loaded.bundle.responseId,
      surveyTitle: loaded.bundle.surveyTitle,
      factCount: loaded.bundle.facts.length,
      factsChecklist: clip(loaded.bundle.factsChecklist, MAX_FACTS_CHECKLIST_CHARS),
    });
  }

  return { knownAgents, focusedAgentPrompts, focusedAgentSurveyFacts };
}
