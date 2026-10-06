import { contentError, contentOk, gateContentRoute, isValidContentJobId } from "@/lib/dt/content/route-helpers";
import type { ContentJob } from "@/lib/dt/content/types";

/** Maps a `jobs` row to the three states the drawer polls for. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidContentJobId(id)) return contentError("Ungültige Job-ID.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const { data } = await gate.service
    .from("jobs")
    .select("id, status, result, last_error, organisation_id")
    .eq("id", id)
    .eq("organisation_id", gate.organisationId)
    .maybeSingle();
  if (!data) return contentError("Job nicht gefunden.", 404);

  const status = data.status as string;
  const job: ContentJob =
    status === "succeeded"
      ? { state: "done", result: data.result ?? null, error: null }
      : status === "dead"
        ? { state: "error", result: data.result ?? null, error: (data.last_error as string | null) ?? "Der Durchlauf ist fehlgeschlagen." }
        : { state: "running", result: data.result ?? null, error: null };
  return contentOk(job);
}
