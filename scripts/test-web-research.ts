/**
 * SEO chat web research (Anthropic server tools): limit notice, source list, usage.
 * Run: npx tsx scripts/test-web-research.ts
 */
import assert from "node:assert/strict";

import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  appendWebResearchNotes,
  DT_WEB_FETCH_LIMIT_NOTICE,
  DT_WEB_RESEARCH_TOOLS,
  DT_WEB_SEARCH_LIMIT_NOTICE,
  DT_WEB_SEARCH_MAX_USES,
  inspectWebResearchBlocks,
  mergeWebResearchUsage,
  sumServerToolUsage,
} from "../lib/dt/seo/web-research";

// Tools: web search capped, web fetch capped + content limit.
const search = DT_WEB_RESEARCH_TOOLS.find((t) => t.name === "web_search") as { max_uses?: number | null };
assert.equal(search.max_uses, DT_WEB_SEARCH_MAX_USES);
const fetchTool = DT_WEB_RESEARCH_TOOLS.find((t) => t.name === "web_fetch") as {
  max_uses?: number | null;
  max_content_tokens?: number | null;
};
assert.ok((fetchTool.max_uses ?? 0) > 0);
assert.ok((fetchTool.max_content_tokens ?? 0) > 0);

// Usage: server_tool_use counts are summed across rounds.
const u1 = sumServerToolUsage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } });
const u2 = sumServerToolUsage({ server_tool_use: null });
const merged = mergeWebResearchUsage(u1, mergeWebResearchUsage(u2, sumServerToolUsage(undefined)));
assert.equal(merged.webSearchRequests, 3);
assert.equal(merged.webFetchRequests, 1);

// Findings: limit error + citations across blocks.
const blocks = [
  { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "veneers nachfrage" } },
  {
    type: "web_search_tool_result",
    tool_use_id: "s1",
    content: [{ type: "web_search_result", url: "https://example.org/a", title: "Beispiel A", encrypted_content: "x", page_age: null }],
  },
  {
    type: "text",
    text: "Veneers werden häufig nachgefragt.",
    citations: [
      { type: "web_search_result_location", url: "https://example.org/a", title: "Beispiel A", cited_text: "…", encrypted_index: "e" },
      { type: "web_search_result_location", url: "https://example.org/a", title: "Beispiel A", cited_text: "…", encrypted_index: "e2" },
      { type: "web_search_result_location", url: "https://example.org/b", title: null, cited_text: "…", encrypted_index: "e3" },
    ],
  },
  {
    type: "web_search_tool_result",
    tool_use_id: "s2",
    content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
  },
];
const findings = inspectWebResearchBlocks(blocks);
assert.equal(findings.searchLimitHit, true);
assert.equal(findings.fetchLimitHit, false);
assert.deepEqual(findings.sources, [
  { url: "https://example.org/a", title: "Beispiel A" },
  { url: "https://example.org/b", title: null },
]);

const withNotes = appendWebResearchNotes("Antworttext.", findings);
assert.ok(withNotes.startsWith("Antworttext."));
assert.ok(withNotes.includes("**Quellen (Websuche):**"));
assert.ok(withNotes.includes("[Beispiel A](https://example.org/a)"));
assert.ok(withNotes.includes("[example.org](https://example.org/b)"));
assert.ok(withNotes.endsWith(DT_WEB_SEARCH_LIMIT_NOTICE));
assert.ok(DT_WEB_SEARCH_LIMIT_NOTICE.includes(`${DT_WEB_SEARCH_MAX_USES} Websuchen`));

// Other error codes are not the limit; fetch limit gets its own notice.
const other = inspectWebResearchBlocks([
  { type: "web_search_tool_result", tool_use_id: "x", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
  { type: "web_fetch_tool_result", tool_use_id: "y", content: { type: "web_fetch_tool_result_error", error_code: "max_uses_exceeded" } },
]);
assert.equal(other.searchLimitHit, false);
assert.equal(other.fetchLimitHit, true);
assert.ok(appendWebResearchNotes("Text", other).endsWith(DT_WEB_FETCH_LIMIT_NOTICE));

// No findings → text unchanged; existing "Quellen:" heading is not duplicated.
assert.equal(appendWebResearchNotes("Nur Text.", inspectWebResearchBlocks([])), "Nur Text.");
const own = appendWebResearchNotes("Fakt.\n\nQuellen:\n- https://example.org/a", {
  searchLimitHit: false,
  fetchLimitHit: false,
  sources: [{ url: "https://example.org/a", title: "A" }],
});
assert.equal(own.split("Quellen").length - 1, 1);

// Prompt: web research rules only in SEO mode.
const base = { name: "SEO", role: null, prompt_template: "Du bist SEO." };
const seo = buildDtSystemPrompt({ agent: { ...base, kind: "seo_advisor" }, org: { display_name: "X" }, mode: "seo" });
assert.ok(seo.includes("## Websuche und Web-Abruf"));
assert.ok(seo.includes("max_uses_exceeded"));
const plain = buildDtSystemPrompt({ agent: { ...base, kind: "staff" }, org: { display_name: "X" }, mode: "default" });
assert.ok(!plain.includes("## Websuche und Web-Abruf"));

console.log("web-research tests: ok");
