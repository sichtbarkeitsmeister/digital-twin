-- Content pipeline (Tab „Texte“): the eight writing steps run inside DigitalTwin as
-- background jobs. Settings, pages and per-step results live here; the browser only
-- reads through /api/dt/content/*. Writes happen with the service role (job runner, routes).

-- 1. Confirmed text settings per organisation (the "Einstellungen für Texte" card).
CREATE TABLE IF NOT EXISTS public.dt_content_settings (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  anrede text NOT NULL CHECK (anrede IN ('Sie', 'Du')),
  branche text NOT NULL CHECK (branche IN ('handwerk', 'rechtsanwalt', 'arzt')),
  tonalitaet text NOT NULL,
  verbotene_woerter text[] NOT NULL DEFAULT '{}'::text[],
  avatar_agent_id uuid REFERENCES public.dt_agents(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_content_settings IS
  'Bestätigte Einstellungen für Seitentexte (Anrede, Branche, Tonalität, verbotene Wörter, Avatar). Eine Zeile pro Organisation.';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_settings
    BEFORE UPDATE ON public.dt_content_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_content_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_content_settings_select" ON public.dt_content_settings;
CREATE POLICY "dt_content_settings_select"
ON public.dt_content_settings FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

-- 2. One row per page of the uploaded website structure.
CREATE TABLE IF NOT EXISTS public.dt_content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  path text,
  level integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  main_keyword text,
  state text NOT NULL DEFAULT 'nicht_begonnen'
    CHECK (state IN ('nicht_begonnen', 'laeuft', 'in_arbeit', 'braucht_sie', 'fertig')),
  step integer CHECK (step IS NULL OR (step >= 1 AND step <= 8)),
  released boolean NOT NULL DEFAULT false,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  released_at timestamptz,
  title text,
  meta_description text,
  html text NOT NULL DEFAULT '',
  markdown text NOT NULL DEFAULT '',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  cost_eur numeric(10, 4) NOT NULL DEFAULT 0,
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  structure_uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, slug)
);

COMMENT ON TABLE public.dt_content_pages IS
  'Seitentexte je Seite der Webseitenstruktur: Zustand, aktueller Text (HTML mit data-block-id), Befunde, Fragen, Kosten.';
COMMENT ON COLUMN public.dt_content_pages.notes IS
  'Anmerkungen aus „Mit Anmerkung wiederholen“ (Fakten und Anweisungen der Redaktion). Jeder spätere Schritt bekommt sie mit.';
COMMENT ON COLUMN public.dt_content_pages.structure_uploaded_at IS
  'uploaded_at der Webseitenstruktur, aus der die Zeile zuletzt abgeglichen wurde. Steuert, wann neu abgeglichen wird.';

CREATE INDEX IF NOT EXISTS dt_content_pages_org_position_idx
  ON public.dt_content_pages (organisation_id, position);
CREATE INDEX IF NOT EXISTS dt_content_pages_org_state_idx
  ON public.dt_content_pages (organisation_id, state);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_pages
    BEFORE UPDATE ON public.dt_content_pages
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_content_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_content_pages_select" ON public.dt_content_pages;
CREATE POLICY "dt_content_pages_select"
ON public.dt_content_pages FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

-- 3. One row per executed step of a page (the "Details: 8 Schritte" list).
CREATE TABLE IF NOT EXISTS public.dt_content_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.dt_content_pages(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  step integer NOT NULL CHECK (step >= 1 AND step <= 8),
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
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (page_id, step)
);

COMMENT ON TABLE public.dt_content_steps IS
  'Ergebnis, Modell, Tokens und Kosten je Schritt (1 Recherche … 8 Endabnahme) einer Seite.';

CREATE INDEX IF NOT EXISTS dt_content_steps_page_idx
  ON public.dt_content_steps (page_id, step);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_steps
    BEFORE UPDATE ON public.dt_content_steps
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_content_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_content_steps_select" ON public.dt_content_steps;
CREATE POLICY "dt_content_steps_select"
ON public.dt_content_steps FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

-- Optional runtime model override (read by the pipeline before each step; see README).
-- Example:
--   insert into public.app_settings (key, value) values ('content_model', 'claude-sonnet-4-6')
--   on conflict (key) do update set value = excluded.value;
