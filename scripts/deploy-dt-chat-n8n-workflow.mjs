/**
 * Creates or updates the "DT v2 - Chat (Anthropic, JWT)" workflow on n8n Cloud.
 *
 * Required env (from .env.local):
 *   N8N_BASE_URL, N8N_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   APP_BASE_URL (or VERCEL_URL)
 *   DT_INTERNAL_WEBHOOK_SECRET, ANTHROPIC_API_KEY
 *
 * Usage: node scripts/deploy-dt-chat-n8n-workflow.mjs
 */
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const workflowName = "DT v2 - Chat (Anthropic, JWT)";

if (!base || !apiKey) {
  console.error("Missing N8N_BASE_URL or N8N_API_KEY");
  process.exit(1);
}

const codePath = join(root, "scripts/n8n/dt-v2-chat-handler.js");
const tunnelUrl = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";

function injectHandlerConfig(source) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") || "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const appBase = tunnelUrl;
  const dtSecret = process.env.DT_INTERNAL_WEBHOOK_SECRET || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

  if (!supabaseUrl || !supabaseAnon || !appBase || !dtSecret || !anthropicKey) {
    console.error(
      "Missing env for deploy. Need: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, APP_BASE_URL, DT_INTERNAL_WEBHOOK_SECRET, ANTHROPIC_API_KEY",
    );
    process.exit(1);
  }

  return source
    .replaceAll("__DT_SUPABASE_URL__", supabaseUrl)
    .replaceAll("__DT_SUPABASE_ANON__", supabaseAnon)
    .replaceAll("__DT_APP_BASE_URL__", appBase)
    .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret)
    .replaceAll("__DT_ANTHROPIC_API_KEY__", anthropicKey);
}

const handlerSource = injectHandlerConfig(readFileSync(codePath, "utf8"));

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
        path: "dt-chat",
        httpMethod: "POST",
        responseMode: "responseNode",
        options: {},
      },
    },
    {
      id: runId,
      name: "Run DT Chat",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 0],
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: handlerSource,
      },
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
        options: {
          responseCode: "={{ $json.statusCode || 200 }}",
        },
      },
    },
  ];
}

function buildConnections() {
  return {
    Webhook: { main: [[{ node: "Run DT Chat", type: "main", index: 0 }]] },
    "Run DT Chat": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
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

async function createWorkflow() {
  const payload = {
    name: workflowName,
    nodes: buildNodes(),
    connections: buildConnections(),
    settings: { executionOrder: "v1" },
  };
  const res = await fetch(`${base}/api/v1/workflows`, {
    method: "POST",
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function updateWorkflow(id) {
  const getRes = await fetch(`${base}/api/v1/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const current = await getRes.json();
  if (!getRes.ok) throw new Error(JSON.stringify(current));

  const payload = {
    name: workflowName,
    nodes: buildNodes(),
    connections: buildConnections(),
    settings: { executionOrder: "v1" },
  };

  const putRes = await fetch(`${base}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await putRes.json();
  if (!putRes.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function activateWorkflow(id) {
  const res = await fetch(`${base}/api/v1/workflows/${id}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const existing = await listWorkflows();
  const workflow = existing[0]
    ? await updateWorkflow(existing[0].id)
    : await createWorkflow();

  await activateWorkflow(workflow.id);

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        name: workflow.name,
        webhookUrl: `${base}/webhook/dt-chat`,
        active: true,
        note: "Starter plan has no Variables UI — config is baked into the Code node by this deploy script.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
