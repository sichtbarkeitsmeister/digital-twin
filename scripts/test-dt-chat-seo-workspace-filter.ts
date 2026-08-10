/**
 * SEO workspace chat list filter includes advisor + personal twin chats.
 * Run: npx tsx scripts/test-dt-chat-seo-workspace-filter.ts
 */
import assert from "node:assert/strict";

import { dtChatSeoWorkspaceOrFilter } from "../lib/dt/db";

const userId = "11111111-1111-1111-1111-111111111111";

const filter = dtChatSeoWorkspaceOrFilter(userId);
assert.match(filter, /mode\.eq\.seo/);
assert.match(filter, new RegExp(`owner_user_id\\.eq\\.${userId}`));
assert.match(filter, /mode\.eq\.default/);
assert.match(filter, /legacy_session_id\.is\.null/);

const nested = dtChatSeoWorkspaceOrFilter(userId, "dt_chats");
assert.match(nested, /dt_chats\.mode\.eq\.seo/);
assert.match(nested, /dt_chats\.mode\.eq\.default/);

console.log("seo workspace chat filter: ok");
