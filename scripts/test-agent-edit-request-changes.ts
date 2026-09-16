/**
 * Schnelltests are saved directly and must not appear in Änderungsanfragen.
 * Run: npx tsx scripts/test-agent-edit-request-changes.ts
 */
import assert from "node:assert/strict";

import { buildAgentProposedChanges } from "../lib/dt/agent-edit-requests";

const current = {
  name: "Benno",
  role: "Berater",
  prompt_template: "Sei hilfreich.",
  is_enabled: true,
  position: 1,
};

assert.equal(
  buildAgentProposedChanges({
    current,
    next: { ...current, name: "Benno Plus" },
  })?.name,
  "Benno Plus",
);

assert.equal(
  buildAgentProposedChanges({
    current,
    next: current,
  }),
  null,
);

const onlyQuickActionsWouldHaveChanged = buildAgentProposedChanges({
  current,
  next: current,
});
assert.equal(
  onlyQuickActionsWouldHaveChanged,
  null,
  "unchanged behaviour fields yield no request",
);

const nameAndRole = buildAgentProposedChanges({
  current,
  next: { ...current, name: "Clara", role: "Coach" },
});
assert.deepEqual(nameAndRole, { name: "Clara", role: "Coach" });
assert.equal("quick_actions" in (nameAndRole ?? {}), false);

console.log("agent-edit-request-changes: ok");
