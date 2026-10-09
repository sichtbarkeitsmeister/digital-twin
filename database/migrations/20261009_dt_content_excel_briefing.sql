-- Texte: the Excel-Seitenstruktur is a briefing, not a sitemap. Besides name and path a
-- page row now carries what the agency's Excel knows about the page (role in the silo,
-- page type, keywords with search volume, H1 options, real user questions, a standing
-- KI-Prompt, allowed internal link targets). Crawl pages get a guessed page_type only.

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS page_role text
    CHECK (page_role IS NULL OR page_role IN ('startseite', 'pillar', 'supporting')),
  ADD COLUMN IF NOT EXISTS page_type text
    CHECK (page_type IS NULL OR page_type IN ('hauptsilo', 'unterseite', 'ratgeber', 'standort', 'nicht_bearbeiten')),
  ADD COLUMN IF NOT EXISTS pillar_name text,
  ADD COLUMN IF NOT EXISTS estimated_traffic integer,
  ADD COLUMN IF NOT EXISTS keywords jsonb,
  ADD COLUMN IF NOT EXISTS h1_options text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS user_questions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ki_prompt text,
  ADD COLUMN IF NOT EXISTS internal_link_targets text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.dt_content_pages.page_role IS
  'Rolle in der Seitenstruktur: startseite, pillar (Hauptsilo, Ebene 1) oder supporting (Unterseite, Ebene 2). NULL bei Crawl-Seiten.';
COMMENT ON COLUMN public.dt_content_pages.page_type IS
  'Seitentyp, der den SEO-Text steuert: hauptsilo, unterseite, ratgeber, standort oder nicht_bearbeiten (Impressum, Datenschutz, Kontakt …). Aus der Struktur abgeleitet, in der Redaktion änderbar.';
COMMENT ON COLUMN public.dt_content_pages.pillar_name IS
  'Name der Hauptsilo-Seite, zu der eine Unterseite gehört (letzte Ebene-1-Zeile darüber in der Excel).';
COMMENT ON COLUMN public.dt_content_pages.estimated_traffic IS
  'Spalte Traffic der Excel-Seitenstruktur, wenn vorhanden. Nie geschätzt.';
COMMENT ON COLUMN public.dt_content_pages.keywords IS
  'Spalte Keywords: {"main": {"text", "volume"?}, "secondary": [{"text", "volume"?}]}. Das erste Keyword ist das Hauptkeyword; Volumen nur, wenn es in der Zelle stand.';
COMMENT ON COLUMN public.dt_content_pages.h1_options IS
  'Spalte H1-Optionen, eine je Zeile, ohne „Option A:“-Präfix.';
COMMENT ON COLUMN public.dt_content_pages.user_questions IS
  'Spalte Nutzerfragen: echte Google-Fragen, eine je Zeile. Haben in der Analyse Vorrang vor erfundenen Fragen.';
COMMENT ON COLUMN public.dt_content_pages.ki_prompt IS
  'Spalte KI-Prompt / Prompt / Content-Prompt: stehende Anweisung der Redaktion für diese Seite.';
COMMENT ON COLUMN public.dt_content_pages.internal_link_targets IS
  'Namen anderer Seiten derselben Excel, auf die der Text verlinken darf. Eine Unterseite enthält immer ihr Hauptsilo.';

-- Rows from before this migration: a usable page type so the SEO step knows which variant to
-- write. Ratgeber by name, otherwise the depth decides: structure rows counted the tree depth
-- (0 = top level), crawl rows the path segments (1 = top level). Editors can change it in the drawer.
UPDATE public.dt_content_pages
SET page_type = CASE
  WHEN name ILIKE '%ratgeber%' OR slug ILIKE '%ratgeber%' THEN 'ratgeber'
  WHEN source = 'crawl' AND level >= 2 THEN 'unterseite'
  WHEN source = 'structure' AND level >= 1 THEN 'unterseite'
  ELSE 'hauptsilo'
END
WHERE page_type IS NULL;
