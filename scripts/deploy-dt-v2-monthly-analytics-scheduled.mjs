/**
 * Deploy "DT v2 - Monthly Analytics Scheduler" — cron + loop over seo_enabled orgs.
 * Usage: node scripts/deploy-dt-v2-monthly-analytics-scheduled.mjs
 */
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";
const dtSecret = process.env.DT_INTERNAL_WEBHOOK_SECRET || "";
const workflowName = "DT v2 - Monthly Analytics Scheduler";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error("Missing N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}

function buildSchedulerNodes() {
  const scheduleId = randomUUID();
  const loadOrgsId = randomUUID();
  const splitId = randomUUID();
  const triggerId = randomUUID();

  return {
    nodes: [
      {
        id: scheduleId,
        name: "Monthly Cron",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: { interval: [{ field: "cronExpression", expression: "0 3 1 * *" }] },
        },
      },
      {
        id: loadOrgsId,
        name: "Load SEO Orgs",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [280, 0],
        parameters: {
          url: `${appBase}/api/dt/internal/seo-orgs`,
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: "X-DT-Webhook-Secret", value: dtSecret }],
          },
          options: {},
        },
      },
      {
        id: splitId,
        name: "Split Orgs",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [560, 0],
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: `const orgs = $input.first().json.orgs ?? [];
return orgs.map((o) => ({ json: { organisationId: o.organisationId, slug: o.slug } }));`,
        },
      },
      {
        id: triggerId,
        name: "Trigger Monthly Collect",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [840, 0],
        parameters: {
          method: "POST",
          url: `${base}/webhook/dt-monthly-analytics`,
          sendBody: true,
          specifyBody: "json",
          jsonBody: "={{ JSON.stringify({ organisationId: $json.organisationId }) }}",
          options: {},
        },
      },
    ],
    connections: {
      "Monthly Cron": { main: [[{ node: "Load SEO Orgs", type: "main", index: 0 }]] },
      "Load SEO Orgs": { main: [[{ node: "Split Orgs", type: "main", index: 0 }]] },
      "Split Orgs": { main: [[{ node: "Trigger Monthly Collect", type: "main", index: 0 }]] },
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
  const { nodes, connections } = buildSchedulerNodes();
  const payload = { name: workflowName, nodes, connections, settings: { executionOrder: "v1" } };

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
        name: workflowName,
        cron: "0 3 1 * *",
        collectWebhook: `${base}/webhook/dt-monthly-analytics`,
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
