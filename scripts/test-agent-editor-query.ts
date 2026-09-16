/**
 * Closing the Schnelltests editor must not reopen from a stale ?agent= query.
 * Run: npx tsx scripts/test-agent-editor-query.ts
 */
import assert from "node:assert/strict";

import { shouldOpenAgentEditorFromQuery } from "../lib/dt/agents/agent-editor-query";

assert.equal(
  shouldOpenAgentEditorFromQuery({
    agentIdInUrl: "agent-1",
    editingId: null,
    ignoreStaleAgentQuery: false,
  }),
  true,
  "deep link opens the editor",
);

assert.equal(
  shouldOpenAgentEditorFromQuery({
    agentIdInUrl: "agent-1",
    editingId: "agent-1",
    ignoreStaleAgentQuery: false,
  }),
  false,
  "already editing that agent",
);

assert.equal(
  shouldOpenAgentEditorFromQuery({
    agentIdInUrl: "agent-1",
    editingId: null,
    ignoreStaleAgentQuery: true,
  }),
  false,
  "Abbrechen must not reopen while ?agent= is still in the URL",
);

assert.equal(
  shouldOpenAgentEditorFromQuery({
    agentIdInUrl: null,
    editingId: null,
    ignoreStaleAgentQuery: true,
  }),
  false,
  "cleared query stays closed",
);

console.log("agent-editor-query: ok");
