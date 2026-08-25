/**
 * Survey KI workspace: organisations, crawl and open tasks.
 * Run: npx tsx scripts/test-survey-assistant-workspace.ts
 */
import assert from "node:assert/strict";

import { buildSurveyChatDynamicSystemText, buildSurveyChatStaticSystemText } from "../lib/ai/chat-context";
import {
  clipWorkspaceText,
  formatFocusedOrgWorkspaceForPrompt,
  formatOpenSeoTasksForSurveyAssistant,
  formatOrganisationDirectoryForPrompt,
  matchOrganisationIdsInText,
  pickFocusedOrganisationIds,
  type SurveyAssistantOrgDirectoryEntry,
} from "../lib/ai/survey-assistant-workspace";

const west: SurveyAssistantOrgDirectoryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Westprüfung Anwälte",
  slug: "westpruefung-anwaelte",
  displayName: "Westprüfung Kanzlei",
  websiteUrl: "https://westpruefung-anwaelte.de/",
  crawlPageCount: 42,
  lastCrawlStatus: "done",
  lastCrawledAt: "2026-08-20T10:00:00.000Z",
  openTaskCount: 3,
  inProgressTaskCount: 1,
};

const oma: SurveyAssistantOrgDirectoryEntry = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Online Media Atelier",
  slug: "oma",
  displayName: null,
  websiteUrl: "https://onlinemediaatelier.de",
  crawlPageCount: 0,
  lastCrawlStatus: null,
  lastCrawledAt: null,
  openTaskCount: 0,
  inProgressTaskCount: 0,
};

assert.deepEqual(
  matchOrganisationIdsInText(
    "Hast du Zugriff auf den Crawl der Westprüfung Kanzlei?",
    [west, oma],
  ),
  [west.id],
);
assert.deepEqual(
  matchOrganisationIdsInText("Bitte westpruefung-anwaelte.de nutzen", [west, oma]),
  [west.id],
);
assert.deepEqual(matchOrganisationIdsInText(west.id, [west, oma]), [west.id]);
assert.deepEqual(matchOrganisationIdsInText("Hallo, wie geht's?", [west, oma]), []);

const picked = pickFocusedOrganisationIds({
  organisations: [west, oma],
  pageOrganisationId: oma.id,
  userMessage: "Fülle die Platzhalter mit dem Crawl von Westprüfung",
});
assert.equal(picked[0], oma.id, "page org comes first");
assert.ok(picked.includes(west.id), "message match is also focused");

const fromSurvey = pickFocusedOrganisationIds({
  organisations: [west, oma],
  surveyOrganisationId: west.id,
  userMessage: "Platzhalter füllen",
});
assert.deepEqual(fromSurvey, [west.id]);

const directory = formatOrganisationDirectoryForPrompt([west, oma]);
assert.match(directory, /Westprüfung Kanzlei/);
assert.match(directory, /crawl=42 Seiten/);
assert.match(directory, /offene Aufgaben: 3/);
assert.match(directory, /Online Media Atelier/);

const tasks = formatOpenSeoTasksForSurveyAssistant([
  {
    id: "task-1",
    title: "Title kürzen",
    keyword: "anwalt dortmund",
    status: "open",
    current_status: "Pos. 12",
    action: "Title auf 60 Zeichen",
    url: "https://westpruefung-anwaelte.de/",
    priority: "high",
  },
  {
    id: "task-2",
    title: "Erledigt",
    keyword: null,
    status: "done",
    current_status: null,
    action: null,
    url: null,
    priority: null,
  },
]);
assert.match(tasks, /Title kürzen/);
assert.match(tasks, /Pos\. 12/);
assert.doesNotMatch(tasks, /Erledigt/);

const emptyFocus = formatFocusedOrgWorkspaceForPrompt([]);
assert.match(emptyFocus, /Behaupte NIEMALS/i);

assert.equal(clipWorkspaceText("kurz", 20), "kurz");
assert.match(clipWorkspaceText("x".repeat(50), 30), /gekürzt/);

const staticPrompt = buildSurveyChatStaticSystemText();
assert.match(staticPrompt, /NEVER claim you have no access/i);
assert.match(staticPrompt, /lookup_organisation_workspace/);
assert.match(staticPrompt, /lookup_survey/);
assert.match(staticPrompt, /search_website_content/);
assert.match(staticPrompt, /read_website_page/);
assert.match(staticPrompt, /NEVER claim you have no function to load a survey/i);

const dynamic = buildSurveyChatDynamicSystemText({
  pageContext: { page: "survey_builder_edit", surveyId: null },
  surveys: [],
  folders: [],
  candidateSurveyContexts: [],
  attachmentSummaries: [],
  conversationSummary: "keine",
  workspace: {
    organisations: [west, oma],
    focused: [
      {
        organisationId: west.id,
        organisationName: "Westprüfung Anwälte",
        websiteUrl: west.websiteUrl,
        crawlPageCount: 42,
        crawlSummary: "Kanzlei für Wirtschaftsprüfung in NRW.",
        sitePageIndex: "1. Start — https://westpruefung-anwaelte.de/",
        openTasks: "3 offene/laufende SEO-Aufgaben:\n- id=task-1 | [Offen] Title kürzen",
      },
    ],
  },
});
assert.match(dynamic, /OPEN QUESTIONNAIRE/);
assert.match(dynamic, /Focused organisation workspace/);
assert.match(dynamic, /Kanzlei für Wirtschaftsprüfung/);
assert.match(dynamic, /Title kürzen/);

const noWorkspace = buildSurveyChatDynamicSystemText({
  pageContext: { page: "survey_list", surveyId: null },
  surveys: [],
  folders: [],
  candidateSurveyContexts: [],
  attachmentSummaries: [],
  conversationSummary: "keine",
});
assert.match(noWorkspace, /not loaded this turn/);

console.log("survey-assistant-workspace: ok");
