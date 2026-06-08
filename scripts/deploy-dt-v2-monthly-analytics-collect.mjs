/**
 * Deploy "DT v2 - Monthly Analytics" — per-org webhook with GSC/GA4 HTTP nodes (legacy credentials + If routing).
 * Usage: node scripts/deploy-dt-v2-monthly-analytics-collect.mjs
 */
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";
const dtSecret = process.env.DT_INTERNAL_WEBHOOK_SECRET || "";
const workflowName = "DT v2 - Monthly Analytics";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error("Missing N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}

const datesCode = readFileSync(join(root, "scripts/n8n/dt-v2-monthly-analytics-dates.js"), "utf8");
const ingestCode = readFileSync(join(root, "scripts/n8n/dt-v2-monthly-analytics-ingest.js"), "utf8")
  .replaceAll("__DT_APP_BASE_URL__", appBase)
  .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret);

const PRIMARY_ACCOUNT = "ads@sichtbarkeitsmeister.de";

const gscCredsAds = {
  googleSearchConsoleOAuth2Api: {
    id: "HIb6PZVkNIemvbtI",
    name: "Google Search Console account",
  },
};

const gscCredsAds2 = {
  googleSearchConsoleOAuth2Api: {
    id: "HRT4C9PvCF2aZn7Q",
    name: "Google Search Console account ads2@",
  },
};

const ga4CredsAds = {
  googleAnalyticsOAuth2: {
    id: "By9v2sueCb89FnqT",
    name: "Google Analytics account",
  },
};

const ga4CredsAds2 = {
  googleAnalyticsOAuth2: {
    id: "ehMyIqxOmbLvVVVm",
    name: "Google Analytics - ads2@sichtbarkeitsmeister.de",
  },
};

function ifPrimaryAccountNode(name, position, field) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 3,
        },
        conditions: [
          {
            id: randomUUID(),
            leftValue: `={{ $('Compute Dates').first().json.${field} }}`,
            rightValue: PRIMARY_ACCOUNT,
            operator: {
              type: "string",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  };
}

function gscTotalsNode(name, position, credentials) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials,
    parameters: {
      method: "POST",
      url: "=https://searchconsole.googleapis.com/webmasters/v3/sites/{{ encodeURIComponent($('Compute Dates').first().json.gscSiteUrl) }}/searchAnalytics/query",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSearchConsoleOAuth2Api",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ startDate: $('Compute Dates').first().json.startDate, endDate: $('Compute Dates').first().json.endDate, rowLimit: 1 }) }}",
      options: {},
    },
  };
}

function gscKeywordsNode(name, position, credentials) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials,
    parameters: {
      method: "POST",
      url: "=https://searchconsole.googleapis.com/webmasters/v3/sites/{{ encodeURIComponent($('Compute Dates').first().json.gscSiteUrl) }}/searchAnalytics/query",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSearchConsoleOAuth2Api",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ startDate: $('Compute Dates').first().json.startDate, endDate: $('Compute Dates').first().json.endDate, dimensions: ['query'], rowLimit: 25000 }) }}",
      options: { continueOnFail: true },
    },
  };
}

function ga4ReferrersNode(name, position, credentials) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials,
    parameters: {
      method: "POST",
      url: "=https://analyticsdata.googleapis.com/v1beta/properties/{{ $('Compute Dates').first().json.ga4PropertyId }}:runReport",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleAnalyticsOAuth2",
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  dateRanges: [{ startDate: $('Compute Dates').first().json.startDate, endDate: $('Compute Dates').first().json.endDate }],
  dimensions: [{ name: 'sessionSource' }],
  metrics: [{ name: 'sessions' }],
  dimensionFilter: {
    orGroup: {
      expressions: [
        { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'chatgpt' } } },
        { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'perplexity' } } },
        { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'gemini' } } },
        { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'claude' } } },
      ],
    },
  },
  limit: 100,
}) }}`,
      options: { continueOnFail: true },
    },
  };
}

function buildNodes() {
  const webhookId = randomUUID();
  const loadOrgId = randomUUID();
  const computeDatesId = randomUUID();
  const ingestId = randomUUID();
  const respondId = randomUUID();

  const ifGsc = ifPrimaryAccountNode("If GSC", [780, 0], "gsc_account");
  const ifGa4 = ifPrimaryAccountNode("If GA4", [1300, 0], "ga4_account");

  const gscTotalsAds = gscTotalsNode("GSC Month Totals", [1040, -120], gscCredsAds);
  const gscKeywordsAds = gscKeywordsNode("GSC Keyword Rankings", [1040, -240], gscCredsAds);
  const gscTotalsAds2 = gscTotalsNode("GSC Month Totals ads2", [1040, 120], gscCredsAds2);
  const gscKeywordsAds2 = gscKeywordsNode("GSC Keyword Rankings ads2", [1040, 240], gscCredsAds2);

  const ga4Ads = ga4ReferrersNode("GA4 AI Referrers", [1560, -180], ga4CredsAds);
  const ga4Ads2 = ga4ReferrersNode("GA4 AI Referrers ads2", [1560, 60], ga4CredsAds2);

  return {
    nodes: [
      {
        id: webhookId,
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [0, 0],
        webhookId: randomUUID(),
        parameters: {
          path: "dt-monthly-analytics",
          httpMethod: "POST",
          responseMode: "responseNode",
          options: {},
        },
      },
      {
        id: loadOrgId,
        name: "Load Org Config",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [260, 0],
        parameters: {
          url: `=${appBase}/api/dt/internal/seo-org/{{ $json.body.organisationId }}/config`,
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: "X-DT-Webhook-Secret", value: dtSecret }],
          },
          options: {},
        },
      },
      {
        id: computeDatesId,
        name: "Compute Dates",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [520, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: datesCode },
      },
      ifGsc,
      gscTotalsAds,
      gscKeywordsAds,
      gscTotalsAds2,
      gscKeywordsAds2,
      ifGa4,
      ga4Ads,
      ga4Ads2,
      {
        id: ingestId,
        name: "Ingest Stats",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [1820, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: ingestCode },
      },
      {
        id: respondId,
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [2080, 0],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
          options: { responseCode: 200 },
        },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Load Org Config", type: "main", index: 0 }]] },
      "Load Org Config": { main: [[{ node: "Compute Dates", type: "main", index: 0 }]] },
      "Compute Dates": { main: [[{ node: "If GSC", type: "main", index: 0 }]] },
      "If GSC": {
        main: [
          [{ node: "GSC Month Totals", type: "main", index: 0 }],
          [{ node: "GSC Month Totals ads2", type: "main", index: 0 }],
        ],
      },
      "GSC Month Totals": { main: [[{ node: "GSC Keyword Rankings", type: "main", index: 0 }]] },
      "GSC Month Totals ads2": { main: [[{ node: "GSC Keyword Rankings ads2", type: "main", index: 0 }]] },
      "GSC Keyword Rankings": { main: [[{ node: "If GA4", type: "main", index: 0 }]] },
      "GSC Keyword Rankings ads2": { main: [[{ node: "If GA4", type: "main", index: 0 }]] },
      "If GA4": {
        main: [
          [{ node: "GA4 AI Referrers", type: "main", index: 0 }],
          [{ node: "GA4 AI Referrers ads2", type: "main", index: 0 }],
        ],
      },
      "GA4 AI Referrers": { main: [[{ node: "Ingest Stats", type: "main", index: 0 }]] },
      "GA4 AI Referrers ads2": { main: [[{ node: "Ingest Stats", type: "main", index: 0 }]] },
      "Ingest Stats": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
    },
  };
}

async function n8nFetch(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const { nodes, connections } = buildNodes();
  const payload = {
    name: workflowName,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };

  const list = await n8nFetch("/api/v1/workflows?limit=250");
  const rows = Array.isArray(list.data) ? list.data : list;
  const existing = rows.find((w) => w.name === workflowName);

  let workflow;
  if (existing) {
    workflow = await n8nFetch(`/api/v1/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await n8nFetch(`/api/v1/workflows/${existing.id}/activate`, { method: "POST" });
  } else {
    workflow = await n8nFetch("/api/v1/workflows", { method: "POST", body: JSON.stringify(payload) });
    await n8nFetch(`/api/v1/workflows/${workflow.id}/activate`, { method: "POST" });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        webhookUrl: `${base}/webhook/dt-monthly-analytics`,
        nodeCount: nodes.length,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
