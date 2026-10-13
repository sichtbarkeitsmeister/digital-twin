import { contentError, contentOk, gateContentRoute, isValidContentJobId } from "@/lib/dt/content/route-helpers";
import { WATERMARK_TOOL_JOB_KIND, watermarkToolJobFromRow } from "@/lib/dt/text-tools/watermark";

/** Status, progress („4 von 11 Abschnitten“) and result of one run; the page polls this until `done` or `error`. */
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
    .eq("kind", WATERMARK_TOOL_JOB_KIND)
    .maybeSingle();
  if (!data) return contentError("Durchlauf nicht gefunden.", 404);

  return contentOk(
    watermarkToolJobFromRow({
      status: data.status as string,
      result: data.result,
      last_error: (data.last_error as string | null) ?? null,
    }),
  );
}
