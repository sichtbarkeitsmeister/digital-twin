-- Texte: the Branche of the text settings is free text now („Zahnarztpraxis“, „Umzugsunternehmen“),
-- typed by the SEO specialist or pre-filled from the client data. The three former fixed values
-- become their labels. Run once in the Supabase SQL Editor; safe to run again.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.dt_content_settings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%branche%'
  LOOP
    EXECUTE format('ALTER TABLE public.dt_content_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.dt_content_settings
  ADD CONSTRAINT dt_content_settings_branche_length CHECK (char_length(branche) <= 80);

UPDATE public.dt_content_settings
SET branche = CASE branche
  WHEN 'handwerk' THEN 'Handwerk & Dienstleistung'
  WHEN 'rechtsanwalt' THEN 'Rechtsanwalt & Kanzlei'
  WHEN 'arzt' THEN 'Arzt & Praxis'
  ELSE branche
END
WHERE branche IN ('handwerk', 'rechtsanwalt', 'arzt');

COMMENT ON COLUMN public.dt_content_settings.branche IS
  'Branche des Kunden als freier Text (vom SEO-Spezialisten eingetragen oder aus den Anbieterfakten vorbelegt), höchstens 80 Zeichen.';
