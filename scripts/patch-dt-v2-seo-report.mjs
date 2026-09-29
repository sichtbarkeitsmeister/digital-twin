/**
 * Patch the existing "DT v2 - SEO Report" workflow in place.
 * Does not clone from the legacy workflow.
 *
 * - If GSC compares the full ads@ address (otherwise the false output is ads2).
 * - Format Report only strips a short duplicate header, not the whole HTML body.
 * - SEO Cache: Status Done stores an error when Claude returned no HTML.
 *
 * Usage: node scripts/patch-dt-v2-seo-report.mjs
 */
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { patchDtV2SeoReportNodes } from "./n8n/patch-dt-v2-seo-report-nodes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root, false);

const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "";
const dtSecret = process.env.DT_INTERNAL_WEBHOOK_SECRET || "";
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

async function findTargetWorkflow() {
  const data = await n8nFetch("/api/v1/workflows?limit=250");
  const rows = Array.isArray(data.data) ? data.data : data;
  return rows.find((w) => w.name === targetName) ?? null;
}

async function main() {
  const existing = await findTargetWorkflow();
  if (!existing) {
    throw new Error(`Workflow „${targetName}“ nicht gefunden.`);
  }
  const workflow = await n8nFetch(`/api/v1/workflows/${existing.id}`);
  const nodes = structuredClone(workflow.nodes);
  const patched = patchDtV2SeoReportNodes(nodes, {
    completeDoneCode: loadSnippet("dt-v2-seo-report-complete-done.js"),
  });
  if (!patched.ifGsc || !patched.statusDone) {
    throw new Error(`Patch unvollständig: ${JSON.stringify(patched)}`);
  }
  if (!patched.formatReport) {
    console.warn(
      "Format Report: Header-Regex nicht gefunden — Knoten unverändert gelassen.",
    );
  }

  const payload = {
    name: workflow.name,
    nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? { executionOrder: "v1" },
  };
  await n8nFetch(`/api/v1/workflows/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  await n8nFetch(`/api/v1/workflows/${existing.id}/activate`, { method: "POST" });

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: existing.id,
        name: targetName,
        patched,
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
