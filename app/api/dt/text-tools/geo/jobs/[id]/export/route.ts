import { contentExportFile, contentExportResponse, isContentExportFormat } from "@/lib/dt/content/export";
import { contentError, gateContentRoute, isValidContentJobId } from "@/lib/dt/content/route-helpers";
import { slugify } from "@/lib/dt/content/render";
import { GEO_TOOL_JOB_KIND, geoToolJobFromRow } from "@/lib/dt/text-tools/geo";

/** The finished GEO text as a download, same formats and rendering as the Texte page export. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidContentJobId(id)) return contentError("Ungültige Job-ID.", 400);

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "html";
  if (!isContentExportFormat(format)) return contentError("Unbekanntes Format.", 400);

  const gated = await gateContentRoute(url.searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const { data } = await gate.service
    .from("jobs")
    .select("id, status, result, last_error")
    .eq("id", id)
    .eq("organisation_id", gate.organisationId)
    .eq("kind", GEO_TOOL_JOB_KIND)
    .maybeSingle();
  if (!data) return contentError("Durchlauf nicht gefunden.", 404);

  const job = geoToolJobFromRow({ status: data.status as string, result: data.result, last_error: (data.last_error as string | null) ?? null });
  if (job.state !== "done" || !job.result?.html) return contentError("Für diesen Durchlauf gibt es noch keinen Text.", 404);

  const { result } = job;
  const base = result.page_name || result.file_name.replace(/\.[a-z0-9]+$/i, "") || "geo";
  return contentExportResponse(
    contentExportFile(format, {
      slug: `${slugify(base) || "geo"}-geo`,
      title: result.title || result.page_name || base,
      html: result.html,
    }),
  );
}
