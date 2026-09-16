/**
 * Opening an agent editor writes `?agent=` into the URL. Closing it
 * (`Abbrechen` / Speichern) clears `editingId` immediately, but
 * `router.replace` updates `searchParams` one tick later. The deep-link
 * effect must not reopen the editor from the stale query in between.
 */
export function shouldOpenAgentEditorFromQuery(params: {
  agentIdInUrl: string | null;
  editingId: string | null;
  ignoreStaleAgentQuery: boolean;
}): boolean {
  if (!params.agentIdInUrl) return false;
  if (params.ignoreStaleAgentQuery) return false;
  if (params.editingId === params.agentIdInUrl) return false;
  return true;
}
