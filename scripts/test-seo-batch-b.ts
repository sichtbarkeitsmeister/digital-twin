import assert from "node:assert/strict";

import {
  checkSerpSnippet,
  estimateArialPixelWidth,
  formatSerpSnippetCheckForTool,
  SERP_PIXEL_LIMITS,
} from "../lib/dt/seo/serp-pixel";
import { formatDtSeoTasksForPrompt, type DtSeoTaskPromptRow } from "../lib/dt/seo/task-context";

function testSerpPixel() {
  const short = estimateArialPixelWidth("Kurz", 20);
  const long = estimateArialPixelWidth(
    "Sehr langer SEO-Titel mit vielen Wörtern für den Pixel-Check Desktop und Mobile",
    20,
  );
  assert.ok(short < SERP_PIXEL_LIMITS.titleDesktop);
  assert.ok(long > short);

  const checked = checkSerpSnippet({
    title: "Kurz",
    description: "Kurze Beschreibung.",
  });
  assert.equal(checked.title?.desktopOk, true);
  assert.equal(checked.description?.desktopOk, true);

  const tool = formatSerpSnippetCheckForTool({
    title:
      "Extrem langer Title der auf Desktop und Mobile die SERP-Pixel-Limits klar überschreiten soll und deshalb gekürzt werden muss",
  });
  assert.match(tool, /ZU LANG|Anpassen/);
  console.log("serp-pixel: ok");
}

function testTaskPromptIncludesIds() {
  const tasks: DtSeoTaskPromptRow[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Title Tag Startseite",
      keyword: "umzug köln",
      url: "https://example.de/",
      status: "open",
      priority: "high",
      current_status: "Pos. 8",
      action: "Title kürzen",
      updated_at: new Date().toISOString(),
    },
  ];
  const text = formatDtSeoTasksForPrompt(tasks);
  assert.match(text, /id=11111111-1111-1111-1111-111111111111/);
  assert.match(text, /update_seo_task/);
  assert.match(text, /delete_seo_task/);
  console.log("task-context: ok");
}

testSerpPixel();
testTaskPromptIncludesIds();
console.log("All Batch-B smoke tests passed.");
