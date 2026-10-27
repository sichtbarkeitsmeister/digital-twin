-- Texte: switch off single steps for one page („Schritte“ in the page window).
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor. The new code reads
-- dt_content_pages.skip_steps everywhere; without the column Texte shows a message naming
-- this file (contentDbErrorMessage) and no page runs. Nothing else changes: no step is
-- renumbered, no page needs „Zurücksetzen“, and pages may be „Läuft“ while it runs.
--
-- What it does:
--   1. dt_content_pages.skip_steps: the steps the editor switched off for this page, by
--      stable key (not by number, so a future new step needs no data migration). When the
--      run reaches such a step it is marked „skipped“: no AI call, 0 €, the text goes on
--      unchanged (SEO on crawl pages: the live text becomes the starting text).
--   2. A CHECK that allows only the keys that can be switched off. Analyse and Endabnahme
--      always run and are not in the list.
-- The list belongs to the page like page_type: „Zurücksetzen“ keeps it, „Löschen“ removes
-- it with the row, Excel upload, structure sync and crawl import never write it.
--
-- Idempotent: the column is added only once, the CHECK is dropped and added again.

BEGIN;

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS skip_steps text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.dt_content_pages
  DROP CONSTRAINT IF EXISTS dt_content_pages_skip_steps_check;

ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_skip_steps_check CHECK (
    skip_steps <@ ARRAY['seo', 'faktencheck', 'geo', 'aktualitaet', 'hormozi', 'vermenschlichung', 'lektorat', 'watermark']::text[]
  );

COMMENT ON COLUMN public.dt_content_pages.skip_steps IS
  'Schritte, die die Redaktion für diese Seite abgeschaltet hat (Schlüssel: seo, faktencheck, geo, aktualitaet, hormozi, vermenschlichung, lektorat, watermark). Erreicht der Lauf einen davon, wird er als „skipped“ markiert: kein KI-Aufruf, 0 €. SEO nur bei Crawl-Seiten (der Live-Text wird übernommen). Analyse und Endabnahme laufen immer. „Zurücksetzen“ behält die Liste.';

COMMIT;
