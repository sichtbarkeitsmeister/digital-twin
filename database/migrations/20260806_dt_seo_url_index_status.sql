-- Store Google URL Inspection samples (GSC). There is no Coverage report API —
-- this table holds per-URL inspection results ingested from n8n.

CREATE TABLE IF NOT EXISTS public.dt_seo_url_index_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  url text NOT NULL,
  inspected_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  verdict text,
  coverage_state text,
  indexing_state text,
  page_fetch_state text,
  robots_txt_state text,
  crawled_as text,
  sitemap text,
  referring_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, url)
);

CREATE INDEX IF NOT EXISTS dt_seo_url_index_status_org_inspected_idx
  ON public.dt_seo_url_index_status (organisation_id, inspected_at DESC);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_seo_url_index_status
    BEFORE UPDATE ON public.dt_seo_url_index_status
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_seo_url_index_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_seo_url_index_status_select" ON public.dt_seo_url_index_status;
CREATE POLICY "dt_seo_url_index_status_select"
ON public.dt_seo_url_index_status FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));
