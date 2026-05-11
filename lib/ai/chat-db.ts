import { createClient } from "@/lib/supabase/server";

export type AiChatRow = {
  id: string;
  user_id: string;
  title: string;
  archived_at: string | null;
  assistant_rules?: string | null;
  created_at: string;
  updated_at: string;
};

export async function requireAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) return { ok: false as const, supabase, userId: null };
  return { ok: true as const, supabase, userId: user.id };
}

export async function getChatOrNull(chatId: string, userId: string): Promise<AiChatRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_chats")
    .select("id,user_id,title,archived_at,assistant_rules,created_at,updated_at")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as AiChatRow | null;
}

