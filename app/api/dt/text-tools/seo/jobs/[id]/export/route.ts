import { contentExportFile, contentExportResponse, isContentExportFormat } from "@/lib/dt/content/export";
import { contentError, gateContentRoute, isValidContentJobId } from "@/lib/dt/content/route-helpers";
import { slugify } from "@/lib/dt/content/render";
import { SEO_TOOL_JOB_KIND, seoToolJobFromRow } from "@/lib/dt/text-tools/seo";

/** The finished SEO text as a download, same formats and rendering as the Texte page export. */
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
    .eq("kind", SEO_TOOL_JOB_KIND)
    .maybeSingle();
  if (!data) return contentError("Durchlauf nicht gefunden.", 404);

  const job = seoToolJobFromRow({ status: data.status as string, result: data.result, last_error: (data.last_error as string | null) ?? null });
  if (job.state !== "done" || !job.result?.html) return contentError("Für diesen Durchlauf gibt es noch keinen Text.", 404);

  const { result } = job;
  const base = result.page_name || "seo";
  return contentExportResponse(
    contentExportFile(format, {
      slug: `${slugify(base) || "seo"}-seo`,
      title: result.title || result.page_name,
      html: result.html,
    }),
  );
}
