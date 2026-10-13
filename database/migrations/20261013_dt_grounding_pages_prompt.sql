-- Agency-wide Grounding Page rules, edited in SEO → Grounding.
-- NULL/empty keeps the code default. Tool context and Wunschkunden stay outside this text.

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS grounding_pages_prompt text;

COMMENT ON COLUMN public.dt_platform_settings.grounding_pages_prompt IS
  'Optional override for the Grounding Page rules. NULL/empty = code default. {{ZIELGRUPPEN}} is replaced with the organisation profiles when a job starts.';
