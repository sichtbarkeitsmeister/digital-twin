-- „Kernregeln“ of Texte (Globale Prompts): rules that hold in every step of the pipeline
-- (Analyse, SEO, Faktencheck, GEO, Aktualitätsprüfung, Hormozi, Vermenschlichung, Lektorat,
-- Watermark Entfernung, Endabnahme). Before, a block of shared rules had to be kept in sync in
-- each step prompt. NULL or empty means: no Kernregeln, the prompts are as before.
-- The Text-Prompt (texter_prompt) and the Textvorlagen still go to the SEO step only.

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS content_core_rules text;

COMMENT ON COLUMN public.dt_platform_settings.content_core_rules IS
  'Kernregeln der Texte-Pipeline: gelten in jedem Schritt. NULL oder leer = keine. Siehe lib/dt/content/core-rules.ts.';
