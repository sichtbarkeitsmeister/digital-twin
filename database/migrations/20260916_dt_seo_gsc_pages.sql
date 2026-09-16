-- GSC Search Analytics pages (dimension=page) so the crawler can seed URLs
-- Google already knows, and the crawl viewer can show indexed vs not indexed.
-- The Coverage report is still not in the GSC API; impressions in the last
-- 90 days are the bulk signal, URL Inspection overrides when present.

CREATE TABLE IF NOT EXISTS public.dt_seo_gsc_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  url text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  period_start date,
  period_end date,
  fetched_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, url)
);

CREATE INDEX IF NOT EXISTS dt_seo_gsc_pages_org_fetched_idx
  ON public.dt_seo_gsc_pages (organisation_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS dt_seo_gsc_pages_org_impressions_idx
  ON public.dt_seo_gsc_pages (organisation_id, impressions DESC);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_seo_gsc_pages
    BEFORE UPDATE ON public.dt_seo_gsc_pages
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_seo_gsc_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_seo_gsc_pages_select" ON public.dt_seo_gsc_pages;
CREATE POLICY "dt_seo_gsc_pages_select"
ON public.dt_seo_gsc_pages FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

ALTER TABLE public.dt_site_crawls
  ADD COLUMN IF NOT EXISTS gsc_sync_status text;

COMMENT ON COLUMN public.dt_site_crawls.gsc_sync_status IS
  'pending | done | skipped | error — Search Console page list sync for this crawl';
