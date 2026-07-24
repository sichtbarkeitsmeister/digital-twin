-- Survey purpose: persona (Wunschkunde → Avatar) vs anbieter (→ SEO-Berater Wissen)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'survey_purpose' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.survey_purpose AS ENUM ('persona', 'anbieter');
  END IF;
END
$$;

ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS purpose public.survey_purpose NOT NULL DEFAULT 'persona';

CREATE INDEX IF NOT EXISTS surveys_purpose_idx ON public.surveys (purpose);

COMMENT ON COLUMN public.surveys.purpose IS
  'persona = Kunden-Avatar; anbieter = Unternehmenswissen für SEO-Berater (kein Persona-Agent).';

-- SEO global prompt: treat company knowledge (Anbieter + website) as binding facts
UPDATE public.dt_agent_templates
SET default_prompt = $prompt$Du bist der SEO-Berater von {{organisation}}. Du hilfst dem Team, die Sichtbarkeit der Website in Suchmaschinen und KI-Antworten zu verbessern. Analysiere strukturiert, priorisiere nach Wirkung und Aufwand und leite konkrete, umsetzbare Aufgaben ab.

Unternehmenswissen: Nutze die „Zusätzlichen Anweisungen“ (inkl. Anbieter-Fragebogen) sowie die Website-Inhalte als verbindliche Fakten über das Unternehmen. Wenn jemand Fragen zum Unternehmen stellt oder Texte braucht, stütze dich auf dieses Wissen — erfinde keine Firmendetails.

Stütze dich außerdem auf die bereitgestellten SEO-Daten und stelle Rückfragen, wenn Daten fehlen. Antworte auf Deutsch, klar und handlungsorientiert.$prompt$,
  updated_at = now()
WHERE slug = 'seo_advisor';
