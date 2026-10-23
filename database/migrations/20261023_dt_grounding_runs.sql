-- Grounding check („Website prüfen“): one row per check of an organisation's website against
-- its grounding page. A check crawls the website, builds a fact model, compares it with the
-- live grounding page and, when needed, leaves a DRAFT (grounding.html + llms.txt) for a
-- platform admin to review, approve, download and upload by hand. Nothing is published.
-- The live page and its 3-month rhythm stay in dt_grounding_pages (kind = 'hub').

CREATE TABLE IF NOT EXISTS public.dt_grounding_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'up_to_date', 'draft', 'approved', 'rejected', 'uploaded', 'failed')),
  -- Next step of the background job while running; 'done' afterwards.
  step text NOT NULL DEFAULT 'crawl' CHECK (step IN ('crawl', 'extract', 'compare', 'generate', 'done')),
  decision text CHECK (decision IN ('create', 'update_required', 'refresh_only', 'up_to_date')),
  grounding_url_checked text,
  llms_txt_url_checked text,
  crawled_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Page texts, website JSON-LD and the existing page/llms.txt between the job steps.
  crawl_snapshot jsonb,
  fact_model jsonb,
  existing_fact_model jsonb,
  diff jsonb,
  open_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  hints jsonb,
  validation jsonb,
  draft_html text,
  draft_llms_txt text,
  standard_version text NOT NULL DEFAULT '1.7',
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_eur numeric(10, 4) NOT NULL DEFAULT 0,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_checklist jsonb,
  reviewer_name text,
  review_note text,
  uploaded_at timestamptz,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_url text
);

COMMENT ON TABLE public.dt_grounding_runs IS
  'Grounding check: website vs. grounding page, with draft (grounding.html, llms.txt), human review and manual upload. Never publishes.';
COMMENT ON COLUMN public.dt_grounding_runs.decision IS
  'create = no grounding page found; update_required = facts or v1.7 structure differ; refresh_only = only dates due; up_to_date = nothing to do.';
COMMENT ON COLUMN public.dt_grounding_runs.fact_model IS
  'Facts from the website: entities (Ontology V2 class, schema type), facts with sourceUrl and quote, FAQ, open points, prose.';
COMMENT ON COLUMN public.dt_grounding_runs.existing_fact_model IS
  'Facts read from the live grounding page (HTML, JSON-LD) and its llms.txt.';
COMMENT ON COLUMN public.dt_grounding_runs.diff IS
  'Added / changed / removed / unchanged items and v1.7 structure issues.';
COMMENT ON COLUMN public.dt_grounding_runs.hints IS
  'For the reviewer only: footer link next to Impressum/Datenschutz, robots.txt for AI crawlers, llms.txt.';
COMMENT ON COLUMN public.dt_grounding_runs.reviewer_name IS
  'Admin who approved. Stored here only; the page names the reviewing organisation.';

CREATE INDEX IF NOT EXISTS dt_grounding_runs_org_created_idx
  ON public.dt_grounding_runs (organisation_id, created_at DESC);

-- At most one running check per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS dt_grounding_runs_one_running_idx
  ON public.dt_grounding_runs (organisation_id)
  WHERE status = 'running';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_grounding_runs
    BEFORE UPDATE ON public.dt_grounding_runs
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_grounding_runs ENABLE ROW LEVEL SECURITY;

-- Platform admins only, like the other SEO tables (dt_user_can_access_seo).
DROP POLICY IF EXISTS "dt_grounding_runs_select" ON public.dt_grounding_runs;
CREATE POLICY "dt_grounding_runs_select"
ON public.dt_grounding_runs FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_grounding_runs_write" ON public.dt_grounding_runs;
CREATE POLICY "dt_grounding_runs_write"
ON public.dt_grounding_runs FOR ALL
USING (public.dt_user_can_access_seo(organisation_id))
WITH CHECK (public.dt_user_can_access_seo(organisation_id));

-- Daily sweep: put one `seo.grounding_schedule` job into the queue. The job decides per
-- organisation whether a check is due (lib/dt/seo/grounding-check/schedule.ts) and queues
-- `seo.grounding_check` runs. The jobs runner tick (every 30 s) picks it up.
CREATE OR REPLACE FUNCTION public.dt_grounding_schedule_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  day_key text := 'grounding-schedule:' || to_char(timezone('Europe/Berlin', now()), 'YYYY-MM-DD');
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.jobs
    WHERE kind = 'seo.grounding_schedule' AND dedupe_key = day_key
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.jobs (kind, payload, dedupe_key, max_attempts)
  VALUES ('seo.grounding_schedule', '{}'::jsonb, day_key, 3)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.dt_grounding_schedule_tick() FROM public, anon, authenticated;

DO $$
DECLARE
  existing_job_id integer;
BEGIN
  SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = 'dt_grounding_schedule_daily';
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  -- 04:43 UTC, after the monthly analytics (03:00) and SEO reports (04:00).
  PERFORM cron.schedule(
    'dt_grounding_schedule_daily',
    '43 4 * * *',
    $cron$ select public.dt_grounding_schedule_tick(); $cron$
  );
END $$;
