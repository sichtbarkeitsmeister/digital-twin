import { contentAgentJson } from "@/lib/dt/content/client";
import { demoQuestions } from "@/lib/dt/content/fixtures";
import { contentFromAgent, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import type { ContentQuestionsResult } from "@/lib/dt/content/types";

export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!gate.config) {
    return contentOk(demoQuestions(), true);
  }

  return contentFromAgent(
    await contentAgentJson<ContentQuestionsResult>(
      gate.config,
      `/clients/${encodeURIComponent(gate.clientKey)}/questions`,
    ),
  );
}
