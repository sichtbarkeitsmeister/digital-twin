/**
 * Clone "Sichtbarkeitsmeister SEO-Report" → "DT v2 - SEO Report"
 * Patches: webhook path, NEW context API, dt_seo_reports callbacks (no OLD seo_cache).
 *
 * Usage: node scripts/clone-dt-v2-seo-report-from-legacy.mjs
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
const legacyWorkflowId = process.env.N8N_LEGACY_SEO_REPORT_WORKFLOW_ID || "6voT3Eu7jFETcuJP";
const targetName = "DT v2 - SEO Report";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error(
    "Missing env. Need: N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, DT_INTERNAL_WEBHOOK_SECRET",
  );
  process.exit(1);
}

function loadSnippet(filename) {
  return readFileSync(join(root, "scripts/n8n", filename), "utf8")
    .replaceAll("__DT_APP_BASE_URL__", appBase)
    .replaceAll("__DT_INTERNAL_WEBHOOK_SECRET__", dtSecret);
}

const markRunningCode = loadSnippet("dt-v2-seo-report-mark-running.js");
const completeDoneCode = loadSnippet("dt-v2-seo-report-complete-done.js");
const completeErrorCode = loadSnippet("dt-v2-seo-report-complete-error.js");

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

function removeNode(nodes, connections, name) {
  const idx = nodes.findIndex((n) => n.name === name);
  if (idx === -1) return;
  nodes.splice(idx, 1);
  delete connections[name];
  for (const key of Object.keys(connections)) {
    connections[key].main = (connections[key].main ?? []).map((outputs) =>
      (outputs ?? []).filter((edge) => edge.node !== name),
    );
  }
}

function replaceNodeType(nodes, name, patch) {
  const node = nodes.find((n) => n.name === name);
  if (!node) return false;
  patch(node);
  return true;
}

function insertNodeAfter(nodes, connections, afterName, newNode) {
  nodes.push(newNode);
  const outputs = connections[afterName]?.main?.[0] ?? [];
  const nextNodes = outputs.map((e) => ({ ...e }));
  connections[afterName] = {
    main: [[{ node: newNode.name, type: "main", index: 0 }]],
  };
  connections[newNode.name] = { main: [nextNodes] };
}

function patchLegacyWorkflow(workflow) {
  const nodes = structuredClone(workflow.nodes);
  let connections = structuredClone(workflow.connections);

  removeNode(nodes, connections, "Monatlicher Trigger");
  removeNode(nodes, connections, "When clicking ‘Execute workflow’");

  replaceNodeType(nodes, "Webhook", (node) => {
    node.parameters = {
      httpMethod: "POST",
      path: "dt-seo-report",
      responseMode: "onReceived",
      options: {},
    };
    node.webhookId = randomUUID();
  });

  replaceNodeType(nodes, "HTTP Request1", (node) => {
    node.parameters = {
      url: `=${appBase}/api/dt/internal/seo-report/{{ $json.body.reportId }}/context`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "X-DT-Webhook-Secret", value: dtSecret },
          { name: "Accept", value: "application/json" },
        ],
      },
      options: {},
    };
    delete node.credentials;
  });

  replaceNodeType(nodes, "Parameter verarbeiten", (node) => {
    let code = node.parameters.jsCode || "";
    code = code.replace(
      "const config = $('HTTP Request1').first().json;",
      "const ctx = $('HTTP Request1').first().json;\nconst config = ctx.config || ctx;\nconst reportId = ctx.reportId;",
    );
    code = code.replace(
      /return \{\s*\n\s*json: \{/,
      "return {\n  json: {\n    reportId,",
    );
    node.parameters.jsCode = code;
  });

  const markRunningNode = {
    id: randomUUID(),
    name: "DT Mark Running",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-528, 848],
    parameters: { mode: "runOnceForAllItems", jsCode: markRunningCode },
  };
  insertNodeAfter(nodes, connections, "HTTP Request1", markRunningNode);

  replaceNodeType(nodes, "SEO Cache: Status Done", (node) => {
    node.type = "n8n-nodes-base.code";
    node.typeVersion = 2;
    node.parameters = { mode: "runOnceForAllItems", jsCode: completeDoneCode };
    delete node.credentials;
  });

  replaceNodeType(nodes, "SEO Cache: Status Error", (node) => {
    node.type = "n8n-nodes-base.code";
    node.typeVersion = 2;
    node.parameters = { mode: "runOnceForAllItems", jsCode: completeErrorCode };
    delete node.credentials;
  });

  const cacheNode = nodes.find(
    (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      String(n.parameters?.url ?? "").includes("seo_cache"),
  );
  if (cacheNode) {
    removeNode(nodes, connections, cacheNode.name);
  }

  if (connections["Merge All Data"]?.main?.[0]) {
    connections["Merge All Data"].main[0] = connections["Merge All Data"].main[0].filter(
      (edge) => edge.node !== "HTTP Request",
    );
  }

  return {
    name: targetName,
    nodes,
    connections,
    settings: workflow.settings ?? { executionOrder: "v1" },
  };
}

async function findTargetWorkflow() {
  const data = await n8nFetch("/api/v1/workflows?limit=250");
  const rows = Array.isArray(data.data) ? data.data : data;
  return rows.find((w) => w.name === targetName) ?? null;
}

async function main() {
  const legacy = await n8nFetch(`/api/v1/workflows/${legacyWorkflowId}`);
  const payload = patchLegacyWorkflow(legacy);

  const existing = await findTargetWorkflow();
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: workflow.id,
        name: targetName,
        legacySourceId: legacyWorkflowId,
        webhookUrl: `${base}/webhook/dt-seo-report`,
        contextUrl: `${appBase}/api/dt/internal/seo-report/{reportId}/context`,
        nodeCount: payload.nodes.length,
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
