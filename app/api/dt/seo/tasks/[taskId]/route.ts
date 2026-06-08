import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { resolvePlatformAdminAssignee } from "@/lib/dt/seo/task-assignees";

async function gateTaskOrg(
  auth: Awaited<ReturnType<typeof requireAuthUser>> & { ok: true; userId: string },
  taskId: string,
) {
  const { data: task } = await auth.supabase
    .from("dt_seo_tasks")
    .select("organisation_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task?.organisation_id) return { ok: false as const, status: 404, message: "Aufgabe nicht gefunden." };
  return requireDtSeoAccess(auth.supabase, auth.userId, task.organisation_id);
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  url: z.string().max(2000).nullable().optional(),
  keyword: z.string().max(200).nullable().optional(),
  action: z.string().max(2000).nullable().optional(),
  status: z.enum(["open", "in_progress", "done", "wont_fix"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  assignedToLabel: z.string().max(120).nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  currentStatus: z.string().max(500).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { taskId } = await context.params;
  const gate = await gateTaskOrg(auth, taskId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.title !== undefined) patch.title = d.title;
  if (d.url !== undefined) patch.url = d.url;
  if (d.keyword !== undefined) patch.keyword = d.keyword;
  if (d.action !== undefined) patch.action = d.action;
  if (d.status !== undefined) {
    patch.status = d.status;
    patch.completed_at = d.status === "done" ? new Date().toISOString() : null;
  }
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.notes !== undefined) patch.notes = d.notes;
  if (d.currentStatus !== undefined) patch.current_status = d.currentStatus;
  if (d.dueAt !== undefined) patch.due_at = d.dueAt;
  if (d.assignedToLabel !== undefined) patch.assigned_to_label = d.assignedToLabel;

  if (d.assignedToUserId !== undefined) {
    if (d.assignedToUserId === null) {
      patch.assigned_to_user_id = null;
      patch.assigned_to_label = null;
    } else {
      const assignee = await resolvePlatformAdminAssignee(d.assignedToUserId);
      if (!assignee.ok) {
        return NextResponse.json({ ok: false, message: assignee.message }, { status: 400 });
      }
      patch.assigned_to_user_id = d.assignedToUserId;
      patch.assigned_to_label = assignee.email;
    }
  }

  const { data, error } = await auth.supabase
    .from("dt_seo_tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Update fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, task: data });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { taskId } = await context.params;
  const gate = await gateTaskOrg(auth, taskId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { error } = await auth.supabase.from("dt_seo_tasks").delete().eq("id", taskId);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
