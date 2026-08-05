/**
 * Deploy "DT v2 - GSC URL Inspection" — samples Google index status via urlInspection.
 * Usage: node scripts/deploy-dt-v2-gsc-url-inspection.mjs
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
const workflowName = "DT v2 - GSC URL Inspection";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error("Missing N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/i.test(appBase)) {
  console.error("APP_BASE_URL must be publicly reachable (not localhost).");
  process.exit(1);
}

const prepareCode = readFileSync(
  join(root, "scripts/n8n/dt-v2-gsc-url-inspection-prepare.js"),
  "utf8",
)
  .replaceAll("__DT_APP_BASE_URL__", appBase)
  .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret);

const ingestCode = readFileSync(
  join(root, "scripts/n8n/dt-v2-gsc-url-inspection-ingest.js"),
  "utf8",
)
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

function inspectNode(name, position, credentials) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials,
    parameters: {
      method: "POST",
      url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ inspectionUrl: $json.inspectionUrl, siteUrl: $json.gscSiteUrl }) }}",
      options: {
        response: {
          response: {
            neverError: true,
          },
        },
      },
    },
  };
}

function normalizeNode(name, position) {
  return {
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: {
      mode: "runOnceForEachItem",
      jsCode: `const prep = $('Prepare URLs').item.json;
return {
  json: {
    organisationId: prep.organisationId,
    inspectionUrl: prep.inspectionUrl,
    body: $json,
  },
};`,
    },
  };
}

function buildNodes() {
  const webhookId = randomUUID();
  const prepareId = randomUUID();
  const ifGscId = randomUUID();
  const ingestId = randomUUID();
  const respondId = randomUUID();

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
          path: "dt-gsc-url-inspection",
          httpMethod: "POST",
          responseMode: "responseNode",
          options: {},
        },
      },
      {
        id: prepareId,
        name: "Prepare URLs",
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
      inspectNode("Inspect ads", [820, -120], gscCredsAds),
      inspectNode("Inspect ads2", [820, 120], gscCredsAds2),
      normalizeNode("Normalize ads", [1040, -120]),
      normalizeNode("Normalize ads2", [1040, 120]),
      {
        id: ingestId,
        name: "Ingest Results",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [1280, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: ingestCode },
      },
      {
        id: respondId,
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.1,
        position: [1540, 0],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
          options: { responseCode: 200 },
        },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Prepare URLs", type: "main", index: 0 }]] },
      "Prepare URLs": { main: [[{ node: "If GSC", type: "main", index: 0 }]] },
      "If GSC": {
        main: [
          [{ node: "Inspect ads", type: "main", index: 0 }],
          [{ node: "Inspect ads2", type: "main", index: 0 }],
        ],
      },
      "Inspect ads": { main: [[{ node: "Normalize ads", type: "main", index: 0 }]] },
      "Inspect ads2": { main: [[{ node: "Normalize ads2", type: "main", index: 0 }]] },
      "Normalize ads": { main: [[{ node: "Ingest Results", type: "main", index: 0 }]] },
      "Normalize ads2": { main: [[{ node: "Ingest Results", type: "main", index: 0 }]] },
      "Ingest Results": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
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

  const webhookUrl = `${base}/webhook/dt-gsc-url-inspection`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        webhookUrl,
        envHint: `N8N_DT_GSC_URL_INSPECTION_WEBHOOK=${webhookUrl}`,
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
