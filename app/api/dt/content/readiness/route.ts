import { contentAgentJson } from "@/lib/dt/content/client";
import { demoReadiness } from "@/lib/dt/content/fixtures";
import { loadContentLocalSources } from "@/lib/dt/content/load-sources";
import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import type { ContentReadiness } from "@/lib/dt/content/types";

export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const local = await loadContentLocalSources(gate.supabase, gate.organisationId);

  if (!gate.config) {
    return contentOk({ readiness: demoReadiness(local), local }, true);
  }

  const result = await contentAgentJson<ContentReadiness>(
    gate.config,
    `/clients/${encodeURIComponent(gate.clientKey)}/readiness`,
  );
  if (!result.ok) return contentError(result.message, result.status >= 400 ? result.status : 502);
  return contentOk({ readiness: result.data, local }, false);
}
