import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createServiceClient } from "@/lib/supabase/service";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Parameter." }, { status: 400 });
  }

  const days = parsed.data.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const service = createServiceClient();

  const { data: events, error } = await service
    .from("dt_llm_usage_events")
    .select("organisation_id,user_id,input_tokens,output_tokens,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const rows = events ?? [];

  let totalInput = 0;
  let totalOutput = 0;
  const byOrg = new Map<
    string,
    {
      orgId: string;
      messages: number;
      inputTokens: number;
      outputTokens: number;
      users: Set<string>;
    }
  >();
  const byDay = new Map<
    string,
    { date: string; messages: number; inputTokens: number; outputTokens: number }
  >();

  for (const row of rows) {
    const input = row.input_tokens ?? 0;
    const output = row.output_tokens ?? 0;
    totalInput += input;
    totalOutput += output;

    const dayKey = row.created_at.slice(0, 10);
    const day = byDay.get(dayKey) ?? {
      date: dayKey,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    day.messages += 1;
    day.inputTokens += input;
    day.outputTokens += output;
    byDay.set(dayKey, day);

    if (row.organisation_id) {
      const org = byOrg.get(row.organisation_id) ?? {
        orgId: row.organisation_id,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        users: new Set<string>(),
      };
      org.messages += 1;
      org.inputTokens += input;
      org.outputTokens += output;
      if (row.user_id) org.users.add(row.user_id);
      byOrg.set(row.organisation_id, org);
    }
  }

  const orgIds = [...byOrg.keys()];
  const { data: orgRows } = orgIds.length
    ? await service.from("organisations").select("id,name").in("id", orgIds)
    : { data: [] };

  const orgNameById = new Map((orgRows ?? []).map((o) => [o.id, o.name]));

  return NextResponse.json({
    ok: true,
    days,
    totals: {
      messages: rows.length,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      avgTokensPerMessage:
        rows.length > 0 ? Math.round((totalInput + totalOutput) / rows.length) : 0,
      activeOrgCount: byOrg.size,
    },
    byOrg: [...byOrg.values()]
      .map((o) => ({
        orgId: o.orgId,
        name: orgNameById.get(o.orgId) ?? o.orgId,
        messages: o.messages,
        inputTokens: o.inputTokens,
        outputTokens: o.outputTokens,
        totalTokens: o.inputTokens + o.outputTokens,
        userCount: o.users.size,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  });
}
