import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  resolveTimeEntryEmails,
  toTimeEntryViews,
  totalTrackedSeconds,
} from "@/lib/dt/seo/task-time";
import type { DtSeoTaskTimeEntryRow } from "@/lib/dt/types";

async function gateTaskOrg(
  auth: Awaited<ReturnType<typeof requireAuthUser>> & { ok: true; userId: string },
  taskId: string,
) {
  const { data: task } = await auth.supabase
    .from("dt_seo_tasks")
    .select("organisation_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task?.organisation_id) {
    return { ok: false as const, status: 404, message: "Aufgabe nicht gefunden." };
  }
  return requireDtSeoAccess(auth.supabase, auth.userId, task.organisation_id);
}

async function loadEntriesPayload(
  auth: Awaited<ReturnType<typeof requireAuthUser>> & { ok: true; userId: string },
  taskId: string,
) {
  const { data, error } = await auth.supabase
    .from("dt_seo_task_time_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(error.message);

  const entries = (data ?? []) as DtSeoTaskTimeEntryRow[];
  const emailById = await resolveTimeEntryEmails(entries.map((e) => e.user_id));
  const views = toTimeEntryViews(entries, emailById);
  const myRunning = views.find((v) => v.userId === auth.userId && v.endedAt === null) ?? null;

  return {
    entries: views,
    totalSeconds: totalTrackedSeconds(entries),
    myRunningEntry: myRunning,
  };
}

export async function GET(_req: Request, context: { params: Promise<{ taskId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { taskId } = await context.params;
  const gate = await gateTaskOrg(auth, taskId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  try {
    const payload = await loadEntriesPayload(auth, taskId);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Laden fehlgeschlagen." },
      { status: 500 },
    );
  }
}

const postSchema = z.object({
  action: z.enum(["start", "stop"]),
});

const RPC_ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  not_authenticated: { status: 401, message: "Nicht angemeldet." },
  task_not_found: { status: 404, message: "Aufgabe nicht gefunden." },
  forbidden: { status: 403, message: "Kein Zugriff auf diese Organisation." },
  no_running_timer: { status: 409, message: "Es läuft kein Timer für diese Aufgabe." },
};

export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { taskId } = await context.params;
  const gate = await gateTaskOrg(auth, taskId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  }

  const rpc = parsed.data.action === "start" ? "dt_start_task_timer" : "dt_stop_task_timer";
  const { error } = await auth.supabase.rpc(rpc, { p_task_id: taskId });

  if (error) {
    const mapped = RPC_ERROR_MESSAGES[error.message];
    if (mapped) {
      return NextResponse.json({ ok: false, message: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json(
      { ok: false, message: error.message || "Timer-Aktion fehlgeschlagen." },
      { status: 500 },
    );
  }

  try {
    const payload = await loadEntriesPayload(auth, taskId);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Laden fehlgeschlagen." },
      { status: 500 },
    );
  }
}
