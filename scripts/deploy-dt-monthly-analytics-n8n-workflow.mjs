/**
 * Deploy "DT v2 - Monthly Analytics" workflow to n8n Cloud.
 * Schedule manually in n8n (e.g. 1st of month 03:00 UTC) with a loop over seo_enabled orgs.
 * Usage: node scripts/deploy-dt-monthly-analytics-n8n-workflow.mjs
 */
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const workflowName = "DT v2 - Monthly Analytics";

if (!base || !apiKey) {
  console.error("Missing N8N_BASE_URL or N8N_API_KEY");
  process.exit(1);
}

const codePath = join(root, "scripts/n8n/dt-v2-monthly-analytics-handler.js");
const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";
const dtSecret = process.env.DT_INTERNAL_WEBHOOK_SECRET || "";

if (!appBase || !dtSecret) {
  console.error("Missing APP_BASE_URL or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}

const handlerSource = readFileSync(codePath, "utf8")
  .replaceAll("__DT_APP_BASE_URL__", appBase)
  .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret);

function buildNodes() {
  const webhookId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const respondId = crypto.randomUUID();
  return [
    {
      id: webhookId,
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: crypto.randomUUID(),
      parameters: {
        path: "dt-monthly-analytics",
        httpMethod: "POST",
        responseMode: "responseNode",
        options: {},
      },
    },
    {
      id: runId,
      name: "Ingest monthly stats",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 0],
      parameters: { mode: "runOnceForAllItems", jsCode: handlerSource },
    },
    {
      id: respondId,
      name: "Respond",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [560, 0],
      parameters: {
        respondWith: "json",
        responseBody: "={{ $json }}",
        options: { responseCode: 200 },
      },
    },
  ];
}

function buildConnections() {
  return {
    Webhook: { main: [[{ node: "Ingest monthly stats", type: "main", index: 0 }]] },
    "Ingest monthly stats": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
  };
}

async function listWorkflows() {
  const res = await fetch(`${base}/api/v1/workflows?limit=250`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  const rows = Array.isArray(data.data) ? data.data : data;
  return rows.filter((w) => w.name === workflowName);
}

async function main() {
  const payload = {
    name: workflowName,
    nodes: buildNodes(),
    connections: buildConnections(),
    settings: { executionOrder: "v1" },
  };

  const existing = await listWorkflows();
  let workflow;
  if (existing[0]) {
    const putRes = await fetch(`${base}/api/v1/workflows/${existing[0].id}`, {
      method: "PUT",
      headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    workflow = await putRes.json();
    if (!putRes.ok) throw new Error(JSON.stringify(workflow));
    await fetch(`${base}/api/v1/workflows/${existing[0].id}/activate`, {
      method: "POST",
      headers: { "X-N8N-API-KEY": apiKey },
    });
  } else {
    const postRes = await fetch(`${base}/api/v1/workflows`, {
      method: "POST",
      headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    workflow = await postRes.json();
    if (!postRes.ok) throw new Error(JSON.stringify(workflow));
    await fetch(`${base}/api/v1/workflows/${workflow.id}/activate`, {
      method: "POST",
      headers: { "X-N8N-API-KEY": apiKey },
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        webhookUrl: `${base}/webhook/dt-monthly-analytics`,
        note: "POST body: { organisationId, periodMonth?, aiClicks?, ... }",
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
