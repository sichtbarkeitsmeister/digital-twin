-- Editable general Texter prompt (Globale Prompts). NULL or empty means the default
-- in lib/dt/content/texter-prompt.ts. The SEO step of Texte reads it; the six
-- Textvorlagen stay on dt_content_type_prompts.

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS texter_prompt text;

COMMENT ON COLUMN public.dt_platform_settings.texter_prompt IS
  'Allgemeine Regeln des Texter-Modus für jeden Seitentyp. NULL oder leer = Standard aus dem Code. Die Textvorlagen je Seitentyp gelten bei Widerspruch.';
