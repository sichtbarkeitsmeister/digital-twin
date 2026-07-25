import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CHATS = 8;
const MAX_MESSAGES_PER_CHAT = 4;
const MAX_CHARS_TOTAL = 6_000;
const MAX_CONTENT_CHARS = 280;

function truncate(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function roleLabel(role: string): string {
  if (role === "user") return "Nutzer";
  if (role === "assistant") return "SEO-Berater";
  return role;
}

/**
 * Compact digest of other SEO chats in the same organisation so the SEO agent
 * can recall prior discussions without stuffing full histories into the prompt.
 */
export async function loadOtherSeoChatsForPrompt(
  supabase: SupabaseClient,
  organisationId: string,
  excludeChatId?: string | null,
): Promise<string> {
  let chatQuery = supabase
    .from("dt_chats")
    .select("id,title,updated_at")
    .eq("organisation_id", organisationId)
    .eq("mode", "seo")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_CHATS);

  if (excludeChatId) {
    chatQuery = chatQuery.neq("id", excludeChatId);
  }

  const { data: chats, error: chatError } = await chatQuery;

  if (chatError) {
    console.warn("[dt] loadOtherSeoChatsForPrompt chats:", chatError.message);
    return "";
  }

  if (!chats?.length) {
    return [
      "Noch keine anderen SEO-Chats in dieser Organisation.",
      "Du kannst dich nur an den aktuellen Chat-Verlauf erinnern, plus Unternehmens-/SEO-Daten oben.",
    ].join("\n");
  }

  const chatIds = chats.map((c) => c.id);
  const { data: messages, error: msgError } = await supabase
    .from("dt_chat_messages")
    .select("chat_id,role,content,created_at")
    .in("chat_id", chatIds)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false });

  if (msgError) {
    console.warn("[dt] loadOtherSeoChatsForPrompt messages:", msgError.message);
    return "";
  }

  const byChat = new Map<string, Array<{ role: string; content: string }>>();
  for (const row of messages ?? []) {
    const list = byChat.get(row.chat_id) ?? [];
    if (list.length >= MAX_MESSAGES_PER_CHAT) continue;
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!content) continue;
    list.push({ role: row.role, content });
    byChat.set(row.chat_id, list);
  }

  const sections: string[] = [
    "Nutze diese Auszüge, wenn der Nutzer sich auf frühere SEO-Gespräche bezieht.",
    "Du DARFST dich auf Inhalte aus diesen Org-Chats beziehen. Sage nicht, du hättest keinen Zugriff auf frühere Gespräche.",
    "Wenn etwas unklar oder nicht in den Auszügen steht, frage kurz nach statt zu erfinden.",
    "",
  ];

  let used = sections.join("\n").length;

  for (const chat of chats) {
    const title = chat.title?.trim() || "Ohne Titel";
    const when = chat.updated_at
      ? new Date(chat.updated_at).toLocaleDateString("de-DE")
      : "";
    const turns = [...(byChat.get(chat.id) ?? [])].reverse();
    if (turns.length === 0) continue;

    const lines = [
      `### ${title}${when ? ` (${when})` : ""}`,
      ...turns.map((t) => `- ${roleLabel(t.role)}: ${truncate(t.content, MAX_CONTENT_CHARS)}`),
      "",
    ];
    const block = lines.join("\n");
    if (used + block.length > MAX_CHARS_TOTAL) break;
    sections.push(block);
    used += block.length;
  }

  if (sections.length <= 4) {
    return [
      "Andere SEO-Chats existieren, enthalten aber noch keine nutzbaren Nachrichten.",
    ].join("\n");
  }

  return sections.join("\n").trim();
}
