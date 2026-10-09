-- Texte: editable writing recipes per page type („Textvorlagen“). One row for the whole
-- agency, not per organisation. The SEO step (step 2) reads the recipe of the page's type;
-- the other steps keep their fixed rules. An empty table means the defaults in
-- lib/dt/content/type-prompts.ts apply.

CREATE TABLE IF NOT EXISTS public.dt_content_type_prompts (
  id text PRIMARY KEY DEFAULT 'agency' CHECK (id = 'agency'),
  hauptsilo text NOT NULL,
  unterseite text NOT NULL,
  ratgeber text NOT NULL,
  standort text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_email text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_content_type_prompts IS
  'Textvorlagen je Seitentyp für den SEO-Schritt von Texte (Hauptsilo-Seite, Unterseite, Ratgeberartikel, Standortseite). Eine Zeile (id = agency) für die ganze Agentur.';
COMMENT ON COLUMN public.dt_content_type_prompts.updated_by_email IS
  'E-Mail der Person, die zuletzt gespeichert hat (für „Zuletzt geändert“ in der Oberfläche).';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_type_prompts
    BEFORE UPDATE ON public.dt_content_type_prompts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only the server reads and writes this table (service role, behind the Texte access check);
-- the browser never touches it, so no policy is needed.
ALTER TABLE public.dt_content_type_prompts ENABLE ROW LEVEL SECURITY;
