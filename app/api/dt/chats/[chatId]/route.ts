import { NextResponse } from "next/server";
import { z } from "zod";

import { loadDtAuthorProfiles } from "@/lib/dt/author-labels";
import { DT_CHAT_ATTACHMENTS_BUCKET, isSkippedStoragePath } from "@/lib/dt/attachments";
import { getDtChatOrNull, loadDtMessages, requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { buildChatParticipants } from "@/lib/dt/oversight";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  agentId: z.string().uuid().optional(),
});

export async function GET(_: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getDtChatOrNull(chatId);
  if (!chat) {
    return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });
  }

  if (chat.mode === "seo" && auth.userId) {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, chat.organisation_id);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const messages = await loadDtMessages(chatId);
  const platformAdmin = auth.userId
    ? await isPlatformAdmin(auth.supabase, auth.userId)
    : false;
  const showAuthors =
    chat.mode === "team" ||
    chat.mode === "seo" ||
    Boolean(chat.shared_to_team_at) ||
    platformAdmin;
  const authorIds = messages
    .map((m) => m.author_user_id)
    .filter((id): id is string => Boolean(id));
  const authorProfiles = showAuthors ? await loadDtAuthorProfiles(authorIds) : null;
  const authorLabels = authorProfiles?.labels ?? {};
  const participants = showAuthors
    ? buildChatParticipants(messages, authorLabels, authorProfiles?.emails ?? {})
    : [];
  const { data: attachRows } = await auth.supabase
    .from("dt_chat_attachments")
    .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const attachmentsWithUrls = await Promise.all(
    (attachRows ?? []).map(async (row) => {
      if (isSkippedStoragePath(row.storage_path)) {
        return { ...row, signed_url: null as string | null };
      }
      const { data, error } = await auth.supabase.storage
        .from(DT_CHAT_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      if (error) {
        console.warn("[dt] attachment signed url:", row.storage_path, error.message);
        return { ...row, signed_url: null };
      }
      return { ...row, signed_url: data.signedUrl };
    }),
  );

  let seoTasks: Array<{
    id: string;
    message_id: string | null;
    title: string;
    keyword: string | null;
    url: string | null;
    action: string | null;
  }> = [];
  if (chat.mode === "seo") {
    const { data: taskRows } = await auth.supabase
      .from("dt_seo_tasks")
      .select("id,message_id,title,keyword,url,action")
      .eq("organisation_id", chat.organisation_id);
    seoTasks = taskRows ?? [];
  }

  return NextResponse.json({
    ok: true,
    chat,
    messages,
    attachments: attachmentsWithUrls,
    authorLabels,
    participants,
    seoTasks,  });
}

export async function PATCH(req: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getDtChatOrNull(chatId);
  if (!chat) {
    return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });
  }

  if (chat.mode === "seo" && auth.userId) {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, chat.organisation_id);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.archived !== undefined) {
    patch.archived_at = parsed.data.archived ? new Date().toISOString() : null;
  }
  if (parsed.data.pinned !== undefined) patch.pinned = parsed.data.pinned;
  if (parsed.data.agentId !== undefined) {
    const { data: agent } = await auth.supabase
      .from("dt_agents")
      .select("id")
      .eq("id", parsed.data.agentId)
      .eq("organisation_id", chat.organisation_id)
      .eq("is_enabled", true)
      .maybeSingle();

    if (!agent) {
      return NextResponse.json(
        { ok: false, message: "Agent nicht verfügbar." },
        { status: 400 },
      );
    }

    patch.agent_id = parsed.data.agentId;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen übergeben." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("dt_chats")
    .update(patch)
    .eq("id", chatId)
    .select(
      "id,organisation_id,agent_id,mode,owner_user_id,title,archived_at,pinned,shared_to_team_at,created_at,updated_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: "Chat konnte nicht aktualisiert werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, chat: data });
}

export async function DELETE(_: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getDtChatOrNull(chatId);
  if (!chat) {
    return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });
  }

  if (chat.mode === "seo" && auth.userId) {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, chat.organisation_id);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  const { data: attachRows } = await auth.supabase
    .from("dt_chat_attachments")
    .select("storage_path")
    .eq("chat_id", chatId);

  const objectPaths =
    attachRows?.map((r) => r.storage_path).filter((p) => p && !isSkippedStoragePath(p)) ?? [];

  if (objectPaths.length > 0) {
    const rm = await auth.supabase.storage.from(DT_CHAT_ATTACHMENTS_BUCKET).remove(objectPaths);
    if (rm.error) console.warn("[dt] attachment storage cleanup", rm.error.message);
  }

  const { error } = await auth.supabase.from("dt_chats").delete().eq("id", chatId);
  if (error) {
    return NextResponse.json({ ok: false, message: "Chat konnte nicht gelöscht werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
