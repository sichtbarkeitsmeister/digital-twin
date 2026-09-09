-- Curated website IA / structure per organisation (uploaded, not crawled).

CREATE TABLE IF NOT EXISTS public.dt_website_structures (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  filename text,
  mime_type text,
  raw_text text NOT NULL,
  outline text NOT NULL,
  node_count integer NOT NULL DEFAULT 0,
  notes text,
  uploaded_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_website_structures IS
  'Uploaded website information architecture (intended site structure) for an organisation. Injected into DigitalTwin SEO/GEO prompts.';

CREATE INDEX IF NOT EXISTS dt_website_structures_uploaded_at_idx
  ON public.dt_website_structures (uploaded_at DESC);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_website_structures
    BEFORE UPDATE ON public.dt_website_structures
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_website_structures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_website_structures_select" ON public.dt_website_structures;
CREATE POLICY "dt_website_structures_select"
ON public.dt_website_structures FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_website_structures_insert" ON public.dt_website_structures;
CREATE POLICY "dt_website_structures_insert"
ON public.dt_website_structures FOR INSERT
WITH CHECK (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_website_structures_update" ON public.dt_website_structures;
CREATE POLICY "dt_website_structures_update"
ON public.dt_website_structures FOR UPDATE
USING (public.dt_user_can_access_seo(organisation_id))
WITH CHECK (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_website_structures_delete" ON public.dt_website_structures;
CREATE POLICY "dt_website_structures_delete"
ON public.dt_website_structures FOR DELETE
USING (public.dt_user_can_access_seo(organisation_id));
