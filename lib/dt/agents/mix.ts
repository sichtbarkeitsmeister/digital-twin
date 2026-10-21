/**
 * The Mix: one avatar per organisation that stands for several of its Zielgruppen avatars at
 * once (Agenten → „Mix-Agent erstellen“). It is an ordinary enabled persona row in `dt_agents`
 * (name „Mix“, slug `mix`, on the global DigitalTwin prompt), so the chat and every avatar
 * dropdown offer it; `avatar_data.mix` records which avatars it was built from and when.
 *
 * Pure and client-safe. The generator lives in `mix-generator.ts`.
 */

import { isDefaultTwinAgent, isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import { isProspectPersonaKind } from "@/lib/dt/prompts/prospect-persona-kind";

export const MIX_AGENT_SLUG = "mix";
export const MIX_AGENT_NAME = "Mix";
export const MIX_SOURCES_MIN = 2;
export const MIX_SOURCES_MAX = 30;

/** `avatar_data.mix` of the Mix row. */
export type MixInfo = {
  sourceAgentIds: string[];
  sourceNames: string[];
  generatedAt: string;
};

type MixRowLike = { slug?: string | null; avatar_data?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** `avatar_data.mix`, or null when the row carries none. */
export function readMixInfo(avatarData: unknown): MixInfo | null {
  const mix = asRecord(asRecord(avatarData)?.mix);
  if (!mix) return null;
  return {
    sourceAgentIds: stringList(mix.sourceAgentIds),
    sourceNames: stringList(mix.sourceNames),
    generatedAt: typeof mix.generatedAt === "string" ? mix.generatedAt : "",
  };
}

/** The organisation's Mix: slug `mix`, or a row that carries `avatar_data.mix`. */
export function isMixAgent(row: MixRowLike): boolean {
  return row.slug === MIX_AGENT_SLUG || readMixInfo(row.avatar_data) !== null;
}

/** The Mix among an organisation's agents (the row with slug `mix` first), or null. */
export function findMixAgent<T extends MixRowLike>(agents: readonly T[]): T | null {
  return agents.find((agent) => agent.slug === MIX_AGENT_SLUG) ?? agents.find(isMixAgent) ?? null;
}

/** Role of the Mix: „Mix aus {N} Zielgruppen“. */
export function mixRole(count: number): string {
  return `Mix aus ${count} Zielgruppen`;
}

/** How the avatar dropdowns of Texte, SEO, GEO and Hormozi list the Mix. */
export function mixOptionLabel(count: number): string {
  return `Mix (aus ${count} Zielgruppen)`;
}

export type MixCandidateRow = MixRowLike & {
  kind?: string | null;
  is_enabled?: boolean | null;
  is_default?: boolean | null;
};

/** A Zielgruppen avatar: a persona or Wunschkunde that is neither the default twin nor an SEO advisor. */
export function isZielgruppenAvatar(agent: MixCandidateRow): boolean {
  return (
    isProspectPersonaKind(agent.kind, agent.slug) &&
    !agent.is_default &&
    !isDefaultTwinAgent(agent) &&
    !isSeoAdvisorAgent(agent)
  );
}

/** What a Mix can be built from: the enabled Zielgruppen avatars except the Mix, in list order. */
export function mixSourceCandidates<T extends MixCandidateRow>(agents: readonly T[]): T[] {
  return agents.filter((agent) => agent.is_enabled !== false && isZielgruppenAvatar(agent) && !isMixAgent(agent));
}

function toMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a source avatar was deleted, or changed (`updated_at`) after the Mix was generated.
 * `agents` are all agents of the organisation.
 */
export function isMixOutdated(
  mix: MixInfo,
  agents: ReadonlyArray<{ id: string; updated_at?: string | null }>,
): boolean {
  const generatedAt = toMillis(mix.generatedAt);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return mix.sourceAgentIds.some((id) => {
    const agent = byId.get(id);
    if (!agent) return true;
    const updatedAt = toMillis(agent.updated_at);
    return generatedAt !== null && updatedAt !== null && updatedAt > generatedAt;
  });
}

/**
 * The avatar a dropdown preselects: the newest Zielgruppen avatar. The Mix is listed first but
 * only chosen by hand; it is the default only while it is the sole avatar.
 */
export function defaultAvatarOptionId(options: ReadonlyArray<{ id: string; isMix?: boolean }>): string | null {
  return (options.find((option) => !option.isMix) ?? options[0])?.id ?? null;
}
