import { NextResponse } from "next/server";

import { requireAuthUser, getChatOrNull } from "@/lib/ai/chat-db";

export async function POST(
  _: Request,
  context: { params: Promise<{ chatId: string; actionId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Not authenticated." }, { status: 401 });
  }

  const { chatId, actionId } = await context.params;
  const chat = await getChatOrNull(chatId, auth.userId);
  if (!chat) return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });

  const { data: action } = await auth.supabase
    .from("ai_chat_actions")
    .select("id,execution_status")
    .eq("id", actionId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!action) return NextResponse.json({ ok: false, message: "Aktion nicht gefunden." }, { status: 404 });
  if (action.execution_status !== "proposed") {
    return NextResponse.json({ ok: false, message: "Nur offene Vorschläge können abgelehnt werden." }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("ai_chat_actions")
    .update({
      execution_status: "failed",
      execution_result: { ok: false, message: "Vom Nutzer abgelehnt." },
    })
    .eq("id", actionId)
    .eq("chat_id", chatId);
  if (error) {
    return NextResponse.json({ ok: false, message: "Vorschlag konnte nicht abgelehnt werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Vorschlag abgelehnt." });
}

