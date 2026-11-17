-- Texte: a new page type „Hauptsilo Standort-Übersicht“ (key hauptsilo_standort) with its own
-- writing recipe. A Hauptsilo page whose topic is the locations: the overview of all Standorte
-- or the Einzugsgebiet. It links every Standortseite, says what is the same everywhere and
-- what differs per location, and helps the visitor pick the right one. Not a single
-- Standortseite and not a service silo (Hauptsilo-Seite).
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor. Independent of
-- 20261117_dt_content_upload_ai_match.sql. Until it ran, the Seitentyp cannot be saved on a
-- page (the message names this file), the Textvorlagen cannot be saved, and the type writes
-- with the default recipe; everything else in Texte keeps working.
--
-- Like the Hauptseite (20261017) the type is never derived from the Seitenstruktur or guessed
-- from the crawl; it is chosen by hand. Existing rows keep their page_type. The recipe starts
-- empty; empty means the default in lib/dt/content/type-prompts.ts. The column is on the table
-- both sets of recipes share, so the row of Texte (id = agency) and the row of the SEO tool
-- (id = seo_tool, Verwaltung → SEO) get it at once.
--
-- Idempotent: columns are added only once, the constraint is dropped and created again.

BEGIN;

-- The columns of the earlier migrations too, in case one of them was skipped.
ALTER TABLE public.dt_content_type_prompts
  ADD COLUMN IF NOT EXISTS startseite text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ueber_uns text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hauptseite text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hauptsilo_standort text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dt_content_type_prompts.hauptsilo_standort IS
  'Textvorlage für die Hauptsilo Standort-Übersicht: Übersicht aller Standorte bzw. des Einzugsgebiets, verlinkt die Standortseiten. Leer = Standard aus dem Code.';

COMMENT ON TABLE public.dt_content_type_prompts IS
  'Textvorlagen je Seitentyp (Hauptsilo-Seite, Hauptsilo Standort-Übersicht, Hauptseite, Unterseite, Ratgeberartikel, Standortseite, Startseite, Über-uns-Seite). id = agency: SEO-Schritt von Texte. id = seo_tool: Werkzeug Verwaltung → SEO, unabhängig von Texte.';

ALTER TABLE public.dt_content_pages DROP CONSTRAINT IF EXISTS dt_content_pages_page_type_check;
ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_page_type_check
  CHECK (page_type IS NULL OR page_type IN ('hauptsilo', 'hauptsilo_standort', 'hauptseite', 'unterseite', 'ratgeber', 'standort', 'startseite', 'ueber_uns', 'nicht_bearbeiten'));

COMMENT ON COLUMN public.dt_content_pages.page_type IS
  'Seitentyp, der den SEO-Text steuert: hauptsilo, hauptsilo_standort, hauptseite, unterseite, ratgeber, standort, startseite, ueber_uns oder nicht_bearbeiten (Impressum, Datenschutz, Kontakt …). Aus der Struktur abgeleitet oder im Crawl geraten; Hauptseite und Hauptsilo Standort-Übersicht nur von Hand gewählt.';

COMMIT;
