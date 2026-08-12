-- Grounding page cadence tracking (manual until automation exists).
ALTER TABLE public.dt_org_config
  ADD COLUMN IF NOT EXISTS grounding_page_url text,
  ADD COLUMN IF NOT EXISTS grounding_page_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS grounding_page_notes text;

COMMENT ON COLUMN public.dt_org_config.grounding_page_url IS
  'URL of the org grounding page (LLM/GEO); optional until automation uploads.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_uploaded_at IS
  'When the grounding page was last uploaded / published. Refresh due every 3 months; warn 2 weeks before.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_notes IS
  'Optional notes about the latest grounding page upload.';
