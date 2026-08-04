export const DT_LAST_CHAT_KEY = "dt:last-chat-id";
export const DT_LAST_SEO_CHAT_KEY = "dt:last-seo-chat-id";

function storageKey(seoMode?: boolean): string {
  return seoMode ? DT_LAST_SEO_CHAT_KEY : DT_LAST_CHAT_KEY;
}

export function readDtLastChatId(seoMode?: boolean): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(seoMode));
  } catch {
    return null;
  }
}

export function writeDtLastChatId(chatId: string | null, seoMode?: boolean) {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(seoMode);
    if (!chatId) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, chatId);
  } catch {
    // ignore
  }
}
