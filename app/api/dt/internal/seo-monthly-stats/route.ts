import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { createServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  aiClicks: z.number().int().min(0).default(0),
  totalClicks: z.number().int().min(0).default(0),
  impressions: z.number().int().min(0).default(0),
  rankingsTop10: z.number().int().min(0).default(0),
  rankingsTop3: z.number().int().min(0).default(0),
  visibilityIndex: z.number().nullable().optional(),
  rawData: z.record(z.string(), z.unknown()).optional(),
});

function normalizePeriodMonth(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return `${value}-01`;
}

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

  const supabase = createServiceClient();
  const periodMonth = normalizePeriodMonth(parsed.data.periodMonth);

  const { data, error } = await supabase
    .from("dt_seo_monthly_stats")
    .upsert(
      {
        organisation_id: parsed.data.organisationId,
        period_month: periodMonth,
        ai_clicks: parsed.data.aiClicks,
        total_clicks: parsed.data.totalClicks,
        impressions: parsed.data.impressions,
        rankings_top10: parsed.data.rankingsTop10,
        rankings_top3: parsed.data.rankingsTop3,
        visibility_index: parsed.data.visibilityIndex ?? null,
        raw_data: parsed.data.rawData ?? {},
      },
      { onConflict: "organisation_id,period_month" },
    )
    .select(
      "id,organisation_id,period_month,ai_clicks,total_clicks,impressions,rankings_top10,rankings_top3,visibility_index",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, stat: data });
}
