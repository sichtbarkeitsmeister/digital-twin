-- Background website crawls: resumable chunked crawl via jobs (seo.crawl).

DO $$ BEGIN
  CREATE TYPE public.dt_crawl_status AS ENUM ('queued', 'running', 'done', 'error', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.dt_site_crawls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  status public.dt_crawl_status NOT NULL DEFAULT 'queued',
  source text,
  max_pages integer NOT NULL DEFAULT 5000,
  pages_crawled integer NOT NULL DEFAULT 0,
  pages_discovered integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_site_crawls_org_created_idx
  ON public.dt_site_crawls(organisation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS dt_site_crawls_one_active_per_org_idx
  ON public.dt_site_crawls(organisation_id)
  WHERE status IN ('queued', 'running');

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_site_crawls
    BEFORE UPDATE ON public.dt_site_crawls
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.dt_crawl_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id uuid NOT NULL REFERENCES public.dt_site_crawls(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  depth integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (crawl_id, url)
);

CREATE INDEX IF NOT EXISTS dt_crawl_queue_crawl_status_idx
  ON public.dt_crawl_queue(crawl_id, status);

CREATE INDEX IF NOT EXISTS dt_crawl_queue_org_idx
  ON public.dt_crawl_queue(organisation_id);

ALTER TABLE public.dt_site_crawls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_crawl_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_site_crawls_select" ON public.dt_site_crawls;
CREATE POLICY "dt_site_crawls_select"
ON public.dt_site_crawls FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_crawl_queue_select" ON public.dt_crawl_queue;
CREATE POLICY "dt_crawl_queue_select"
ON public.dt_crawl_queue FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

-- Atomically claim pending URLs for a crawl chunk (SKIP LOCKED).
CREATE OR REPLACE FUNCTION public.dt_claim_crawl_urls(
  p_crawl_id uuid,
  p_limit integer
)
RETURNS TABLE (id uuid, url text, depth integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.dt_crawl_queue q
    WHERE q.crawl_id = p_crawl_id
      AND q.status = 'pending'
    ORDER BY q.depth ASC, q.created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.dt_crawl_queue q
  SET status = 'processing'
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.id, q.url, q.depth;
END;
$$;

REVOKE ALL ON FUNCTION public.dt_claim_crawl_urls(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dt_claim_crawl_urls(uuid, integer) TO service_role;
