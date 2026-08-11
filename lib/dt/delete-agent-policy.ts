/** Only the SEO-Berater itself is undeletable (not geo_advisor / personas). */
export function isProtectedSeoAdvisorAgent(agent: {
  slug?: string | null;
  kind?: string | null;
}): boolean {
  return agent.slug === "seo_advisor" || agent.kind === "seo_advisor";
}

export function deleteDtAgentErrorCode(error: string | null | undefined):
  | "seo_advisor_protected"
  | "default_agent_protected"
  | "last_enabled_agent"
  | "agent_has_chats"
  | "agent_not_found"
  | "forbidden"
  | "unknown" {
  const msg = error ?? "";
  if (msg.includes("seo_advisor_protected")) return "seo_advisor_protected";
  if (msg.includes("default_agent_protected")) return "default_agent_protected";
  if (msg.includes("last_enabled_agent")) return "last_enabled_agent";
  if (msg.includes("agent_has_chats")) return "agent_has_chats";
  if (msg.includes("agent_not_found")) return "agent_not_found";
  if (msg.includes("forbidden") || msg.includes("not_authenticated")) return "forbidden";
  return "unknown";
}

export function deleteDtAgentUserMessage(code: ReturnType<typeof deleteDtAgentErrorCode>): string {
  switch (code) {
    case "seo_advisor_protected":
    case "default_agent_protected":
      return "Der SEO-Berater kann nicht entfernt werden.";
    case "last_enabled_agent":
      return "Mindestens ein aktiver Agent muss in der Organisation bleiben.";
    case "agent_has_chats":
      return "Agent hat noch Chats — bitte zuerst die Chats dieses Agenten löschen.";
    case "agent_not_found":
      return "Agent nicht gefunden.";
    case "forbidden":
      return "Keine Berechtigung.";
    default:
      return "Agent konnte nicht gelöscht werden.";
  }
}
