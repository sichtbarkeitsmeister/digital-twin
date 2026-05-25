import { createServiceClient } from "@/lib/supabase/service";

import type { EnqueueJobInput, JobRow } from "./types";

/**
 * Enqueue a job. Idempotent when `dedupeKey` is provided: if a non-terminal
 * job with the same (kind, dedupe_key) already exists, the call is a no-op.
 */
export async function enqueueJob(
  input: EnqueueJobInput,
): Promise<{ ok: true; jobId: string | null } | { ok: false; error: string }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      kind: input.kind,
      organisation_id: input.organisationId ?? null,
      payload: input.payload ?? {},
      dedupe_key: input.dedupeKey ?? null,
      run_after: (input.runAfter ?? new Date()).toISOString(),
      max_attempts: input.maxAttempts ?? 5,
    })
    .select("id")
    .single();

  if (error) {
    if (
      error.code === "23505" ||
      /jobs_dedupe_active_idx/i.test(error.message)
    ) {
      return { ok: true, jobId: null };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, jobId: data?.id ?? null };
}

export async function fetchJob(jobId: string): Promise<JobRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) return null;
  return (data as JobRow | null) ?? null;
}
