ALTER TABLE public.dt_org_config
  ADD COLUMN IF NOT EXISTS grounding_llms_txt_url text;

COMMENT ON COLUMN public.dt_org_config.grounding_llms_txt_url IS
  'Optional override URL for llms.txt (defaults to origin/llms.txt discovery).';
