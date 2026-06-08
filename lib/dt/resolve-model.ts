import type { DtChatMode } from "@/lib/dt/types";

export function resolveDtAnthropicModel(mode: DtChatMode): string {
  if (mode === "seo") {
    return process.env.ANTHROPIC_DT_SEO_MODEL?.trim() || "claude-sonnet-4-6";
  }
  if (mode === "ghost") {
    return process.env.ANTHROPIC_DT_GHOST_MODEL?.trim() || "claude-haiku-4-5-20251001";
  }
  if (mode === "team") {
    return process.env.ANTHROPIC_DT_TEAM_MODEL?.trim() || "claude-haiku-4-5-20251001";
  }
  return process.env.ANTHROPIC_DT_PERSONA_MODEL?.trim() || "claude-haiku-4-5-20251001";
}
