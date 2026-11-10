-- Texte → Seitenquelle → „Verbesserung“: second source „Texte hochladen“ (Word files).
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor, after
-- 20261104_dt_content_fewer_questions.sql. Without it „Texte hochladen“ shows a message naming
-- this file and stores nothing; everything else in Texte („Neue Website“, „Website crawlen“,
-- every running page) keeps working, because the new code reads the new table only for
-- „Texte hochladen“ and for pages with source „upload“, which cannot exist before this ran.
--
-- What it does:
--   1. dt_content_text_uploads: one row per uploaded Word file of an organisation. Only the
--      extracted text is stored (sections as jsonb, title, meta description), never the
--      original file. A file is matched to a page of the Seitenstruktur by its name (fixed
--      rules in code, lib/dt/content/upload-match.ts; no AI) or by hand.
--   2. dt_content_pages.source also allows 'upload': the page's existing text comes from a
--      Word file instead of the live website (source_url stays null).
--   3. dt_content_pages.text_upload_id: the file a page uses.
--
-- Idempotent: table, indexes, column and policy are created only once / dropped and created again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dt_content_text_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  -- pageNameKey(file_name): what the file is compared by with the page names.
  name_key text NOT NULL,
  format text NOT NULL DEFAULT 'docx' CHECK (format IN ('docx')),
  -- ContentTextBlock[] as the ingest read them ([] when the file could not be read).
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  title text,
  meta_description text,
  chars integer NOT NULL DEFAULT 0,
  block_count integer NOT NULL DEFAULT 0,
  -- ContentBriefingPage.slug of the assigned page of the Seitenstruktur.
  structure_slug text,
  match text CHECK (match IS NULL OR match IN ('auto', 'manual')),
  match_note text,
  page_id uuid REFERENCES public.dt_content_pages(id) ON DELETE SET NULL,
  error text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_content_text_uploads_org_name_key UNIQUE (organisation_id, name_key)
);

COMMENT ON TABLE public.dt_content_text_uploads IS
  'Texte → Verbesserung → „Texte hochladen“: je hochgeladener Word-Datei der ausgelesene Text (Abschnitte), nicht die Originaldatei. Dateiname = Seitenname; Zuordnung zur Seitenstruktur per fester Namensregel (match auto) oder von Hand (match manual; structure_slug null = von Hand gelöst oder Seite nicht mehr in der Seitenstruktur).';
COMMENT ON COLUMN public.dt_content_text_uploads.page_id IS
  'Zeile der Texte-Tabelle, die diesen Text nutzt (gesetzt durch „Zugeordnete Seiten übernehmen“).';
COMMENT ON COLUMN public.dt_content_text_uploads.error IS
  'Warum die Datei nicht gelesen werden konnte (null = lesbar). Solche Dateien werden nie zugeordnet.';

CREATE INDEX IF NOT EXISTS dt_content_text_uploads_org_idx
  ON public.dt_content_text_uploads (organisation_id, uploaded_at);
CREATE INDEX IF NOT EXISTS dt_content_text_uploads_page_idx
  ON public.dt_content_text_uploads (page_id) WHERE page_id IS NOT NULL;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_text_uploads
    BEFORE UPDATE ON public.dt_content_text_uploads
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_content_text_uploads ENABLE ROW LEVEL SECURITY;

-- Like every Texte table: read for whoever may use Texte; writes through the service client.
DROP POLICY IF EXISTS "dt_content_text_uploads_select" ON public.dt_content_text_uploads;
CREATE POLICY "dt_content_text_uploads_select"
ON public.dt_content_text_uploads FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

ALTER TABLE public.dt_content_pages DROP CONSTRAINT IF EXISTS dt_content_pages_source_check;
ALTER TABLE public.dt_content_pages
  ADD CONSTRAINT dt_content_pages_source_check CHECK (source IN ('structure', 'crawl', 'upload'));

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS text_upload_id uuid REFERENCES public.dt_content_text_uploads(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dt_content_pages.source IS
  'structure = aus der hochgeladenen Seitenstruktur, crawl = aus dem Crawl der bestehenden Website übernommen, upload = bisheriger Text aus einer hochgeladenen Word-Datei (Website noch nicht live).';
COMMENT ON COLUMN public.dt_content_pages.text_upload_id IS
  'Die Word-Datei (dt_content_text_uploads), deren Text die Seite als bisherigen Text nutzt (source upload).';

COMMIT;
