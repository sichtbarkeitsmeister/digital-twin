-- Editable global Text-Modus prompt (injected when the chat Text toggle is on).

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS text_mode_prompt text;

COMMENT ON COLUMN public.dt_platform_settings.text_mode_prompt IS
  'Optional override for the Text-Modus system-prompt block. NULL/empty = code default.';
