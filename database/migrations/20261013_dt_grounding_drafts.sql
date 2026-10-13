-- Grounding-Agent: eine Grounding Page (Hub oder Entitätsseite) wird Schritt für Schritt als
-- Hintergrund-Job erstellt (1 Fakten sammeln, 2 Faktencheck, 3 Seite bauen, 4 Endprüfung).
-- Der Entwurf (Faktenbasis, Fragen, Befunde, HTML) liegt an der Seite in dt_grounding_pages;
-- je Schritt eine Zeile in dt_grounding_steps (Modell, Tokens, Kosten, Ergebnis).

ALTER TABLE public.dt_grounding_pages
  ADD COLUMN IF NOT EXISTS run_state text NOT NULL DEFAULT 'nicht_begonnen'
    CHECK (run_state IN ('nicht_begonnen', 'laeuft', 'in_arbeit', 'braucht_sie', 'fertig')),
  ADD COLUMN IF NOT EXISTS run_step integer CHECK (run_step IS NULL OR (run_step >= 1 AND run_step <= 4)),
  ADD COLUMN IF NOT EXISTS run_error text,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS facts jsonb,
  ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS run_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS html text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS cost_eur numeric(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dt_grounding_pages.run_state IS
  'Entwurf des Grounding-Agenten: nicht_begonnen, laeuft, in_arbeit (pausiert mit Grund), braucht_sie (Fragen an den Kunden), fertig (HTML bereit zur menschlichen Prüfung).';
COMMENT ON COLUMN public.dt_grounding_pages.facts IS
  'Faktenbasis aus Schritt 1 (Entität, Kerndaten mit Quellen, Abschnitte, FAQ, offene Fragen, Entitätskandidaten beim Hub).';
COMMENT ON COLUMN public.dt_grounding_pages.run_notes IS
  'Antworten und Anmerkungen der Redaktion; jeder spätere Schritt bekommt sie mit.';
COMMENT ON COLUMN public.dt_grounding_pages.html IS
  'Fertige HTML-Datei des Entwurfs (Standard v1.6 ohne Prüfhinweis) zum Einfügen auf der Website.';

CREATE TABLE IF NOT EXISTS public.dt_grounding_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.dt_grounding_pages(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  step integer NOT NULL CHECK (step >= 1 AND step <= 4),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'waiting', 'done', 'error', 'skipped')),
  output jsonb,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_eur numeric(10, 4) NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (page_id, step)
);

COMMENT ON TABLE public.dt_grounding_steps IS
  'Ergebnis, Modell, Tokens und Kosten je Schritt (1 Fakten sammeln … 4 Endprüfung) einer Grounding Page.';

CREATE INDEX IF NOT EXISTS dt_grounding_steps_page_idx ON public.dt_grounding_steps (page_id, step);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_grounding_steps
    BEFORE UPDATE ON public.dt_grounding_steps
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_grounding_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_grounding_steps_select" ON public.dt_grounding_steps;
CREATE POLICY "dt_grounding_steps_select"
ON public.dt_grounding_steps FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));
