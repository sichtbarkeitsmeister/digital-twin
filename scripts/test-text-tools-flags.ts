/**
 * Textwerkzeuge: registry, routes and the DT_TEXT_TOOLS feature flag.
 * Run: npx tsx scripts/test-text-tools-flags.ts
 */
import assert from "node:assert/strict";

import { isTextToolsDashboardPath } from "../lib/dt/seo/dashboard-path";
import {
  isTextToolId,
  isTextToolsPath,
  parseTextToolFlags,
  TEXT_TOOL_IDS,
  TEXT_TOOL_LIST,
  TEXT_TOOLS,
  textToolFromSlug,
  textToolHref,
} from "../lib/dt/text-tools/tools";

function testRegistry() {
  assert.deepEqual(TEXT_TOOL_IDS, ["geo", "seo", "watermark"]);
  assert.deepEqual(TEXT_TOOL_LIST.map((t) => t.slug), ["geo", "seo", "wasserzeichen"]);
  assert.equal(isTextToolId("seo"), true);
  assert.equal(isTextToolId("wasserzeichen"), false);
  assert.equal(textToolFromSlug("wasserzeichen")?.id, "watermark");
  assert.equal(textToolFromSlug("Watermark")?.id, "watermark");
  assert.equal(textToolFromSlug("texte"), null);
  assert.equal(textToolHref("geo"), "/dashboard/verwaltung/textwerkzeuge/geo");
  assert.equal(textToolHref("watermark", "org 1"), "/dashboard/verwaltung/textwerkzeuge/wasserzeichen?org=org%201");
  for (const tool of TEXT_TOOL_LIST) {
    assert.ok(tool.label && tool.description, `${tool.id} has a label and description`);
    assert.equal(TEXT_TOOLS[tool.id], tool);
  }
  console.log("registry: ok");
}

function testPaths() {
  assert.equal(isTextToolsPath("/dashboard/verwaltung/textwerkzeuge"), true);
  assert.equal(isTextToolsPath("/dashboard/verwaltung/textwerkzeuge/geo"), true);
  assert.equal(isTextToolsPath("/dashboard/verwaltung/texte"), false);
  assert.equal(isTextToolsDashboardPath("/dashboard/verwaltung/textwerkzeuge/seo"), true);
  assert.equal(isTextToolsDashboardPath("/dashboard/verwaltung/textwerkzeugeX"), false);
  console.log("paths: ok");
}

function testFlags() {
  assert.deepEqual(parseTextToolFlags(undefined, "production"), []);
  assert.deepEqual(parseTextToolFlags("", "production"), []);
  assert.deepEqual(parseTextToolFlags(undefined, "development"), ["geo", "seo", "watermark"]);
  assert.deepEqual(parseTextToolFlags(undefined, undefined), ["geo", "seo", "watermark"]);
  assert.deepEqual(parseTextToolFlags("all", "production"), ["geo", "seo", "watermark"]);
  assert.deepEqual(parseTextToolFlags("none", "development"), []);
  assert.deepEqual(parseTextToolFlags("seo", "production"), ["seo"]);
  assert.deepEqual(parseTextToolFlags("wasserzeichen, GEO", "production"), ["geo", "watermark"]);
  assert.deepEqual(parseTextToolFlags("unbekannt", "production"), []);
  assert.deepEqual(parseTextToolFlags("seo;watermark seo", "production"), ["seo", "watermark"]);
  console.log("flags: ok");
}

testRegistry();
testPaths();
testFlags();
console.log("text-tools flags: all ok");
