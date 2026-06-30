import { NextResponse } from "next/server";
import { z } from "zod";

import { callDtAnthropicChat } from "@/lib/dt/anthropic-chat";
import {
  dtAttachmentInboundSchema,
  prepareInboundAttachments,
} from "@/lib/dt/attachments";
import { assembleDtChatEphemeral } from "@/lib/dt/assemble-chat-prompt";
import { appendEphemeralAttachmentsToMessages } from "@/lib/dt/hydrate-ephemeral-attachments";
import { requireAuthUser } from "@/lib/dt/db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { createServiceClient } from "@/lib/supabase/service";

const historySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(32_000),
});

const bodySchema = z
  .object({
    organisationId: z.string().uuid(),
    agentId: z.string().uuid(),
    content: z.string().max(32_000).default(""),
    history: z.array(historySchema).max(80).default([]),
    attachments: z.array(dtAttachmentInboundSchema).max(5).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const hasText = data.content.trim().length > 0;
    const hasFiles = (data.attachments?.length ?? 0) > 0;
    if (!hasText && !hasFiles) {
      ctx.addIssue({
        code: "custom",
        message: "Nachricht oder Anhang erforderlich.",
        path: ["content"],
      });
    }
  });

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const prepared = await prepareInboundAttachments(parsed.data.attachments ?? []);
  if (!prepared.ok) {
    return NextResponse.json({ ok: false, message: prepared.message }, { status: 400 });
  }

  try {
    const assembled = await assembleDtChatEphemeral({
      userId: auth.userId,
      organisationId: parsed.data.organisationId,
      agentId: parsed.data.agentId,
      history: parsed.data.history,
    });

    const messages = appendEphemeralAttachmentsToMessages(
      assembled.messages,
      parsed.data.content.trim(),
      prepared.items,
    );

    const direct = await callDtAnthropicChat({
      system: assembled.system,
      messages,
      mode: "ghost",
    });

    if (direct.usage.inputTokens > 0 || direct.usage.outputTokens > 0) {
      const service = createServiceClient();
      await recordLlmUsageEvent(service, {
        organisationId: parsed.data.organisationId,
        userId: auth.userId,
        agentId: parsed.data.agentId,
        mode: "ghost",
        via: "ghost",
        model: direct.model,
        inputTokens: direct.usage.inputTokens,
        outputTokens: direct.usage.outputTokens,
      });
    }

    return NextResponse.json({
      ok: true,
      assistantMessage: {
        id: `ghost-${Date.now()}`,
        role: "assistant" as const,
        content: direct.text,
        metadata: { via: "anthropic_ghost", model: direct.model },
        created_at: new Date().toISOString(),
      },
      via: "anthropic_ghost",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ghost-Chat fehlgeschlagen.";
    console.warn("[dt] ghost chat:", message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
