import { NextResponse } from "next/server";
import { z } from "zod";

import { AI_CHAT_ATTACHMENTS_BUCKET, isSkippedStoragePath } from "@/lib/ai/chat-attachments";
import { requireAuthUser, getChatOrNull } from "@/lib/ai/chat-db";
import { SURVEY_AI_MAX_ASSISTANT_RULES_CHARS } from "@/lib/settings/survey-ai-server";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
  assistantRules: z.string().max(SURVEY_AI_MAX_ASSISTANT_RULES_CHARS).optional(),
});

function extractSurveyIdFromProposal(proposal: unknown) {
  if (!proposal || typeof proposal !== "object") return null;
  const candidate = (proposal as { surveyId?: unknown }).surveyId;
  return typeof candidate === "string" ? candidate : null;
}

export async function GET(_: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }
  const { chatId } = await context.params;
  const chat = await getChatOrNull(chatId, auth.userId);
  if (!chat) return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });

  const { data: messages } = await auth.supabase
    .from("ai_chat_messages")
    .select("id,chat_id,role,content,metadata,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const { data: actions } = await auth.supabase
    .from("ai_chat_actions")
    .select("id,chat_id,message_id,proposal_kind,proposal_json,execution_status,execution_result,revert_payload,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const surveyIds = Array.from(
    new Set(
      (actions ?? [])
        .map((a) => extractSurveyIdFromProposal(a.proposal_json))
        .filter((v): v is string => Boolean(v)),
    ),
  );
  let surveyTitleById = new Map<string, string>();
  if (surveyIds.length > 0) {
    const { data: surveys } = await auth.supabase
      .from("surveys")
      .select("id,title")
      .in("id", surveyIds)
      .is("deleted_at", null);
    surveyTitleById = new Map((surveys ?? []).map((s) => [s.id, s.title]));
  }

  const { data: attachments } = await auth.supabase
    .from("ai_chat_attachments")
    .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const attachmentsWithSignedUrls = await Promise.all(
    (attachments ?? []).map(async (row) => {
      if (isSkippedStoragePath(row.storage_path)) {
        return { ...row, signed_url: null as string | null };
      }
      const { data, error } = await auth.supabase.storage
        .from(AI_CHAT_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      if (error) {
        console.warn("ai_chat_attachment signed url:", row.storage_path, error.message);
        return { ...row, signed_url: null };
      }
      return { ...row, signed_url: data.signedUrl };
    }),
  );

  return NextResponse.json({
    ok: true,
    chat,
    messages: messages ?? [],
    actions: (actions ?? []).map((a) => {
      const surveyId = extractSurveyIdFromProposal(a.proposal_json);
      return {
        ...a,
        proposal_survey_id: surveyId,
        proposal_survey_title: surveyId ? surveyTitleById.get(surveyId) ?? null : null,
      };
    }),
    attachments: attachmentsWithSignedUrls,
  });
}

export async function PATCH(req: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }
  const { chatId } = await context.params;
  const chat = await getChatOrNull(chatId, auth.userId);
  if (!chat) return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });

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
  if (parsed.data.assistantRules !== undefined) patch.assistant_rules = parsed.data.assistantRules;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen übergeben." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("ai_chats")
    .update(patch)
    .eq("id", chatId)
    .eq("user_id", auth.userId)
    .select("id,title,archived_at,assistant_rules,created_at,updated_at")
    .single();
  if (error || !data) return NextResponse.json({ ok: false, message: "Chat konnte nicht aktualisiert werden." }, { status: 500 });

  return NextResponse.json({ ok: true, chat: data });
}

export async function DELETE(_: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }
  const { chatId } = await context.params;

  const { data: attachRows } = await auth.supabase
    .from("ai_chat_attachments")
    .select("storage_path")
    .eq("chat_id", chatId);

  const objectPaths =
    attachRows?.map((r) => r.storage_path).filter((p) => p && !isSkippedStoragePath(p)) ?? [];

  if (objectPaths.length > 0) {
    const rm = await auth.supabase.storage.from(AI_CHAT_ATTACHMENTS_BUCKET).remove(objectPaths);
    if (rm.error) console.warn("ai_chat_attachments storage cleanup", rm.error);
  }

  const { error } = await auth.supabase
    .from("ai_chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", auth.userId);
  if (error) return NextResponse.json({ ok: false, message: "Chat konnte nicht gelöscht werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

