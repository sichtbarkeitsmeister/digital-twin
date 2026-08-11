import assert from "node:assert/strict";

import {
  deleteDtAgentErrorCode,
  deleteDtAgentUserMessage,
  isProtectedSeoAdvisorAgent,
} from "../lib/dt/delete-agent-policy";

function testSeoAdvisorProtection() {
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "seo_advisor", kind: "seo_advisor" }), true);
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "seo_advisor", kind: "persona" }), true);
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "default", kind: "persona" }), false);
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "default", kind: "seo_advisor" }), true);
  // geo_advisor is hide-from-customers, but deletable by admins
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "geo_advisor", kind: "geo_advisor" }), false);
  assert.equal(isProtectedSeoAdvisorAgent({ slug: "peter", kind: "wunschkunde" }), false);
  console.log("seo advisor protection: ok");
}

function testErrorCodesAndMessages() {
  assert.equal(deleteDtAgentErrorCode("seo_advisor_protected"), "seo_advisor_protected");
  assert.equal(deleteDtAgentErrorCode("default_agent_protected"), "default_agent_protected");
  assert.equal(
    deleteDtAgentUserMessage("seo_advisor_protected"),
    "Der SEO-Berater kann nicht entfernt werden.",
  );
  assert.equal(
    deleteDtAgentUserMessage("agent_has_chats"),
    "Agent hat noch Chats — bitte zuerst die Chats dieses Agenten löschen.",
  );
  console.log("error codes and messages: ok");
}

testSeoAdvisorProtection();
testErrorCodesAndMessages();
console.log("all delete-agent tests passed");
