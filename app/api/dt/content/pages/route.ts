import { z } from "zod";

import { contentError, contentOk, gateContentRoute, loadContentReadiness, readJsonBody } from "@/lib/dt/content/route-helpers";
import {
  buildOverview,
  loadContentPages,
  syncContentPagesFromStructure,
  upsertManualContentPages,
} from "@/lib/dt/content/store";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  pages: z
    .array(
      z.object({
        name: z.string().max(300),
        keyword: z.string().max(300).optional(),
      }),
    )
    .max(300),
});

/** Typed page list: insert new slugs, leave pages that already exist untouched. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte mindestens einen Seitennamen eintragen.", 400);

  const pages = parsed.data.pages
    .map((page) => ({ name: page.name.trim(), keyword: page.keyword?.trim() || null }))
    .filter((page) => page.name);
  if (pages.length === 0) return contentError("Bitte mindestens einen Seitennamen eintragen.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    await syncContentPagesFromStructure(gate.service, gate.organisationId).catch(() => null);
    await upsertManualContentPages(gate.service, gate.organisationId, pages);
    const [{ readiness }, rows] = await Promise.all([
      loadContentReadiness(gate.service, gate.organisationId),
      loadContentPages(gate.service, gate.organisationId),
    ]);
    return contentOk(buildOverview(readiness, rows));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seiten konnten nicht gespeichert werden.";
    return contentError(message, 500);
  }
}
