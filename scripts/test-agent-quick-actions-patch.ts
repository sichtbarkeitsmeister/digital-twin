/**
 * Org managers may persist Schnelltests without a full agent edit.
 * Run: npx tsx scripts/test-agent-quick-actions-patch.ts
 */
import assert from "node:assert/strict";

import {
  canApplyAgentPatch,
  definedAgentPatchKeys,
  isQuickActionsOnlyPatch,
} from "../lib/dt/agent-quick-actions-patch";

assert.deepEqual(definedAgentPatchKeys({ quickActions: [] }), ["quickActions"]);
assert.deepEqual(
  definedAgentPatchKeys({ quickActions: ["Hallo"], name: undefined }),
  ["quickActions"],
);
assert.equal(isQuickActionsOnlyPatch({ quickActions: ["Was kostet das?"] }), true);
assert.equal(isQuickActionsOnlyPatch({ quickActions: [], name: "Benno" }), false);
assert.equal(isQuickActionsOnlyPatch({ name: "Benno" }), false);
assert.equal(isQuickActionsOnlyPatch({}), false);

assert.equal(
  canApplyAgentPatch({
    isPlatformAdmin: true,
    canManageOrg: false,
    patch: { name: "Benno", promptTemplate: "…" },
  }).ok,
  true,
);

assert.equal(
  canApplyAgentPatch({
    isPlatformAdmin: false,
    canManageOrg: true,
    patch: { quickActions: ["Was ist dir wichtig?"] },
  }).ok,
  true,
);

const orgBlocked = canApplyAgentPatch({
  isPlatformAdmin: false,
  canManageOrg: true,
  patch: { quickActions: ["Hi"], name: "Benno" },
});
assert.equal(orgBlocked.ok, false);
if (!orgBlocked.ok) {
  assert.match(orgBlocked.message, /Schnelltests/);
}

const memberBlocked = canApplyAgentPatch({
  isPlatformAdmin: false,
  canManageOrg: false,
  patch: { quickActions: ["Hi"] },
});
assert.equal(memberBlocked.ok, false);
if (!memberBlocked.ok) {
  assert.match(memberBlocked.message, /Administratoren/);
}

console.log("agent-quick-actions-patch: ok");
