import { isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import type { DtChatMode } from "@/lib/dt/types";

/**
 * Agent and chat-mode rules for the chat shell.
 *
 * Kept outside the component so the SEO workspace rules stay testable:
 * the SEO area offers every agent. Twin chats are created as mode=default
 * and appear in the SEO sidebar via the seo_workspace list filter.
 */
export type DtSelectableAgent = {
  id: string;
  slug?: string | null;
  kind?: string | null;
};

export function pickSeoAdvisorAgentId(agents: DtSelectableAgent[]): string | null {
  return agents.find((agent) => isSeoAdvisorAgent(agent))?.id ?? null;
}

export function resolveDefaultAgentId(
  agents: DtSelectableAgent[],
  options: { seoMode?: boolean; currentId?: string },
): string {
  if (agents.length === 0) return "";

  // Keep an explicit, still-valid selection (e.g. a digital twin after "Neuer Chat").
  if (options.currentId && agents.some((agent) => agent.id === options.currentId)) {
    return options.currentId;
  }

  // SEO workspace starts on the SEO advisor when nothing is selected yet.
  if (options.seoMode) {
    return pickSeoAdvisorAgentId(agents) ?? agents[0]!.id;
  }

  // Never fall back onto the SEO advisor outside the SEO workspace.
  const nonSeo = agents.find((agent) => !isSeoAdvisorAgent(agent));
  return nonSeo?.id ?? agents[0]!.id;
}

/**
 * Only SEO advisor conversations become SEO chats. A digital twin picked inside
 * the SEO workspace starts a regular DigitalTwin chat, so the SEO list stays free
 * of persona chats.
 */
export function resolveChatModeForCreate(input: {
  seoMode?: boolean;
  teamScope?: boolean;
  agent: DtSelectableAgent | null;
}): DtChatMode {
  if (input.seoMode) {
    return input.agent && isSeoAdvisorAgent(input.agent) ? "seo" : "default";
  }
  return input.teamScope ? "team" : "default";
}

/**
 * Switching the selected agent must not reassign an existing chat.
 * Each persona keeps its own conversations; open a fresh draft instead.
 */
export function shouldStartNewChatOnAgentSwitch(input: {
  seoMode?: boolean;
  hasActiveChat: boolean;
  activeChatMode?: DtChatMode | null;
  targetAgent: DtSelectableAgent;
}): boolean {
  void input.seoMode;
  void input.activeChatMode;
  void input.targetAgent;
  return input.hasActiveChat;
}

/** The last-chat pointer is stored per area, based on the chat's own mode. */
export function isSeoModeChat(mode: DtChatMode | null | undefined): boolean {
  return mode === "seo";
}
