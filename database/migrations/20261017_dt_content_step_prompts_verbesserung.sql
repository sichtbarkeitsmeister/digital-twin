-- Texte: two additions, both nullable, NULL keeps today's behaviour.
--
-- 1. Editable step instructions (Globale Prompts → SEO, Faktencheck, GEO, Hormozi,
--    Vermenschlichung, Lektorat). One JSON object for the platform, one key per step:
--    {"seo": "...", "geo": "..."}. NULL, a missing key or an empty text means the default
--    in lib/dt/content/step-prompts.ts. The locked rules, the Texter prompt, the
--    Textvorlagen and the tool schemas stay in code.
--
-- 2. The Excel briefing of the last Seitenstruktur uploaded under Texte, with the mode it
--    was uploaded in: {"mode": "crawl" | "structure", "uploaded_at": "...", "pages": [...]}.
--    In „Verbesserung“ (mode crawl) the upload updates matching pages only; the pages that
--    are not on the website yet are listed from here and created on request, and the
--    overview's structure sync leaves the table alone. Valid only while uploaded_at equals
--    the row's uploaded_at (an upload under SEO → Struktur replaces the structure).

ALTER TABLE public.dt_platform_settings
  ADD COLUMN IF NOT EXISTS content_step_prompts jsonb;

COMMENT ON COLUMN public.dt_platform_settings.content_step_prompts IS
  'Texte: eigene Anweisungen der Schritte SEO, Faktencheck, GEO, Hormozi, Vermenschlichung, Lektorat (Schlüssel seo, faktencheck, geo, hormozi, vermenschlichung, lektorat). NULL oder leer = Standard aus dem Code.';

ALTER TABLE public.dt_website_structures
  ADD COLUMN IF NOT EXISTS content_briefing jsonb;

COMMENT ON COLUMN public.dt_website_structures.content_briefing IS
  'Texte: Excel-Briefing der zuletzt unter Texte hochgeladenen Seitenstruktur ({mode, uploaded_at, pages}). mode crawl = Verbesserung: nur passende Seiten werden aktualisiert, fehlende werden auf Wunsch angelegt.';
