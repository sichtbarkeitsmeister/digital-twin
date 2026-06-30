import { NextResponse } from "next/server";

import { getDtChatOrNull, requireAuthUser, shareDtChatToTeam } from "@/lib/dt/db";

export async function POST(
  _req: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getDtChatOrNull(chatId);
  if (!chat) {
    return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });
  }

  if (chat.mode !== "default" || chat.shared_to_team_at) {
    return NextResponse.json(
      { ok: false, message: "Nur persönliche Chats können einmal mit dem Team geteilt werden." },
      { status: 400 },
    );
  }

  const { chat: shared, error } = await shareDtChatToTeam(chatId);
  if (error || !shared) {
    return NextResponse.json(
      { ok: false, message: error ?? "Teilen fehlgeschlagen." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, chat: shared, message: "Chat mit dem Team geteilt." });
}
