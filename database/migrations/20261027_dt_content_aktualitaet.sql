-- Texte: ten steps. New step 5 „Aktualitätsprüfung“ (web search after GEO); Hormozi,
-- Vermenschlichung, Lektorat, Watermark Entfernung and Endabnahme move from 5 … 9 to 6 … 10.
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor. No page may be
-- „Läuft“ while it runs: the migration stops with a message if one is (stop them in Texte
-- with „Stoppen“ first). Deploy right afterwards; until then nobody should start pages,
-- because the old code would write steps under the old numbers.
--
-- What it does, in one transaction:
--   1. The step CHECKs on dt_content_steps.step and dt_content_pages.step allow 1 … 10.
--   2. Stored steps 5 … 9 become 6 … 10, so no page needs „Zurücksetzen“. The names stay:
--      after the shift they match the new numbers (Hormozi is step 6, and so on).
--      UNIQUE (page_id, step) must not collide while shifting: first +100, then −99.
--      A page that had already reached a later step (a row at 6 … 10 that is not „pending“)
--      gets step 5 as „skipped“: it finishes in the order it started instead of running the
--      new check after Hormozi. „Mit Anmerkung wiederholen“ from GEO or step 5 runs it.
--      Pages that had not got past GEO run the Aktualitätsprüfung normally.
--   3. dt_content_pages.freshness holds the Aktualitätsprüfung's state across its one
--      send-back to GEO (updates with sources, sections waiting for GEO).
-- Historical usage rows (dt_llm_usage_events.mode = 'content.N') keep their numbers.
--
-- Idempotent: once the step CHECK allows 10, steps 1 and 2 are skipped, so running the file
-- again never shifts twice. Without this migration the new code fails with a message naming
-- this file (contentDbErrorMessage) instead of running a page on the wrong step numbers.

BEGIN;

-- Nobody writes steps or pages while the numbers move (the job worker waits for the commit).
LOCK TABLE public.dt_content_pages, public.dt_content_steps IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  c record;
  running integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.dt_content_steps'::regclass
      AND conname = 'dt_content_steps_step_check'
      AND pg_get_constraintdef(oid) LIKE '%<= 10%'
  ) THEN
    RAISE NOTICE 'dt_content_steps already allows ten steps: renumbering skipped.';
    RETURN;
  END IF;

  SELECT count(*) INTO running FROM public.dt_content_pages WHERE state = 'laeuft';
  IF running > 0 THEN
    RAISE EXCEPTION 'Es laufen noch % Texte-Seite(n). Bitte in Texte „Stoppen“ und die Migration danach erneut ausführen.', running;
  END IF;

  -- 1. Drop every step CHECK (inline ones from 20261006, named ones from 20261011).
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.dt_content_pages'::regclass, 'public.dt_content_steps'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%step%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;

  -- 2. Steps 5 … 9 → 6 … 10 without a UNIQUE (page_id, step) collision.
  UPDATE public.dt_content_steps SET step = step + 100 WHERE step >= 5;
  UPDATE public.dt_content_steps SET step = step - 99 WHERE step >= 105;
  UPDATE public.dt_content_pages SET step = step + 1 WHERE step >= 5;

  INSERT INTO public.dt_content_steps (page_id, organisation_id, step, name, status)
  SELECT DISTINCT s.page_id, s.organisation_id, 5, 'Aktualitätsprüfung', 'skipped'
  FROM public.dt_content_steps s
  WHERE s.step >= 6 AND s.status <> 'pending'
  ON CONFLICT (page_id, step) DO NOTHING;

  ALTER TABLE public.dt_content_pages
    ADD CONSTRAINT dt_content_pages_step_check CHECK (step IS NULL OR (step >= 1 AND step <= 10));
  ALTER TABLE public.dt_content_steps
    ADD CONSTRAINT dt_content_steps_step_check CHECK (step >= 1 AND step <= 10);
END $$;

-- 3. State of the Aktualitätsprüfung.
ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS freshness jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.dt_content_pages.freshness IS
  'Aktualitätsprüfung (Schritt 5): übernommene Aktualisierungen mit Quelle, die einmalige Rückgabe an GEO (sendbacks, pending_sections) und danach offene Abschnitte. Leer bis zum ersten Lauf; „Zurücksetzen“ leert es.';

COMMENT ON TABLE public.dt_content_steps IS
  'Ergebnis, Modell, Tokens und Kosten je Schritt (1 Analyse … 5 Aktualitätsprüfung … 9 Watermark Entfernung, 10 Endabnahme) einer Seite.';

COMMIT;
