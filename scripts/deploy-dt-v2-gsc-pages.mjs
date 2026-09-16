/**
 * Deploy "DT v2 - GSC Pages" — Search Analytics dimension=page for crawl seeding
 * and indexed/not-indexed display.
 * Usage: node scripts/deploy-dt-v2-gsc-pages.mjs
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
const workflowName = "DT v2 - GSC Pages";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error("Missing N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/i.test(appBase)) {
  console.error("APP_BASE_URL must be publicly reachable (not localhost).");
  process.exit(1);
}

const prepareCode = readFileSync(join(root, "scripts/n8n/dt-v2-gsc-pages-prepare.js"), "utf8")
  .replaceAll("__DT_APP_BASE_URL__", appBase)
  .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret);

const ingestCode = readFileSync(join(root, "scripts/n8n/dt-v2-gsc-pages-ingest.js"), "utf8")
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

function pagesNode(name, position, credentials) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials,
    parameters: {
      method: "POST",
      url: "=https://searchconsole.googleapis.com/webmasters/v3/sites/{{ encodeURIComponent($json.gscSiteUrl) }}/searchAnalytics/query",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSearchConsoleOAuth2Api",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ startDate: $json.startDate, endDate: $json.endDate, dimensions: ['page'], rowLimit: 25000, dataState: 'all' }) }}",
      options: {
        continueOnFail: true,
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
  };
}

function buildNodes() {
  const webhookId = randomUUID();
  const prepareId = randomUUID();
  const ifGscId = randomUUID();
  const ingestId = randomUUID();

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
          path: "dt-gsc-pages",
          httpMethod: "POST",
          responseMode: "onReceived",
          options: {},
        },
      },
      {
        id: prepareId,
        name: "Prepare",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [280, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: prepareCode },
      },
      {
        id: ifGscId,
        name: "If GSC",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [540, 0],
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
                leftValue: "={{ $json.gscAccount }}",
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
      },
      pagesNode("GSC Pages ads", [820, -120], gscCredsAds),
      pagesNode("GSC Pages ads2", [820, 120], gscCredsAds2),
      {
        id: ingestId,
        name: "Ingest",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [1100, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: ingestCode },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Prepare", type: "main", index: 0 }]] },
      Prepare: { main: [[{ node: "If GSC", type: "main", index: 0 }]] },
      "If GSC": {
        main: [
          [{ node: "GSC Pages ads", type: "main", index: 0 }],
          [{ node: "GSC Pages ads2", type: "main", index: 0 }],
        ],
      },
      "GSC Pages ads": { main: [[{ node: "Ingest", type: "main", index: 0 }]] },
      "GSC Pages ads2": { main: [[{ node: "Ingest", type: "main", index: 0 }]] },
    },
  };
}

async function n8nFetch(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
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
    workflow = await n8nFetch("/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await n8nFetch(`/api/v1/workflows/${workflow.id}/activate`, { method: "POST" });
  }

  const webhookUrl = `${base}/webhook/dt-gsc-pages`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        webhookUrl,
        envHint: `N8N_DT_GSC_PAGES_WEBHOOK=${webhookUrl}`,
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
