import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  seoTaskProposalFingerprint,
  seoTaskRowFingerprint,
} from "@/lib/dt/seo/chat-task-proposals";
import { resolveUserAssigneeLabel } from "@/lib/dt/seo/task-assignees";

const querySchema = z.object({
  org: z.string().uuid(),
});

const createSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  url: z.string().max(2000).nullable().optional(),
  keyword: z.string().max(200).nullable().optional(),
  currentStatus: z.string().max(500).nullable().optional(),
  action: z.string().max(2000).nullable().optional(),
  chatId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  status: z.enum(["open", "in_progress", "done", "wont_fix"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  assignToSelf: z.boolean().optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId!, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { data, error } = await auth.supabase
    .from("dt_seo_tasks")
    .select("*")
    .eq("organisation_id", parsed.data.org)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tasks: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const gate = await requireDtSeoAccess(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const proposalFingerprint = seoTaskProposalFingerprint({
    title: parsed.data.title,
    keyword: parsed.data.keyword ?? null,
    url: parsed.data.url ?? null,
    current_status: parsed.data.currentStatus ?? null,
    action: parsed.data.action ?? parsed.data.title,
    priority: parsed.data.priority ?? null,
  });

  const { data: orgTasks } = await auth.supabase
    .from("dt_seo_tasks")
    .select("*")
    .eq("organisation_id", parsed.data.organisationId);

  const duplicate = (orgTasks ?? []).find(
    (task) => seoTaskRowFingerprint(task) === proposalFingerprint,
  );
  if (duplicate) {
    return NextResponse.json({ ok: true, task: duplicate, alreadyExists: true });
  }

  let assignedToUserId: string | null = null;
  let assignedToLabel: string | null = null;
  if (parsed.data.assignToSelf !== false) {
    const assignee = await resolveUserAssigneeLabel(auth.userId);
    if (assignee.ok) {
      assignedToUserId = auth.userId;
      assignedToLabel = assignee.email;
    }
  }

  const { data, error } = await auth.supabase
    .from("dt_seo_tasks")
    .insert({
      organisation_id: parsed.data.organisationId,
      title: parsed.data.title,
      url: parsed.data.url ?? null,
      keyword: parsed.data.keyword ?? null,
      current_status: parsed.data.currentStatus ?? null,
      action: parsed.data.action ?? null,
      chat_id: parsed.data.chatId ?? null,
      message_id: parsed.data.messageId ?? null,
      status: parsed.data.status ?? "open",
      priority: parsed.data.priority ?? null,
      notes: parsed.data.notes ?? null,
      assigned_to_user_id: assignedToUserId,
      assigned_to_label: assignedToLabel,
      created_by_user_id: auth.userId,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Aufgabe konnte nicht erstellt werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, task: data });
}
