import type { SupabaseClient } from "@supabase/supabase-js";

export const SURVEY_AI_MAX_ASSISTANT_RULES_CHARS = 4000;

export type SurveyAiUserPreferencesRow = {
  user_id: string;
  auto_navigate: boolean;
  show_archived_chats: boolean;
  global_assistant_rules: string;
  updated_at: string;
};

/** Lazy-create default row on first access. */
export async function ensureSurveyAiUserPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; prefs: SurveyAiUserPreferencesRow } | { ok: false; message: string }> {
  const { data: existing, error: selectError } = await supabase
    .from("survey_ai_user_preferences")
    .select("user_id,auto_navigate,show_archived_chats,global_assistant_rules,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    return { ok: false, message: selectError.message };
  }

  if (existing) {
    return {
      ok: true,
      prefs: existing as SurveyAiUserPreferencesRow,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("survey_ai_user_preferences")
    .insert({
      user_id: userId,
      auto_navigate: true,
      show_archived_chats: false,
      global_assistant_rules: "",
    })
    .select("user_id,auto_navigate,show_archived_chats,global_assistant_rules,updated_at")
    .single();

  if (insertError || !inserted) {
    return { ok: false, message: insertError?.message ?? "Preferences could not be created." };
  }

  return { ok: true, prefs: inserted as SurveyAiUserPreferencesRow };
}
