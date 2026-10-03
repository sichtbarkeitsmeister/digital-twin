import { contentAgentJson } from "@/lib/dt/content/client";
import { demoJob } from "@/lib/dt/content/fixtures";
import {
  contentError,
  contentFromAgent,
  contentOk,
  gateContentRoute,
  isValidContentJobId,
} from "@/lib/dt/content/route-helpers";
import type { ContentJob } from "@/lib/dt/content/types";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidContentJobId(id)) return contentError("Ungültige Job-ID.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!gate.config) {
    return contentOk(demoJob(), true);
  }

  return contentFromAgent(
    await contentAgentJson<ContentJob>(gate.config, `/jobs/${encodeURIComponent(id)}`),
  );
}
