-- Interner Agentur-Fragebogen (TEIL C): nicht an den Kunden, nicht in Avatar-Flow.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'survey_purpose'
      AND e.enumlabel = 'intern'
  ) THEN
    ALTER TYPE public.survey_purpose ADD VALUE 'intern';
  END IF;
END
$$;

COMMENT ON COLUMN public.surveys.purpose IS
  'persona = Kunden-Avatar; anbieter = Unternehmenswissen für SEO-Berater; intern = Agentur-Recherche (TEIL C, nicht an den Kunden).';
