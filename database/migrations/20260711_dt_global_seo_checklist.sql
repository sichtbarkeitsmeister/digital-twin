-- Global SEO checklist + per-org personalized toggle

CREATE TABLE IF NOT EXISTS public.dt_platform_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  global_seo_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.dt_platform_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dt_org_config
  ADD COLUMN IF NOT EXISTS seo_checklist_personalized boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_dt_platform_settings'
  ) THEN
    CREATE TRIGGER set_updated_at_dt_platform_settings
      BEFORE UPDATE ON public.dt_platform_settings
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

ALTER TABLE public.dt_platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_platform_settings_select" ON public.dt_platform_settings;
CREATE POLICY "dt_platform_settings_select"
ON public.dt_platform_settings FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "dt_platform_settings_update_admin" ON public.dt_platform_settings;
CREATE POLICY "dt_platform_settings_update_admin"
ON public.dt_platform_settings FOR UPDATE
TO authenticated
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "dt_platform_settings_insert_admin" ON public.dt_platform_settings;
CREATE POLICY "dt_platform_settings_insert_admin"
ON public.dt_platform_settings FOR INSERT
TO authenticated
WITH CHECK (public.is_platform_admin(auth.uid()));
