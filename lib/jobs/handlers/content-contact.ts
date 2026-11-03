import { runContactDataJob } from "@/lib/dt/contact-data-fill";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/**
 * Kontaktdaten after a finished crawl (kind: content.contact): fill the empty and crawl-filled
 * fields from the Impressum, Kontakt and Startseite, then look for the Google-Profil once if
 * the website has no link to it. Payload: { organisationId: uuid, userId: uuid | null }.
 */
export const contentContactHandler: JobHandler = async ({ job }) => {
  const payload = job.payload as { organisationId?: string; userId?: string | null };
  let service;
  try {
    service = createServiceClient();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true };
  }
  return runContactDataJob(service, { organisationId: payload.organisationId ?? job.organisation_id ?? undefined, userId: payload.userId ?? null });
};
