import { z } from "zod";

import { contentAgentJson } from "@/lib/dt/content/client";
import { demoPageRunThrough } from "@/lib/dt/content/fixtures";
import {
  contentError,
  contentFromAgent,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import type { ContentPageRunThroughResult } from "@/lib/dt/content/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  force: z.boolean().optional(),
});

export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!isValidContentSlug(slug)) return contentError("Ungültige Seite.", 400);

  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  if (!gate.config) {
    return contentOk(demoPageRunThrough(slug), true, 202);
  }

  return contentFromAgent(
    await contentAgentJson<ContentPageRunThroughResult>(
      gate.config,
      `/clients/${encodeURIComponent(gate.clientKey)}/pages/${encodeURIComponent(slug)}/run-through`,
      { method: "POST", body: parsed.data.force ? { force: true } : {} },
    ),
  );
}
