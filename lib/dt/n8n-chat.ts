import type { DtChatRow } from "@/lib/dt/types";
import type { DtMessageRow } from "@/lib/dt/types";

export type DtN8nChatUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type DtN8nChatResponse = {
  ok?: boolean;
  messageId?: string;
  content?: string;
  finishReason?: string | null;
  title?: string | null;
  assistantMessage?: string;
  message?: string;
  model?: string | null;
  usage?: DtN8nChatUsage;
};

/** Leave enough time for the Next.js Anthropic fallback inside a 300s route. */
export const N8N_DT_CHAT_TIMEOUT_MS = 120_000;

export async function callDtN8nChat(params: {
  accessToken: string;
  chat: DtChatRow;
  message: string;
  userMessageId: string | null;
  ghostMode?: boolean;
  textMode?: boolean;
}): Promise<DtN8nChatResponse> {
  const webhook = process.env.N8N_DT_CHAT_WEBHOOK?.trim();
  if (!webhook) {
    throw new Error("N8N_DT_CHAT_WEBHOOK nicht konfiguriert.");
  }

  const url = new URL(webhook);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_DT_CHAT_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
        "X-DT-Source": "nextjs-prod",
      },
      body: JSON.stringify({
        chatId: params.chat.id,
        organisationId: params.chat.organisation_id,
        agentId: params.chat.agent_id,
        mode: params.chat.mode,
        message: params.message,
        userMessageId: params.userMessageId,
        ghostMode: params.ghostMode ?? false,
        textMode: params.textMode ?? false,
        attachments: [],
      }),
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as DtN8nChatResponse | null;
    if (!res.ok || !json) {
      throw new Error(json?.message ?? `n8n HTTP ${res.status}`);
    }

    const content = json.content ?? json.assistantMessage;
    if (!content?.trim()) {
      throw new Error(json.message ?? "n8n-Antwort ohne Inhalt.");
    }

    return { ...json, content: content.trim() };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|abort|timeout/i.test(err.message))
    ) {
      throw new Error("n8n Zeitüberschreitung.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function mapN8nResultToAssistantRow(
  chatId: string,
  n8n: DtN8nChatResponse,
  model?: string | null,
): DtMessageRow {
  return {
    id: n8n.messageId ?? crypto.randomUUID(),
    chat_id: chatId,
    role: "assistant",
    content: n8n.content ?? "",
    metadata: {
      finish_reason: n8n.finishReason ?? null,
      via: "n8n",
      model: model ?? n8n.model ?? null,
    },
    author_user_id: null,
    stopped: false,
    created_at: new Date().toISOString(),
  };
}
