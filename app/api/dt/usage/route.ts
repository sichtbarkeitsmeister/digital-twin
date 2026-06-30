import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { canViewDtUsage } from "@/lib/dt/usage/access";
import { createServiceClient } from "@/lib/supabase/service";

const querySchema = z.object({
  org: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org"),
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await canViewDtUsage(auth.supabase, auth.userId, parsed.data.org);
  if (!gate) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const days = parsed.data.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const orgId = parsed.data.org;
  const service = createServiceClient();

  const { data: events, error } = await service
    .from("dt_llm_usage_events")
    .select(
      "id,user_id,chat_id,agent_id,mode,via,model,input_tokens,output_tokens,created_at",
    )
    .eq("organisation_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const rows = events ?? [];
  const chatIds = [...new Set(rows.map((r) => r.chat_id).filter(Boolean))] as string[];
  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))] as string[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];

  const [{ data: chats }, { data: agents }, { data: profiles }] = await Promise.all([
    chatIds.length
      ? service.from("dt_chats").select("id,title,mode").in("id", chatIds)
      : Promise.resolve({ data: [] }),
    agentIds.length
      ? service.from("dt_agents").select("id,name").in("id", agentIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? service.from("profiles").select("id,email").in("id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const chatById = new Map((chats ?? []).map((c) => [c.id, c]));
  const agentById = new Map((agents ?? []).map((a) => [a.id, a]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  let totalInput = 0;
  let totalOutput = 0;
  const byUser = new Map<
    string,
    { userId: string; messages: number; inputTokens: number; outputTokens: number; chats: Set<string> }
  >();
  const byAgent = new Map<string, { agentId: string; messages: number; inputTokens: number; outputTokens: number }>();
  const byMode = new Map<string, { mode: string; messages: number; inputTokens: number; outputTokens: number }>();
  const byDay = new Map<
    string,
    { date: string; messages: number; inputTokens: number; outputTokens: number }
  >();

  for (const row of rows) {
    totalInput += row.input_tokens ?? 0;
    totalOutput += row.output_tokens ?? 0;

    const dayKey = row.created_at.slice(0, 10);
    const day = byDay.get(dayKey) ?? {
      date: dayKey,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    day.messages += 1;
    day.inputTokens += row.input_tokens ?? 0;
    day.outputTokens += row.output_tokens ?? 0;
    byDay.set(dayKey, day);

    if (row.user_id) {
      const u = byUser.get(row.user_id) ?? {
        userId: row.user_id,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        chats: new Set<string>(),
      };
      u.messages += 1;
      u.inputTokens += row.input_tokens ?? 0;
      u.outputTokens += row.output_tokens ?? 0;
      if (row.chat_id) u.chats.add(row.chat_id);
      byUser.set(row.user_id, u);
    }

    if (row.agent_id) {
      const a = byAgent.get(row.agent_id) ?? {
        agentId: row.agent_id,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      a.messages += 1;
      a.inputTokens += row.input_tokens ?? 0;
      a.outputTokens += row.output_tokens ?? 0;
      byAgent.set(row.agent_id, a);
    }

    const modeKey = row.mode ?? "unknown";
    const m = byMode.get(modeKey) ?? { mode: modeKey, messages: 0, inputTokens: 0, outputTokens: 0 };
    m.messages += 1;
    m.inputTokens += row.input_tokens ?? 0;
    m.outputTokens += row.output_tokens ?? 0;
    byMode.set(modeKey, m);
  }

  const recent = rows.slice(0, 40).map((row) => {
    const chat = row.chat_id ? chatById.get(row.chat_id) : null;
    const agent = row.agent_id ? agentById.get(row.agent_id) : null;
    const profile = row.user_id ? profileById.get(row.user_id) : null;
    return {
      id: row.id,
      at: row.created_at,
      userId: row.user_id,
      userLabel: profile?.email || row.user_id || "Unbekannt",
      chatId: row.chat_id,
      chatTitle: chat?.title ?? null,
      chatMode: chat?.mode ?? row.mode,
      agentName: agent?.name ?? null,
      via: row.via,
      model: row.model,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
    };
  });

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
    },
    byUser: [...byUser.values()]
      .map((u) => {
        const profile = profileById.get(u.userId);
        return {
          userId: u.userId,
          label: profile?.email || u.userId,
          email: profile?.email ?? null,
          messages: u.messages,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          totalTokens: u.inputTokens + u.outputTokens,
          chatCount: u.chats.size,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byAgent: [...byAgent.values()]
      .map((a) => {
        const agent = agentById.get(a.agentId);
        return {
          agentId: a.agentId,
          name: agent?.name ?? a.agentId,
          messages: a.messages,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          totalTokens: a.inputTokens + a.outputTokens,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byMode: [...byMode.values()]
      .map((m) => ({
        ...m,
        totalTokens: m.inputTokens + m.outputTokens,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recent,
  });
}
