/**
 * Previous-period GSC keyword count.
 * Run: node scripts/test-seo-report-keyword-patch.mjs
 */
import assert from "node:assert/strict";

import {
  patchDtV2SeoReportNodes,
  previousQueryBodyFromCurrent,
  summarizePreviousKeywords,
  toPreviousPeriodSearchBody,
} from "./n8n/patch-dt-v2-seo-report-nodes.mjs";

const currentQueryBody =
  "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.startDate, endDate: $('Parameter verarbeiten').first().json.endDate, dimensions: ['query'], rowLimit: 25000 }) }}";

const swapped = toPreviousPeriodSearchBody(currentQueryBody);
assert.match(swapped, /startDate: \$\('Parameter verarbeiten'\)\.first\(\)\.json\.prevStartDate/);
assert.match(swapped, /endDate: \$\('Parameter verarbeiten'\)\.first\(\)\.json\.prevEndDate/);
assert.doesNotMatch(swapped, /\.json\.startDate/);
assert.doesNotMatch(swapped, /\.json\.endDate/);
assert.doesNotMatch(swapped, /prevprev/);

const fromLimitedCurrent = previousQueryBodyFromCurrent(
  "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.startDate, endDate: $('Parameter verarbeiten').first().json.endDate, dimensions: ['query'], rowLimit: 1 }) }}",
  "['query']",
);
assert.match(fromLimitedCurrent, /dimensions: \['query'\]/);
assert.match(fromLimitedCurrent, /rowLimit: 25000/);
assert.match(fromLimitedCurrent, /\.json\.prevStartDate/);
assert.doesNotMatch(fromLimitedCurrent, /prevStartDate:/);

const fromTotalsBody = previousQueryBodyFromCurrent(
  "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.startDate, endDate: $('Parameter verarbeiten').first().json.endDate, rowLimit: 1 }) }}",
  "['query']",
);
assert.match(fromTotalsBody, /dimensions: \['query'\]/);
assert.match(fromTotalsBody, /rowLimit: 25000/);
assert.match(fromTotalsBody, /\.json\.prevStartDate/);

const aggregate = {
  rows: [{ clicks: 108, impressions: 3572, ctr: 0.0302, position: 11.2 }],
};
const queries = {
  rows: Array.from({ length: 97 }, (_, index) => ({
    keys: [`suchbegriff ${index}`, "https://www.clamera.de/"],
    clicks: index === 0 ? 7 : 1,
    impressions: index === 0 ? 31 : 10,
    ctr: 0.1,
    position: 8,
  })),
};
const totals = { rows: [{ clicks: 108, impressions: 3572, ctr: 0.0302, position: 11.2 }] };

const fromAggregate = summarizePreviousKeywords(aggregate, queries, totals);
assert.equal(fromAggregate.total_keywords, 97);
assert.equal(fromAggregate.total_clicks, 108);
assert.equal(fromAggregate.total_impressions, 3572);
assert.equal(fromAggregate.avg_ctr, 3);
assert.equal(fromAggregate.top_keywords.length, 97);
assert.equal(fromAggregate.top_keywords[0].keyword, "suchbegriff 0");
assert.equal(fromAggregate.top_keywords[0].clicks, 7);

const realQueries = {
  rows: [
    { keys: ["clamera"], clicks: 7, impressions: 31, ctr: 0.2258, position: 3.1 },
    { keys: ["persönliche assistenz bonn"], clicks: 4, impressions: 90, ctr: 0.044, position: 8.8 },
  ],
};
const fromQueries = summarizePreviousKeywords(realQueries, {
  rows: [
    { keys: ["clamera", "https://www.clamera.de/"], clicks: 7, impressions: 31, position: 3.1 },
    { keys: ["persönliche assistenz bonn", "https://www.clamera.de/bonn/"], clicks: 4, impressions: 90, position: 8.8 },
  ],
}, totals);
assert.equal(fromQueries.total_keywords, 2);
assert.equal(fromQueries.top_keywords[0].keyword, "persönliche assistenz bonn");
assert.equal(fromQueries.top_keywords[0].page, "https://www.clamera.de/bonn/");
assert.equal(fromQueries.top_keywords.find((item) => item.keyword === "clamera").clicks, 7);

const empty = summarizePreviousKeywords({}, {}, totals);
assert.equal(empty.total_keywords, 0);
assert.equal(empty.top_keywords.length, 0);
assert.equal(empty.total_clicks, 108);

function httpNode(name, jsonBody) {
  return {
    name,
    type: "n8n-nodes-base.httpRequest",
    parameters: {
      sendBody: true,
      specifyBody: "json",
      jsonBody,
    },
  };
}

const nodes = [
  {
    name: "If GSC",
    parameters: {
      conditions: {
        conditions: [{ leftValue: "", rightValue: "", operator: {} }],
      },
    },
  },
  httpNode(
    "GSC Keywords Query \u2013 Nur Metriken - ads@",
    currentQueryBody,
  ),
  httpNode(
    "GSC Vormonat \u2013 Nur Metriken - ads@",
    "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.prevStartDate, endDate: $('Parameter verarbeiten').first().json.prevEndDate, rowLimit: 1 }) }}",
  ),
  httpNode("GSC Keywords Query \u2013 Nur Metriken", currentQueryBody),
  httpNode(
    "GSC Vormonat \u2013 Nur Metriken",
    "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.prevStartDate, endDate: $('Parameter verarbeiten').first().json.prevEndDate, rowLimit: 1 }) }}",
  ),
  httpNode(
    "GSC Keywords Query",
    "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.startDate, endDate: $('Parameter verarbeiten').first().json.endDate, dimensions: ['query', 'page'], rowLimit: 25000 }) }}",
  ),
  httpNode("GSC Keywords Vergleichszeitraum", "={{ JSON.stringify({ rowLimit: 1 }) }}"),
  httpNode(
    "GSC Keywords Query  ads2",
    "={{ JSON.stringify({ startDate: $('Parameter verarbeiten').first().json.startDate, endDate: $('Parameter verarbeiten').first().json.endDate, dimensions: ['query', 'page'], rowLimit: 25000 }) }}",
  ),
  httpNode("GSC Keywords Vergleichszeitraum ads2", "={{ JSON.stringify({ rowLimit: 1 }) }}"),
  { name: "Analyze Keywords Vormonat - ads@", parameters: { jsCode: "old" } },
  { name: "Analyze Keywords Vormonat - ads2@", parameters: { jsCode: "old" } },
];

const patched = patchDtV2SeoReportNodes(nodes);
assert.equal(patched.previousKeywordQueries, 2);
assert.equal(patched.previousKeywordPages, 2);
assert.equal(patched.previousKeywordAnalysis, 2);

const previousMetrics = nodes.find((node) => node.name === "GSC Vormonat \u2013 Nur Metriken - ads@");
assert.match(previousMetrics.parameters.jsonBody, /dimensions: \['query'\]/);
assert.match(previousMetrics.parameters.jsonBody, /rowLimit: 25000/);
assert.match(previousMetrics.parameters.jsonBody, /\.json\.prevStartDate/);
assert.match(previousMetrics.parameters.jsonBody, /\.json\.prevEndDate/);
assert.doesNotMatch(previousMetrics.parameters.jsonBody, /\.json\.startDate/);

const previousPages = nodes.find((node) => node.name === "GSC Keywords Vergleichszeitraum");
assert.match(previousPages.parameters.jsonBody, /'query'/);
assert.match(previousPages.parameters.jsonBody, /'page'/);
assert.match(previousPages.parameters.jsonBody, /\.json\.prevStartDate/);

for (const name of ["Analyze Keywords Vormonat - ads@", "Analyze Keywords Vormonat - ads2@"]) {
  const code = nodes.find((node) => node.name === name).parameters.jsCode;
  assert.match(code, /summarizePreviousKeywords/);
  assert.match(code, /top_keywords/);
  assert.doesNotMatch(code, /focus_keyword\.toLowerCase/);
  assert.doesNotMatch(code, /\|\| 'N\/A'/);
}

const again = patchDtV2SeoReportNodes(nodes);
assert.equal(again.previousKeywordQueries, 2);
assert.equal(previousMetrics.parameters.jsonBody.includes("prevprev"), false);

console.log("seo report previous keyword patch ok");
