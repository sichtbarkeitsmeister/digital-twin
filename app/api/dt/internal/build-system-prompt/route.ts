import { NextResponse } from "next/server";
import { z } from "zod";

import { assembleDtChatFromDb } from "@/lib/dt/assemble-chat-prompt";
import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";

const bodySchema = z.object({
  userId: z.string().uuid(),
  chatId: z.string().uuid(),
  ghostMode: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    const assembled = await assembleDtChatFromDb({
      chatId: parsed.data.chatId,
      userId: parsed.data.userId,
      ghostMode: parsed.data.ghostMode,
    });

    return NextResponse.json({
      ok: true,
      system: assembled.system,
      messages: assembled.messages,
      model: assembled.model,
      mode: assembled.mode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prompt konnte nicht erstellt werden.";
    console.warn("[dt] build-system-prompt:", message);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
