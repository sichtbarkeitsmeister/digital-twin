import assert from "node:assert/strict";

import {
  resolveChatModeForCreate,
  resolveDefaultAgentId,
  shouldStartNewChatOnAgentSwitch,
} from "../lib/dt/chat/agent-selection";
import { filterAgentsHiddenFromOrgMembers } from "../lib/dt/agents/seo-advisor";

const advisor = { id: "advisor", slug: "seo_advisor", kind: "seo_advisor" };
const geo = { id: "geo", slug: "geo_advisor", kind: "geo_advisor" };
const peter = { id: "peter", slug: "peter_lustig", kind: "persona" };
const benno = { id: "benno", slug: "benno", kind: "wunschkunde" };
const starterTwin = { id: "twin", slug: "default", kind: "persona" };

function testSeoWorkspaceKeepsTwins() {
  const agents = [advisor, peter, benno];

  // Nothing selected yet → advisor is the SEO default.
  assert.equal(resolveDefaultAgentId(agents, { seoMode: true }), "advisor");

  // A selected twin stays selected — also across "Neuer Chat".
  assert.equal(
    resolveDefaultAgentId(agents, { seoMode: true, currentId: "benno" }),
    "benno",
  );

  // A selection that no longer exists falls back to the advisor.
  assert.equal(
    resolveDefaultAgentId(agents, { seoMode: true, currentId: "gone" }),
    "advisor",
  );
  console.log("seo workspace keeps twins: ok");
}

function testAdvisorStaysOutOfNormalChat() {
  const agents = [advisor, peter];
  assert.equal(resolveDefaultAgentId(agents, {}), "peter");
  assert.equal(resolveDefaultAgentId(agents, { currentId: "peter" }), "peter");

  // Only the advisor available outside SEO → no crash, but never silently preferred.
  assert.equal(resolveDefaultAgentId([advisor], {}), "advisor");
  assert.equal(resolveDefaultAgentId([], {}), "");
  console.log("advisor stays out of normal chat: ok");
}

function testChatModeForCreate() {
  // Only advisor conversations become SEO chats.
  assert.equal(
    resolveChatModeForCreate({ seoMode: true, agent: advisor }),
    "seo",
  );
  assert.equal(resolveChatModeForCreate({ seoMode: true, agent: geo }), "seo");
  assert.equal(
    resolveChatModeForCreate({ seoMode: true, agent: benno }),
    "default",
  );
  assert.equal(resolveChatModeForCreate({ seoMode: true, agent: null }), "default");

  // Outside the SEO workspace the scope decides.
  assert.equal(resolveChatModeForCreate({ agent: peter }), "default");
  assert.equal(
    resolveChatModeForCreate({ teamScope: true, agent: peter }),
    "team",
  );
  console.log("chat mode for create: ok");
}

function testAgentSwitchStartsNewChat() {
  // Any open chat + agent switch → fresh chat (never reassign agent_id).
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "seo",
      targetAgent: benno,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: advisor,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: peter,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: peter,
    }),
    true,
  );

  // Without an open chat nothing special happens.
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: false,
      activeChatMode: null,
      targetAgent: benno,
    }),
    false,
  );
  console.log("agent switch starts new chat: ok");
}

function testCustomerAgentVisibility() {
  // Advisor and the auto-created starter twin stay out of the customer view.
  assert.deepEqual(
    filterAgentsHiddenFromOrgMembers([advisor, starterTwin, peter]).map((a) => a.id),
    ["peter"],
  );

  // Without another usable avatar the starter twin remains as fallback.
  assert.deepEqual(
    filterAgentsHiddenFromOrgMembers([advisor, starterTwin]).map((a) => a.id),
    ["twin"],
  );
  assert.deepEqual(
    filterAgentsHiddenFromOrgMembers([
      starterTwin,
      { ...peter, is_enabled: false },
    ]).map((a) => a.id),
    ["twin", "peter"],
  );

  // The org overview uses camelCase rows.
  assert.deepEqual(
    filterAgentsHiddenFromOrgMembers([
      { ...starterTwin, isEnabled: true },
      { ...benno, isEnabled: true },
    ]).map((a) => a.id),
    ["benno"],
  );
  console.log("customer agent visibility: ok");
}

testSeoWorkspaceKeepsTwins();
testCustomerAgentVisibility();
testAdvisorStaysOutOfNormalChat();
testChatModeForCreate();
testAgentSwitchStartsNewChat();
console.log("All chat agent-selection tests passed.");
