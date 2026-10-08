import type { SupabaseClient } from "@supabase/supabase-js";

import { reconcileContentPages } from "@/lib/dt/content/pipeline/health";
import { loadContentReadiness } from "@/lib/dt/content/route-helpers";
import {
  buildOverview,
  loadContentPages,
  loadContentStepsForPages,
  syncContentPagesFromStructure,
  type ContentPageExtra,
} from "@/lib/dt/content/store";
import type { ContentOverview } from "@/lib/dt/content/types";

/**
 * The table the Texte tab polls: pages synced from the Seitenstruktur, stale running pages
 * repaired, and for the pages still running what their job is doing right now.
 */
export async function loadContentOverview(service: SupabaseClient, organisationId: string): Promise<ContentOverview> {
  await syncContentPagesFromStructure(service, organisationId);
  const [{ readiness }, rows] = await Promise.all([
    loadContentReadiness(service, organisationId),
    loadContentPages(service, organisationId),
  ]);
  const { pages, verdicts } = await reconcileContentPages(service, rows);
  const running = pages.filter((p) => p.state === "laeuft").map((p) => p.id);
  const steps = await loadContentStepsForPages(service, running);
  const extras = new Map<string, ContentPageExtra>(
    running.map((id) => [id, { steps: steps.get(id) ?? [], verdict: verdicts.get(id) ?? null }]),
  );
  return buildOverview(readiness, pages, extras);
}
