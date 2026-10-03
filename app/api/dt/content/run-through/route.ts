import { z } from "zod";

import { contentAgentJson } from "@/lib/dt/content/client";
import { demoRunThrough } from "@/lib/dt/content/fixtures";
import {
  contentError,
  contentFromAgent,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import type { ContentRunThroughResult } from "@/lib/dt/content/types";

const bodySchema = z.union([
  z.object({
    organisationId: z.string().uuid(),
    pages: z.array(z.string().refine(isValidContentSlug)).min(1).max(500),
  }),
  z.object({
    organisationId: z.string().uuid(),
    all: z.literal(true),
  }),
]);

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte mindestens eine Seite auswählen.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const payload = "all" in parsed.data ? { all: true as const } : { pages: parsed.data.pages };

  if (!gate.config) {
    return contentOk(demoRunThrough(payload), true, 202);
  }

  return contentFromAgent(
    await contentAgentJson<ContentRunThroughResult>(
      gate.config,
      `/clients/${encodeURIComponent(gate.clientKey)}/run-through`,
      { method: "POST", body: payload },
    ),
  );
}
