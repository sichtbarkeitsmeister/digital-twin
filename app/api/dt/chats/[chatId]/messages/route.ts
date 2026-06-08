import { NextResponse } from "next/server";
import { z } from "zod";

import { callDtAnthropicChat, suggestChatTitle } from "@/lib/dt/anthropic-chat";
import { assembleDtChatFromDb } from "@/lib/dt/assemble-chat-prompt";
import {
  buildAttachmentMetadataForMessage,
  dtAttachmentInboundSchema,
  persistDtChatAttachments,
  prepareInboundAttachments,
} from "@/lib/dt/attachments";
import { getDtChatOrNull, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import {
  callDtN8nChat,
  mapN8nResultToAssistantRow,
  resolveTitleAfterChat,
} from "@/lib/dt/n8n-chat";
import {
  buildDtSeoTaskProposalMetadata,
  parseDtSeoTaskProposalsFromText,
  stripDtSeoTaskProposalBlocks,
} from "@/lib/dt/seo/chat-task-proposals";
import type { DtChatMode } from "@/lib/dt/types";

function finalizeAssistantSeoContent(text: string, mode: DtChatMode) {
  if (mode !== "seo") {
    return { content: text, seoTaskProposals: [] as ReturnType<typeof parseDtSeoTaskProposalsFromText> };
  }
  const seoTaskProposals = parseDtSeoTaskProposalsFromText(text);
  const content = stripDtSeoTaskProposalBlocks(text);
  return { content, seoTaskProposals };
}

function assistantMetadataExtras(
  base: Record<string, unknown>,
  mode: DtChatMode,
  seoTaskProposals: ReturnType<typeof parseDtSeoTaskProposalsFromText>,
) {
  if (mode !== "seo" || seoTaskProposals.length === 0) return base;
  return {
    ...base,
    seo_task_proposals: buildDtSeoTaskProposalMetadata(seoTaskProposals),
  };
}

const bodySchema = z
  .object({
    content: z.string().max(32_000).default(""),
    ghostMode: z.boolean().optional(),
    attachments: z.array(dtAttachmentInboundSchema).max(5).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.ghostMode) return;
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

export async function POST(req: Request, context: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const chat = await getDtChatOrNull(chatId);
  if (!chat) {
    return NextResponse.json({ ok: false, message: "Chat nicht gefunden." }, { status: 404 });
  }

  if (chat.mode === "seo") {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, chat.organisation_id);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
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

  const ghostMode = parsed.data.ghostMode ?? chat.mode === "ghost";
  const content = parsed.data.content.trim() || "(Anhang)";
  const attachmentMeta = buildAttachmentMetadataForMessage(prepared.items);

  let userRow: {
    id: string;
    chat_id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown>;
    author_user_id: string | null;
    stopped: boolean;
    created_at: string;
  } | null = null;

  if (!ghostMode) {
    const { data, error } = await auth.supabase
      .from("dt_chat_messages")
      .insert({
        chat_id: chatId,
        role: "user",
        content,
        author_user_id: auth.userId,
        metadata: { attachments: attachmentMeta },
      })
      .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, message: "Nachricht konnte nicht gespeichert werden." },
        { status: 500 },
      );
    }
    userRow = data;

    if (prepared.items.length > 0) {
      const persisted = await persistDtChatAttachments({
        supabase: auth.supabase,
        organisationId: chat.organisation_id,
        chatId,
        messageId: data.id,
        attachments: prepared.items,
      });
      if (!persisted.ok) {
        return NextResponse.json({ ok: false, message: persisted.message }, { status: 500 });
      }
    }
  }

  const hasAttachments = prepared.items.length > 0;
  const n8nWebhook = process.env.N8N_DT_CHAT_WEBHOOK?.trim();
  const session = (await auth.supabase.auth.getSession()).data.session;
  const accessToken = session?.access_token?.trim();

  if (n8nWebhook && accessToken && !hasAttachments) {
    try {
      const n8n = await callDtN8nChat({
        accessToken,
        chat,
        message: content,
        userMessageId: userRow?.id ?? null,
        ghostMode,
      });

      let assistantRow = mapN8nResultToAssistantRow(chatId, n8n);

      const finalized = finalizeAssistantSeoContent(assistantRow.content, chat.mode as DtChatMode);
      assistantRow = {
        ...assistantRow,
        content: finalized.content,
        metadata: assistantMetadataExtras(
          assistantRow.metadata,
          chat.mode as DtChatMode,
          finalized.seoTaskProposals,
        ),
      };

      if (!ghostMode && n8n.messageId) {
        const { data: persisted } = await auth.supabase
          .from("dt_chat_messages")
          .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
          .eq("id", n8n.messageId)
          .maybeSingle();
        if (persisted) {
          const persistedFinal = finalizeAssistantSeoContent(
            persisted.content,
            chat.mode as DtChatMode,
          );
          assistantRow = {
            ...persisted,
            content: persistedFinal.content,
            metadata: assistantMetadataExtras(
              (persisted.metadata as Record<string, unknown>) ?? {},
              chat.mode as DtChatMode,
              persistedFinal.seoTaskProposals,
            ),
          };
          await auth.supabase
            .from("dt_chat_messages")
            .update({
              content: assistantRow.content,
              metadata: assistantRow.metadata,
            })
            .eq("id", persisted.id);
        }
      } else if (!ghostMode) {
        const { data: inserted } = await auth.supabase
          .from("dt_chat_messages")
          .insert({
            chat_id: chatId,
            role: "assistant",
            content: assistantRow.content,
            metadata: assistantRow.metadata,
            author_user_id: null,
            stopped: false,
            model: (assistantRow.metadata.model as string | null) ?? null,
          })
          .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
          .single();
        if (inserted) assistantRow = inserted;
      }

      const titleSuggestion = !ghostMode
        ? resolveTitleAfterChat(chat, content, n8n.content ?? "", n8n.title)
        : null;
      if (titleSuggestion) {
        await auth.supabase.from("dt_chats").update({ title: titleSuggestion }).eq("id", chatId);
      }

      return NextResponse.json({
        ok: true,
        userMessage: userRow,
        assistantMessage: assistantRow,
        titleSuggestion,
        via: "n8n",
      });
    } catch (err) {
      console.warn("[dt] n8n chat failed, falling back to direct Anthropic:", err);
    }
  }

  const assembled = await assembleDtChatFromDb({
    chatId,
    userId: auth.userId,
    ghostMode,
    supabase: auth.supabase,
  });

  let direct: Awaited<ReturnType<typeof callDtAnthropicChat>>;
  try {
    direct = await callDtAnthropicChat({
      system: assembled.system,
      messages: assembled.messages,
      mode: chat.mode as DtChatMode,
    });
  } catch (err) {
    console.error("[dt/chat/messages] Anthropic failed:", err);
    return NextResponse.json(
      {
        ok: false,
        message: "KI-Antwort fehlgeschlagen. Bitte erneut versuchen.",
      },
      { status: 500 },
    );
  }

  let assistantRow: {
    id: string;
    chat_id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown>;
    author_user_id: string | null;
    stopped: boolean;
    created_at: string;
  };

  const finalized = finalizeAssistantSeoContent(direct.text, chat.mode as DtChatMode);

  if (!ghostMode) {
    const { data, error } = await auth.supabase
      .from("dt_chat_messages")
      .insert({
        chat_id: chatId,
        role: "assistant",
        content: finalized.content,
        metadata: assistantMetadataExtras(
          {
            model: direct.model,
            stop_reason: direct.stopReason,
            via: hasAttachments ? "anthropic_direct_attachments" : "anthropic_direct",
          },
          chat.mode as DtChatMode,
          finalized.seoTaskProposals,
        ),
        author_user_id: null,
        stopped: false,
        model: direct.model,
      })
      .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, message: "Antwort konnte nicht gespeichert werden." },
        { status: 500 },
      );
    }
    assistantRow = data;
  } else {
    assistantRow = {
      id: `ghost-${Date.now()}`,
      chat_id: chatId,
      role: "assistant",
      content: finalized.content,
      metadata: assistantMetadataExtras(
        { via: "anthropic_direct_ghost" },
        chat.mode as DtChatMode,
        finalized.seoTaskProposals,
      ),
      author_user_id: null,
      stopped: false,
      created_at: new Date().toISOString(),
    };
  }

  const titleSuggestion =
    !ghostMode && (chat.title === "Neuer Chat" || chat.title.trim().length === 0)
      ? suggestChatTitle(content, finalized.content)
      : null;

  if (titleSuggestion) {
    await auth.supabase.from("dt_chats").update({ title: titleSuggestion }).eq("id", chatId);
  }

  return NextResponse.json({
    ok: true,
    userMessage: userRow,
    assistantMessage: assistantRow,
    titleSuggestion,
    via: hasAttachments ? "anthropic_direct_attachments" : "anthropic_direct",
  });
}
