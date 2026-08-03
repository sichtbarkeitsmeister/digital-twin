import assert from "node:assert/strict";

import {
  resolveChatModeForCreate,
  resolveDefaultAgentId,
  shouldStartNewChatOnAgentSwitch,
} from "../lib/dt/chat/agent-selection";

const advisor = { id: "advisor", slug: "seo_advisor", kind: "seo_advisor" };
const geo = { id: "geo", slug: "geo_advisor", kind: "geo_advisor" };
const peter = { id: "peter", slug: "peter_lustig", kind: "persona" };
const benno = { id: "benno", slug: "benno", kind: "wunschkunde" };

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
  // SEO chat open, twin picked → fresh chat instead of moving the SEO chat.
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "seo",
      targetAgent: benno,
    }),
    true,
  );

  // Twin chat open, advisor picked → fresh chat as well.
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: advisor,
    }),
    true,
  );

  // Twin to twin inside the SEO workspace keeps the chat.
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: peter,
    }),
    false,
  );

  // Without an open chat or outside the SEO workspace nothing special happens.
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      seoMode: true,
      hasActiveChat: false,
      activeChatMode: null,
      targetAgent: benno,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatOnAgentSwitch({
      hasActiveChat: true,
      activeChatMode: "default",
      targetAgent: peter,
    }),
    false,
  );
  console.log("agent switch starts new chat: ok");
}

testSeoWorkspaceKeepsTwins();
testAdvisorStaysOutOfNormalChat();
testChatModeForCreate();
testAgentSwitchStartsNewChat();
console.log("All chat agent-selection tests passed.");
