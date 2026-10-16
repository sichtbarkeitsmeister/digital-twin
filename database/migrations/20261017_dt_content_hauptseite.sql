-- Texte: a new page type „Hauptseite“ (key hauptseite) with its own writing recipe.
-- The main page of one offer that has no Unterseiten: the whole offer and a next step,
-- links to the Startseite and to related pages that already exist. Not the homepage
-- (Startseite) and not a silo overview (Hauptsilo-Seite).
--
-- It is never derived from the Seitenstruktur or guessed from the crawl; it is chosen by
-- hand. Existing rows keep their page_type. The recipe starts empty; empty means the
-- default in lib/dt/content/type-prompts.ts.

ALTER TABLE public.dt_content_type_prompts
  ADD COLUMN IF NOT EXISTS hauptseite text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dt_content_type_prompts.hauptseite IS
  'Textvorlage für die Hauptseite: eine Leistung als eigene Seite, ohne Unterseiten. Leer = Standard aus dem Code.';

COMMENT ON TABLE public.dt_content_type_prompts IS
  'Textvorlagen je Seitentyp für den SEO-Schritt von Texte (Hauptsilo-Seite, Hauptseite, Unterseite, Ratgeberartikel, Standortseite, Startseite, Über-uns-Seite). Eine Zeile (id = agency) für die ganze Agentur.';

ALTER TABLE public.dt_content_pages DROP CONSTRAINT IF EXISTS dt_content_pages_page_type_check;
ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_page_type_check
  CHECK (page_type IS NULL OR page_type IN ('hauptsilo', 'hauptseite', 'unterseite', 'ratgeber', 'standort', 'startseite', 'ueber_uns', 'nicht_bearbeiten'));

COMMENT ON COLUMN public.dt_content_pages.page_type IS
  'Seitentyp, der den SEO-Text steuert: hauptsilo, hauptseite, unterseite, ratgeber, standort, startseite, ueber_uns oder nicht_bearbeiten (Impressum, Datenschutz, Kontakt …). Aus der Struktur abgeleitet oder im Crawl geraten, Hauptseite nur von Hand gewählt.';
