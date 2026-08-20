-- Meeting summaries / company docs attached to the Erstgespräch.

CREATE TABLE IF NOT EXISTS public.dt_org_first_conversation_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  extracted_text text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_org_first_conversation_files IS
  'Meeting-Zusammenfassungen und Unternehmensunterlagen zum Erstgespräch. KI füllt daraus Fragebogen-Antworten vor.';

CREATE INDEX IF NOT EXISTS dt_org_first_conversation_files_org_idx
  ON public.dt_org_first_conversation_files(organisation_id, created_at DESC);

ALTER TABLE public.dt_org_first_conversation_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_org_first_conversation_files_select" ON public.dt_org_first_conversation_files;
CREATE POLICY "dt_org_first_conversation_files_select"
ON public.dt_org_first_conversation_files FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_first_conversation_files_write_admin" ON public.dt_org_first_conversation_files;
CREATE POLICY "dt_org_first_conversation_files_write_admin"
ON public.dt_org_first_conversation_files FOR ALL
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dt-first-conversation-files',
  'dt-first-conversation-files',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "dt_first_conversation_files_storage_admin" ON storage.objects;
CREATE POLICY "dt_first_conversation_files_storage_admin"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'dt-first-conversation-files'
  AND public.is_platform_admin(auth.uid())
)
WITH CHECK (
  bucket_id = 'dt-first-conversation-files'
  AND public.is_platform_admin(auth.uid())
);
