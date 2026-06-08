/**
 * One-off: list GSC properties visible to n8n OAuth credentials.
 * Usage: node scripts/n8n-list-gsc-sites.mjs
 */
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const workflowName = "DT TEMP - List GSC Sites";

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

const credArg = process.argv[2] === "ads2" ? gscCredsAds2 : gscCredsAds;
const credLabel = process.argv[2] === "ads2" ? "ads2@" : "ads@";

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
  const webhookId = randomUUID();
  const httpId = randomUUID();
  const whPath = `dt-temp-gsc-sites-${randomUUID().slice(0, 8)}`;
  const nodes = [
    {
      id: webhookId,
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: randomUUID(),
      parameters: {
        path: whPath,
        httpMethod: "GET",
        responseMode: "lastNode",
        options: {},
      },
    },
    {
      id: httpId,
      name: `List GSC Sites ${credLabel}`,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [260, 0],
      credentials: credArg,
      parameters: {
        url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "googleSearchConsoleOAuth2Api",
        options: {},
      },
    },
  ];
  const connections = {
    Webhook: { main: [[{ node: `List GSC Sites ${credLabel}`, type: "main", index: 0 }]] },
  };

  const list = await n8nFetch("/api/v1/workflows?limit=250");
  const rows = Array.isArray(list.data) ? list.data : list;
  const existing = rows.find((w) => w.name === workflowName);
  if (existing) await n8nFetch(`/api/v1/workflows/${existing.id}`, { method: "DELETE" });

  const created = await n8nFetch("/api/v1/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: workflowName,
      nodes,
      connections,
      settings: { executionOrder: "v1" },
    }),
  });

  await n8nFetch(`/api/v1/workflows/${created.id}/activate`, { method: "POST" });

  const hookRes = await fetch(`${base}/webhook/${whPath}`);
  const hookJson = await hookRes.json().catch(() => null);
  const sites = hookJson?.siteEntry ?? [];
  const urls = sites.map((s) => s.siteUrl ?? s).filter(Boolean);
  const sm = urls.filter((u) => /sichtbar/i.test(u));

  await n8nFetch(`/api/v1/workflows/${created.id}`, { method: "DELETE" });

  if (!hookRes.ok) {
    console.error("GSC list failed:", hookRes.status, hookJson);
    process.exit(1);
  }

  console.log(JSON.stringify({ total: urls.length, sichtbarkeitsmeister: sm, all: urls.sort() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
