/**
 * Deploy "DT v2 - SEO Report Scheduler" — monthly cron for all ready SEO orgs.
 * Runs after monthly analytics (03:00) at 04:00 on the 1st.
 *
 * Usage: node scripts/deploy-dt-v2-seo-report-scheduled.mjs
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
const workflowName = "DT v2 - SEO Report Scheduler";

if (!base || !apiKey || !appBase || !dtSecret) {
  console.error("Missing N8N_BASE_URL, N8N_API_KEY, APP_BASE_URL, or DT_INTERNAL_WEBHOOK_SECRET");
  process.exit(1);
}

function buildSchedulerNodes() {
  const scheduleId = randomUUID();
  const runId = randomUUID();

  return {
    nodes: [
      {
        id: scheduleId,
        name: "Monthly Cron",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          // 04:00 UTC on the 1st — after analytics collect at 03:00
          rule: { interval: [{ field: "cronExpression", expression: "0 4 1 * *" }] },
        },
      },
      {
        id: runId,
        name: "Queue Monthly SEO Reports",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [280, 0],
        parameters: {
          method: "POST",
          url: `${appBase}/api/dt/internal/seo-reports/queue`,
          sendHeaders: true,
          headerParameters: {
            parameters: [{ name: "X-DT-Webhook-Secret", value: dtSecret }],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: JSON.stringify({
            sendToOwner: true,
            recipientType: "kunde",
            triggerSource: "monthly_scheduler",
            dedupeMonthly: true,
          }),
          options: {
            timeout: 600_000,
          },
        },
      },
    ],
    connections: {
      "Monthly Cron": {
        main: [[{ node: "Queue Monthly SEO Reports", type: "main", index: 0 }]],
      },
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
        workflowId: workflow.id,
        name: workflowName,
        cron: "0 4 1 * *",
        queueUrl: `${appBase}/api/dt/internal/seo-reports/queue`,
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
