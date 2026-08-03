import { NextResponse } from "next/server";

import { requireAuthUser, getChatOrNull } from "@/lib/ai/chat-db";
import {
  describeSurveyProposalValidationError,
  parseSurveyAiProposal,
} from "@/lib/ai/survey-assistant-types";
import { applySurveyProposal } from "@/lib/ai/chat-executor";

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
    .select("id,proposal_json,execution_status")
    .eq("id", actionId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!action) return NextResponse.json({ ok: false, message: "Aktion nicht gefunden." }, { status: 404 });

  const proposalParsed = parseSurveyAiProposal(action.proposal_json);
  if (!proposalParsed.success) {
    const message = describeSurveyProposalValidationError(action.proposal_json);
    await auth.supabase
      .from("ai_chat_actions")
      .update({
        execution_status: "failed",
        execution_result: { ok: false, message },
      })
      .eq("id", actionId);
    return NextResponse.json({ ok: false, message }, { status: 422 });
  }

  const result = await applySurveyProposal(proposalParsed.data);
  await auth.supabase
    .from("ai_chat_actions")
    .update({
      execution_status: result.ok ? "applied" : "failed",
      execution_result: result,
      revert_payload: result.revertPayload ?? null,
    })
    .eq("id", actionId);

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    navigateTo: result.navigateTo ?? null,
  });
}

