-- Texte: nine steps instead of eight. Step 8 is the new „Watermark Entfernung“ (runs on Grok),
-- the Endabnahme moves to step 9. The step columns were limited to 1 … 8 by inline CHECK
-- constraints; they are replaced so step 9 can be stored.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.dt_content_pages'::regclass, 'public.dt_content_steps'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%step%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_step_check CHECK (step IS NULL OR (step >= 1 AND step <= 9));

ALTER TABLE public.dt_content_steps
  ADD CONSTRAINT dt_content_steps_step_check CHECK (step >= 1 AND step <= 9);

COMMENT ON TABLE public.dt_content_steps IS
  'Ergebnis, Modell, Tokens und Kosten je Schritt (1 Analyse … 8 Watermark Entfernung, 9 Endabnahme) einer Seite.';
