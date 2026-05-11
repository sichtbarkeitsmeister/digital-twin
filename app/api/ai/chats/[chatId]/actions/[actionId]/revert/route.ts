import { NextResponse } from "next/server";

import { requireAuthUser, getChatOrNull } from "@/lib/ai/chat-db";
import { revertSurveyProposal } from "@/lib/ai/chat-executor";

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
    .select("id,revert_payload")
    .eq("id", actionId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!action) return NextResponse.json({ ok: false, message: "Aktion nicht gefunden." }, { status: 404 });
  if (!action.revert_payload || typeof action.revert_payload !== "object") {
    return NextResponse.json({ ok: false, message: "Für diese Aktion ist kein Revert verfügbar." }, { status: 400 });
  }

  const result = await revertSurveyProposal(action.revert_payload as Record<string, unknown>);
  await auth.supabase
    .from("ai_chat_actions")
    .update({
      execution_status: result.ok ? "reverted" : "failed",
      execution_result: result,
    })
    .eq("id", actionId);

  return NextResponse.json(result);
}

