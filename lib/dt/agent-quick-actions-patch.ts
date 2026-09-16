/**
 * Org owners may persist Schnelltests (quick_actions) without a full
 * agent-edit request. Prompt and other fields stay staff-only.
 */

export type AgentPatchFields = {
  name?: unknown;
  role?: unknown;
  promptTemplate?: unknown;
  promptAppend?: unknown;
  usesGlobalPrompt?: unknown;
  quickActions?: unknown;
  isEnabled?: unknown;
  position?: unknown;
  sourceSurveyId?: unknown;
  sourceSurveyResponseId?: unknown;
};

export function definedAgentPatchKeys(patch: AgentPatchFields): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

export function isQuickActionsOnlyPatch(patch: AgentPatchFields): boolean {
  const keys = definedAgentPatchKeys(patch);
  return keys.length === 1 && keys[0] === "quickActions";
}

export function canApplyAgentPatch(input: {
  isPlatformAdmin: boolean;
  canManageOrg: boolean;
  patch: AgentPatchFields;
}): { ok: true } | { ok: false; message: string } {
  if (input.isPlatformAdmin) return { ok: true };
  if (input.canManageOrg && isQuickActionsOnlyPatch(input.patch)) return { ok: true };
  if (input.canManageOrg) {
    return {
      ok: false,
      message:
        "Nur Schnelltests lassen sich direkt speichern. Andere Agent-Änderungen bitte als Anfrage senden.",
    };
  }
  return {
    ok: false,
    message:
      "Direkte Bearbeitung ist nur für Administratoren möglich. Bitte eine Änderungsanfrage senden.",
  };
}
