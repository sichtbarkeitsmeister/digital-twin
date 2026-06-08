import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  computeSeoStatsSummary,
  loadDtSeoMonthlyStats,
} from "@/lib/dt/seo/monthly-stats";

const querySchema = z.object({
  org: z.string().uuid(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const rows = await loadDtSeoMonthlyStats(auth.supabase, parsed.data.org, 12);
  const summary = computeSeoStatsSummary(rows);

  return NextResponse.json({
    ok: true,
    stats: rows,
    summary: {
      latest: summary.latest,
      aiClicksMomPct: summary.aiClicksMomPct,
      chart: summary.chart,
      topKeywords: summary.topKeywords,
    },
  });
}
