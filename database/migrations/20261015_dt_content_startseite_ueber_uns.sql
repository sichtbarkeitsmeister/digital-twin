-- Texte: two more writing recipes („Textvorlagen“) and the page types that use them.
-- Startseite (the homepage) and Über-uns-Seite. The recipes start empty; the agency
-- fills them in the Textvorlagen card. Existing rows keep their current page_type until
-- the next structure upload or crawl import.

ALTER TABLE public.dt_content_type_prompts
  ADD COLUMN IF NOT EXISTS startseite text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ueber_uns text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dt_content_type_prompts.startseite IS
  'Textvorlage für die Startseite (Hauptseite). Leer, bis die Agentur sie in Texte einträgt.';
COMMENT ON COLUMN public.dt_content_type_prompts.ueber_uns IS
  'Textvorlage für die Über-uns-Seite. Leer, bis die Agentur sie in Texte einträgt.';

COMMENT ON TABLE public.dt_content_type_prompts IS
  'Textvorlagen je Seitentyp für den SEO-Schritt von Texte (Hauptsilo-Seite, Unterseite, Ratgeberartikel, Standortseite, Startseite, Über-uns-Seite). Eine Zeile (id = agency) für die ganze Agentur.';

ALTER TABLE public.dt_content_pages DROP CONSTRAINT IF EXISTS dt_content_pages_page_type_check;
ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_page_type_check
  CHECK (page_type IS NULL OR page_type IN ('hauptsilo', 'unterseite', 'ratgeber', 'standort', 'startseite', 'ueber_uns', 'nicht_bearbeiten'));

COMMENT ON COLUMN public.dt_content_pages.page_type IS
  'Seitentyp, der den SEO-Text steuert: hauptsilo, unterseite, ratgeber, standort, startseite, ueber_uns oder nicht_bearbeiten (Impressum, Datenschutz, Kontakt …). Aus der Struktur abgeleitet, in der Redaktion änderbar.';
