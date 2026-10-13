-- Agency-wide Grounding rules, edited in SEO → Grounding.
-- NULL/empty keeps the code default for that block.

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS grounding_mode_prompt text,
  ADD COLUMN IF NOT EXISTS grounding_agent_base_prompt text,
  ADD COLUMN IF NOT EXISTS grounding_agent_standard_prompt text;

COMMENT ON COLUMN public.dt_platform_settings.grounding_mode_prompt IS
  'Optional override for the SEO-chat Grounding switch. NULL/empty = code default.';
COMMENT ON COLUMN public.dt_platform_settings.grounding_agent_base_prompt IS
  'Optional override for the Grounding agent base rules (all four steps). NULL/empty = code default.';
COMMENT ON COLUMN public.dt_platform_settings.grounding_agent_standard_prompt IS
  'Optional override for the Grounding agent page blocks (steps 3 and 4). NULL/empty = code default.';
