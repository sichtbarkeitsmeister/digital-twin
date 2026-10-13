import { contentError, contentOk, gateContentRoute, isValidContentJobId } from "@/lib/dt/content/route-helpers";
import { SEO_TOOL_JOB_KIND, seoToolJobFromRow } from "@/lib/dt/text-tools/seo";

/** Status and result of one SEO run; the page polls this until `done` or `error`. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isValidContentJobId(id)) return contentError("Ungültige Job-ID.", 400);

  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const { data } = await gate.service
    .from("jobs")
    .select("id, kind, status, result, last_error")
    .eq("id", id)
    .eq("organisation_id", gate.organisationId)
    .eq("kind", SEO_TOOL_JOB_KIND)
    .maybeSingle();
  if (!data) return contentError("Durchlauf nicht gefunden.", 404);

  return contentOk(
    seoToolJobFromRow({
      status: data.status as string,
      result: data.result,
      last_error: (data.last_error as string | null) ?? null,
    }),
  );
}
