import nextEnv from "@next/env";

nextEnv.loadEnvConfig("c:/DigitalTwinTest/with-supabase-app", false);

const base = process.env.N8N_BASE_URL;
const key = process.env.N8N_API_KEY;
const appBase = process.env.APP_BASE_URL || "http://localhost:3000";
const token = "xmZphR4E0QdGcg4yf9NPGp4qyRLXVUEulckc_r7KfIk";
const targetUrl = `${appBase.replace(/\/+$/, "")}/api/integrations/leadinfo/webhook/${token}`;
const workflowId = "qtWixHlD1bzy25Ft";

async function main() {
  const getRes = await fetch(`${base}/api/v1/workflows/${workflowId}`, {
    headers: { "X-N8N-API-KEY": key },
  });
  const current = await getRes.json();
  if (!getRes.ok) throw new Error(JSON.stringify(current));

  const httpNode =
    current.nodes.find((node) => node.name === "Forward to App") ??
    {
      id: crypto.randomUUID(),
      name: "Forward to App",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [280, 0],
    };

  httpNode.parameters = {
    method: "POST",
    url: targetUrl,
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ $json.body }}",
    options: {},
  };

  const webhookNode = current.nodes.find((node) => node.name === "Webhook");
  if (!webhookNode) throw new Error("Webhook node not found");

  const payload = {
    name: current.name,
    settings: current.settings ?? { executionOrder: "v1" },
    nodes: [webhookNode, httpNode],
    connections: {
      Webhook: {
        main: [[{ node: "Forward to App", type: "main", index: 0 }]],
      },
    },
  };

  const putRes = await fetch(`${base}/api/v1/workflows/${workflowId}`, {
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const updated = await putRes.json();
  if (!putRes.ok) throw new Error(JSON.stringify(updated));

  console.log(
    JSON.stringify(
      {
        ok: true,
        jsonBody: httpNode.parameters.jsonBody,
        targetUrl,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
