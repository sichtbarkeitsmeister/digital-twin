-- Survey KI user preferences (server-backed) + per-chat assistant rules.

CREATE TABLE IF NOT EXISTS public.survey_ai_user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_navigate boolean NOT NULL DEFAULT true,
  show_archived_chats boolean NOT NULL DEFAULT false,
  global_assistant_rules text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_survey_ai_user_preferences
    BEFORE UPDATE ON public.survey_ai_user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.survey_ai_user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_ai_user_preferences_select_own" ON public.survey_ai_user_preferences;
CREATE POLICY "survey_ai_user_preferences_select_own"
ON public.survey_ai_user_preferences
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "survey_ai_user_preferences_insert_own" ON public.survey_ai_user_preferences;
CREATE POLICY "survey_ai_user_preferences_insert_own"
ON public.survey_ai_user_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "survey_ai_user_preferences_update_own" ON public.survey_ai_user_preferences;
CREATE POLICY "survey_ai_user_preferences_update_own"
ON public.survey_ai_user_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.ai_chats
  ADD COLUMN IF NOT EXISTS assistant_rules text NOT NULL DEFAULT '';
