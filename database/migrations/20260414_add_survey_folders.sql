-- Add folders for grouping surveys.

CREATE TABLE IF NOT EXISTS public.survey_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT survey_folders_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT survey_folders_name_unique UNIQUE (name)
);

DO $$ BEGIN
  ALTER TABLE public.surveys
    ADD COLUMN folder_id uuid REFERENCES public.survey_folders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_survey_folders
    BEFORE UPDATE ON public.survey_folders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS survey_folders_created_by_user_id_idx ON public.survey_folders(created_by_user_id);
CREATE INDEX IF NOT EXISTS survey_folders_name_idx ON public.survey_folders(name);
CREATE INDEX IF NOT EXISTS surveys_folder_id_idx ON public.surveys(folder_id);

ALTER TABLE public.survey_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_folders_select_platform_admin_only" ON public.survey_folders;
CREATE POLICY "survey_folders_select_platform_admin_only"
ON public.survey_folders
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_folders_insert_platform_admin_only" ON public.survey_folders;
CREATE POLICY "survey_folders_insert_platform_admin_only"
ON public.survey_folders
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_folders_update_platform_admin_only" ON public.survey_folders;
CREATE POLICY "survey_folders_update_platform_admin_only"
ON public.survey_folders
FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_folders_delete_platform_admin_only" ON public.survey_folders;
CREATE POLICY "survey_folders_delete_platform_admin_only"
ON public.survey_folders
FOR DELETE
USING (public.is_platform_admin(auth.uid()));
