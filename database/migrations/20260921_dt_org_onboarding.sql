-- Customer onboarding credentials and media uploads per organisation.
-- The public upload link is upload-only: outsiders cannot list or download files.

CREATE TABLE IF NOT EXISTS public.dt_org_onboarding (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  upload_token text NOT NULL UNIQUE,
  upload_password text NOT NULL,
  hoster_user text,
  hoster_password text,
  smtp_host text,
  smtp_port text,
  smtp_protocol text,
  smtp_username text,
  smtp_password text,
  cms_login_url text,
  cms_user text,
  cms_password text,
  competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
  billing_email text,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_org_onboarding_upload_token_len
    CHECK (char_length(upload_token) BETWEEN 16 AND 64),
  CONSTRAINT dt_org_onboarding_upload_password_len
    CHECK (char_length(upload_password) BETWEEN 6 AND 80),
  CONSTRAINT dt_org_onboarding_competitors_is_array
    CHECK (jsonb_typeof(competitors) = 'array')
);

COMMENT ON TABLE public.dt_org_onboarding IS
  'Kunden-Onboarding: Cloud-Upload (Token+Passwort), Hoster/SMTP/CMS-Zugänge, Mitbewerber, Buchhaltungs-E-Mail.';

CREATE INDEX IF NOT EXISTS dt_org_onboarding_updated_idx
  ON public.dt_org_onboarding (updated_at DESC);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_org_onboarding
    BEFORE UPDATE ON public.dt_org_onboarding
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.dt_org_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_org_onboarding_select_member" ON public.dt_org_onboarding;
CREATE POLICY "dt_org_onboarding_select_member"
ON public.dt_org_onboarding FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_onboarding_write_member" ON public.dt_org_onboarding;
CREATE POLICY "dt_org_onboarding_write_member"
ON public.dt_org_onboarding FOR ALL
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

CREATE TABLE IF NOT EXISTS public.dt_org_onboarding_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_org_onboarding_files IS
  'Metadaten zu Onboarding-Uploads (Bilder, Videos, Logo). Dateien liegen im privaten Bucket dt-onboarding-uploads.';

CREATE INDEX IF NOT EXISTS dt_org_onboarding_files_org_created_idx
  ON public.dt_org_onboarding_files (organisation_id, created_at DESC);

ALTER TABLE public.dt_org_onboarding_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_org_onboarding_files_select_member" ON public.dt_org_onboarding_files;
CREATE POLICY "dt_org_onboarding_files_select_member"
ON public.dt_org_onboarding_files FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_onboarding_files_insert_member" ON public.dt_org_onboarding_files;
CREATE POLICY "dt_org_onboarding_files_insert_member"
ON public.dt_org_onboarding_files FOR INSERT
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_onboarding_files_delete_member" ON public.dt_org_onboarding_files;
CREATE POLICY "dt_org_onboarding_files_delete_member"
ON public.dt_org_onboarding_files FOR DELETE
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

-- Public upload looks up the org by token via SERVICE ROLE only (Next.js route).
-- Authenticated clients never read by token.

CREATE OR REPLACE FUNCTION public.dt_onboarding_org_id_from_path(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(replace(split_part(p_path, '/', 1), 'org_', ''), '')::uuid;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dt-onboarding-uploads',
  'dt-onboarding-uploads',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "dt_onboarding_uploads_select" ON storage.objects;
CREATE POLICY "dt_onboarding_uploads_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'dt-onboarding-uploads'
  AND (
    public.is_platform_admin(auth.uid())
    OR public.is_org_member(public.dt_onboarding_org_id_from_path(name), auth.uid())
  )
);

DROP POLICY IF EXISTS "dt_onboarding_uploads_insert" ON storage.objects;
CREATE POLICY "dt_onboarding_uploads_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'dt-onboarding-uploads'
  AND (
    public.is_platform_admin(auth.uid())
    OR public.is_org_member(public.dt_onboarding_org_id_from_path(name), auth.uid())
  )
);

DROP POLICY IF EXISTS "dt_onboarding_uploads_update" ON storage.objects;
CREATE POLICY "dt_onboarding_uploads_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'dt-onboarding-uploads'
  AND (
    public.is_platform_admin(auth.uid())
    OR public.is_org_member(public.dt_onboarding_org_id_from_path(name), auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'dt-onboarding-uploads'
  AND (
    public.is_platform_admin(auth.uid())
    OR public.is_org_member(public.dt_onboarding_org_id_from_path(name), auth.uid())
  )
);

DROP POLICY IF EXISTS "dt_onboarding_uploads_delete" ON storage.objects;
CREATE POLICY "dt_onboarding_uploads_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'dt-onboarding-uploads'
  AND (
    public.is_platform_admin(auth.uid())
    OR public.is_org_member(public.dt_onboarding_org_id_from_path(name), auth.uid())
  )
);
