-- Grounding Pages (Hub) und Entitätsseiten.
-- Die Fälligkeit richtet sich nach lastReviewed (menschliche Prüfung, Standard v1.7),
-- nicht nach dem Upload-Datum oder dateModified.

ALTER TABLE public.dt_org_config
  ADD COLUMN IF NOT EXISTS grounding_page_date_modified timestamptz,
  ADD COLUMN IF NOT EXISTS grounding_page_last_reviewed timestamptz,
  ADD COLUMN IF NOT EXISTS grounding_page_reviewed_by text,
  ADD COLUMN IF NOT EXISTS grounding_page_release_status text,
  ADD COLUMN IF NOT EXISTS grounding_page_standard_version text,
  ADD COLUMN IF NOT EXISTS grounding_customer_slug text,
  ADD COLUMN IF NOT EXISTS grounding_entity_pages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.dt_org_config
  DROP CONSTRAINT IF EXISTS dt_org_config_grounding_release_status_check;

ALTER TABLE public.dt_org_config
  ADD CONSTRAINT dt_org_config_grounding_release_status_check
  CHECK (
    grounding_page_release_status IS NULL
    OR grounding_page_release_status IN ('draft', 'released')
  );

COMMENT ON COLUMN public.dt_org_config.grounding_page_uploaded_at IS
  'When the grounding page file was uploaded. Not the review cadence — that follows grounding_page_last_reviewed.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_date_modified IS
  'dateModified of the live hub page (JSON-LD or equivalent). Distinct from lastReviewed.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_last_reviewed IS
  'Last human fact check of the hub. Next review is due 3 months later; warn 14 days before.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_reviewed_by IS
  'Person or organisation that signed off the hub facts.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_release_status IS
  'draft until a human signs off, released afterwards.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_standard_version IS
  'Grounding Page Standard version the hub was built against, e.g. v1.7.';
COMMENT ON COLUMN public.dt_org_config.grounding_customer_slug IS
  'Short customer name used in file names (grounding_{slug}.html).';
COMMENT ON COLUMN public.dt_org_config.grounding_entity_pages IS
  'Entity pages (spokes): slug, url, upload, dateModified, lastReviewed, reviewer, notes, release status.';

-- One row per chat that was started from the Grounding tab.
-- The chat prompt loader reads this to attach the grounding-page instructions.
CREATE TABLE IF NOT EXISTS public.dt_grounding_jobs (
  chat_id uuid PRIMARY KEY REFERENCES public.dt_chats(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command IN ('erstelle', 'pruefe', 'aktualisiere')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_grounding_jobs IS
  'Grounding-Page-Auftrag (erstellen, prüfen, aktualisieren), ausgelöst im SEO-Tab Grounding.';

CREATE INDEX IF NOT EXISTS dt_grounding_jobs_org_idx
  ON public.dt_grounding_jobs (organisation_id, created_at DESC);

ALTER TABLE public.dt_grounding_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_grounding_jobs_admin" ON public.dt_grounding_jobs;
CREATE POLICY "dt_grounding_jobs_admin"
ON public.dt_grounding_jobs FOR ALL
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));
