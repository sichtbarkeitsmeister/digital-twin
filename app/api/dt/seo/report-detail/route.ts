import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  formatSeoReportRawForTool,
  loadLatestDtSeoReportRawForOrg,
} from "@/lib/dt/seo/report-detail-tool";

export const maxDuration = 30;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
});

/**
 * On-demand full SEO report raw data for the n8n agent tool read_full_seo_report.
 * Token-light by design: returns payload.raw capped and without HTML.
 */
export async function POST(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const { organisationId } = parsed.data;

  try {
    const report = await loadLatestDtSeoReportRawForOrg(organisationId);
    const text = formatSeoReportRawForTool(report);

    return NextResponse.json({
      ok: true,
      found: report != null && report.payload?.raw != null,
      reportId: report?.id ?? null,
      report: text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
