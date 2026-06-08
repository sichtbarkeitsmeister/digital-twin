export const DT_LAST_CHAT_KEY = "dt:last-chat-id";

export function readDtLastChatId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DT_LAST_CHAT_KEY);
  } catch {
    return null;
  }
}

export function writeDtLastChatId(chatId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!chatId) window.localStorage.removeItem(DT_LAST_CHAT_KEY);
    else window.localStorage.setItem(DT_LAST_CHAT_KEY, chatId);
  } catch {
    // ignore
  }
}
