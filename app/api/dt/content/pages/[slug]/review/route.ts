import { contentAgentJson } from "@/lib/dt/content/client";
import { demoReview } from "@/lib/dt/content/fixtures";
import {
  contentError,
  contentFromAgent,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
} from "@/lib/dt/content/route-helpers";
import type { ContentReview } from "@/lib/dt/content/types";

export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!gate.config) {
    const review = demoReview(slug);
    return review ? contentOk(review, true) : contentError("Seite nicht gefunden.", 404);
  }

  return contentFromAgent(
    await contentAgentJson<ContentReview>(
      gate.config,
      `/clients/${encodeURIComponent(gate.clientKey)}/pages/${encodeURIComponent(slug)}/review`,
    ),
  );
}
