import type { SupabaseClient } from "@supabase/supabase-js";

export const DT_MAX_ASSISTANT_RULES_CHARS = 4000;

export type DtUserPreferencesRow = {
  user_id: string;
  global_assistant_rules: string;
  show_archived_chats: boolean;
  default_agent_id: string | null;
  updated_at: string;
};

export async function ensureDtUserPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; prefs: DtUserPreferencesRow } | { ok: false; message: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("dt_user_preferences")
    .select("user_id,global_assistant_rules,show_archived_chats,default_agent_id,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    return { ok: false, message: selectError.message };
  }

  if (existing) {
    return { ok: true, prefs: existing as DtUserPreferencesRow };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("dt_user_preferences")
    .insert({
      user_id: userId,
      global_assistant_rules: "",
      show_archived_chats: false,
    })
    .select("user_id,global_assistant_rules,show_archived_chats,default_agent_id,updated_at")
    .single();

  if (insertError || !inserted) {
    return { ok: false, message: insertError?.message ?? "Einstellungen konnten nicht erstellt werden." };
  }

  return { ok: true, prefs: inserted as DtUserPreferencesRow };
}
