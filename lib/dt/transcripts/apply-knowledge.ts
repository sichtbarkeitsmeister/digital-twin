import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureSeoAdvisorAgent } from "@/lib/dt/seo/ensure-seo-agent";
import { ensureAvatarGlobalPromptAnchor } from "@/lib/dt/prompts/avatar-global-prompt-anchor";
import { isProspectPersonaKind } from "@/lib/dt/prompts/build-system-prompt";
import {
  normalizePersonaKey,
  slugFromPersonaName,
} from "@/lib/dt/transcripts/sanitize";
import {
  TRANSCRIPT_ANBIETER_END,
  TRANSCRIPT_ANBIETER_START,
  TRANSCRIPT_PERSONA_END,
  TRANSCRIPT_PERSONA_START,
  type DtTranscriptExtract,
  type DtTranscriptPersonaExtract,
} from "@/lib/dt/transcripts/types";

export function mergeMarkedBlock(
  existing: string | null | undefined,
  start: string,
  end: string,
  inner: string,
  heading: string,
): string {
  const body = inner.trim();
  if (!body) {
    const current = (existing ?? "").trim();
    const s = current.indexOf(start);
    const e = current.indexOf(end);
    if (s >= 0 && e > s) {
      const before = current.slice(0, s).trimEnd();
      const after = current.slice(e + end.length).trimStart();
      return [before, after].filter(Boolean).join("\n\n").trim();
    }
    return current;
  }
  const block = [start, heading, "", body, end].join("\n");
  const current = (existing ?? "").trim();
  if (!current) return block;
  const s = current.indexOf(start);
  const e = current.indexOf(end);
  if (s >= 0 && e > s) {
    const before = current.slice(0, s).trimEnd();
    const after = current.slice(e + end.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n").trim();
  }
  return `${current}\n\n${block}`.trim();
}

export function buildAggregatedAnbieterMarkdown(
  items: Array<{ title: string | null; filename: string | null; anbieterMarkdown: string }>,
): string {
  const parts = items
    .map((item) => {
      const md = item.anbieterMarkdown.trim();
      if (!md) return "";
      const label = item.title?.trim() || item.filename?.trim() || "Interview";
      return `### ${label}\n\n${md}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return "";
  return [
    "Die folgenden Angaben stammen aus Kundeninterviews (Transkripte), nicht aus dem Fragebogen.",
    "Nutze sie als verbindliche Unternehmensfakten, wenn das Gespräch konkreter ist als andere Quellen.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

function personaBlock(persona: DtTranscriptPersonaExtract): string {
  return [
    `## ${persona.name}${persona.role ? ` (${persona.role})` : ""}`,
    `Priorität: ${persona.priority}-Kunde/Mandat${persona.isPrimary ? " · primärer Wunschkunde" : ""}`,
    "",
    persona.description,
    persona.goals ? `Ziele: ${persona.goals}` : "",
    persona.pains ? `Probleme: ${persona.pains}` : "",
    persona.objections ? `Einwände: ${persona.objections}` : "",
    persona.language ? `Sprache: ${persona.language}` : "",
    persona.buyingTriggers ? `Kaufanlässe: ${persona.buyingTriggers}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type AgentRow = {
  id: string;
  name: string;
  slug: string | null;
  kind: string;
  prompt_append: string | null;
  organisation_id: string;
};

export type TranscriptPersonaMatchAgent = {
  name: string;
  slug: string | null;
  kind: string;
};

function findMatchingAgent<T extends { name: string; slug: string | null }>(
  agents: T[],
  persona: DtTranscriptPersonaExtract,
): T | null {
  const key = normalizePersonaKey(persona.name);
  const slug = slugFromPersonaName(persona.name);
  const exactSlug = agents.find((a) => (a.slug ?? "") === slug);
  if (exactSlug) return exactSlug;
  return agents.find((a) => normalizePersonaKey(a.name) === key) ?? null;
}

/** Personas from an extract that do not already exist as a Wunschkunde/Persona agent. */
export function personasAwaitingConfirmation(
  personas: DtTranscriptPersonaExtract[],
  agents: TranscriptPersonaMatchAgent[],
): DtTranscriptPersonaExtract[] {
  const prospect = agents.filter((agent) => isProspectPersonaKind(agent.kind, agent.slug));
  return personas.filter((persona) => !findMatchingAgent(prospect, persona));
}

export async function applyTranscriptExtractToOrg(input: {
  supabase: SupabaseClient;
  organisationId: string;
  extract: DtTranscriptExtract;
}): Promise<{
  seoAgentId: string | null;
  updatedPersonaIds: string[];
  pendingPersonas: DtTranscriptPersonaExtract[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const pendingPersonas: DtTranscriptPersonaExtract[] = [];
  const updatedPersonaIds: string[] = [];

  const { data: processed } = await input.supabase
    .from("dt_meeting_transcripts")
    .select("title,filename,anbieter_markdown,status")
    .eq("organisation_id", input.organisationId)
    .eq("status", "processed");

  const aggregated = buildAggregatedAnbieterMarkdown(
    (processed ?? []).map((row) => ({
      title: typeof row.title === "string" ? row.title : null,
      filename: typeof row.filename === "string" ? row.filename : null,
      anbieterMarkdown:
        typeof row.anbieter_markdown === "string" ? row.anbieter_markdown : "",
    })),
  );

  let seoAgentId: string | null = null;
  if (aggregated.trim()) {
    const ensured = await ensureSeoAdvisorAgent(input.supabase, input.organisationId);
    if (!ensured.agentId) {
      warnings.push(ensured.error ?? "SEO-Berater konnte nicht angelegt werden.");
    } else {
      seoAgentId = ensured.agentId;
    }
  } else {
    const { data: existingSeo } = await input.supabase
      .from("dt_agents")
      .select("id")
      .eq("organisation_id", input.organisationId)
      .eq("kind", "seo_advisor")
      .limit(1)
      .maybeSingle();
    seoAgentId = existingSeo?.id ?? null;
  }

  if (seoAgentId) {
    const { data: seoAgent } = await input.supabase
      .from("dt_agents")
      .select("id, prompt_append")
      .eq("id", seoAgentId)
      .maybeSingle();
    if (seoAgent) {
      const nextAppend = mergeMarkedBlock(
        seoAgent.prompt_append,
        TRANSCRIPT_ANBIETER_START,
        TRANSCRIPT_ANBIETER_END,
        aggregated,
        "## Anbieter-Wissen (Meeting-Transkripte)",
      );
      const { error } = await input.supabase.rpc("dt_update_agent", {
        p_agent_id: seoAgent.id,
        p_patch: { prompt_append: nextAppend },
      });
      if (error) warnings.push(`Anbieterwissen: ${error.message}`);
    }
  }

  const { data: agentRows } = await input.supabase
    .from("dt_agents")
    .select("id,name,slug,kind,prompt_append,organisation_id")
    .eq("organisation_id", input.organisationId);

  const prospectAgents = ((agentRows ?? []) as AgentRow[]).filter((a) =>
    isProspectPersonaKind(a.kind, a.slug),
  );

  for (const persona of input.extract.personas) {
    const match = findMatchingAgent(prospectAgents, persona);
    const inner = personaBlock(persona);
    if (match) {
      const nextAppend = mergeMarkedBlock(
        match.prompt_append,
        TRANSCRIPT_PERSONA_START,
        TRANSCRIPT_PERSONA_END,
        inner,
        "## Aus Kundeninterviews",
      );
      const { error } = await input.supabase.rpc("dt_update_agent", {
        p_agent_id: match.id,
        p_patch: { prompt_append: nextAppend },
      });
      if (error) warnings.push(`${persona.name}: ${error.message}`);
      else updatedPersonaIds.push(match.id);
      continue;
    }

    pendingPersonas.push(persona);
  }

  return { seoAgentId, updatedPersonaIds, pendingPersonas, warnings };
}

/**
 * Creates persona agents only for names the user confirmed.
 * Names that already exist as agents are skipped.
 */
export async function createConfirmedTranscriptPersonas(input: {
  supabase: SupabaseClient;
  organisationId: string;
  personas: DtTranscriptPersonaExtract[];
  names: string[];
}): Promise<{ createdPersonaIds: string[]; createdNames: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const createdPersonaIds: string[] = [];
  const createdNames: string[] = [];
  const wanted = new Set(input.names.map((name) => normalizePersonaKey(name)).filter(Boolean));
  if (wanted.size === 0) {
    return { createdPersonaIds, createdNames, warnings };
  }

  const { data: agentRows } = await input.supabase
    .from("dt_agents")
    .select("id,name,slug,kind,prompt_append,organisation_id")
    .eq("organisation_id", input.organisationId);

  const allAgents = (agentRows ?? []) as AgentRow[];
  const prospectAgents = allAgents.filter((agent) =>
    isProspectPersonaKind(agent.kind, agent.slug),
  );
  const usedSlugs = new Set(
    allAgents.map((agent) => agent.slug).filter((slug): slug is string => Boolean(slug)),
  );

  for (const persona of input.personas) {
    if (!wanted.has(normalizePersonaKey(persona.name))) continue;
    if (findMatchingAgent(prospectAgents, persona)) {
      warnings.push(`${persona.name}: existiert bereits und wurde nicht erneut angelegt.`);
      continue;
    }

    const inner = personaBlock(persona);
    const append = ensureAvatarGlobalPromptAnchor(persona.promptAppend.trim() || inner);
    if (append.length < 220) {
      warnings.push(`${persona.name}: zu wenig Text für einen neuen Avatar.`);
      continue;
    }

    let slug = slugFromPersonaName(persona.name);
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${slugFromPersonaName(persona.name).slice(0, 36)}_${n}`;
      n += 1;
    }
    usedSlugs.add(slug);

    const { data: created, error } = await input.supabase.rpc("dt_create_persona_agent", {
      p_organisation_id: input.organisationId,
      p_payload: {
        slug,
        name: persona.name,
        role: persona.role,
        prompt_template: `Avatar: ${persona.name}`,
        prompt_append: append,
        uses_global_prompt: true,
        avatar_data: {
          source: "transcript",
          priority: persona.priority,
          is_primary: persona.isPrimary,
        },
        quick_actions: [],
      },
    });
    if (error) {
      warnings.push(`${persona.name}: ${error.message}`);
      continue;
    }
    const id = typeof created === "string" ? created : null;
    if (!id) {
      warnings.push(`${persona.name}: konnte nicht angelegt werden.`);
      continue;
    }
    createdPersonaIds.push(id);
    createdNames.push(persona.name);
    prospectAgents.push({
      id,
      name: persona.name,
      slug,
      kind: "persona",
      prompt_append: append,
      organisation_id: input.organisationId,
    });
  }

  return { createdPersonaIds, createdNames, warnings };
}
