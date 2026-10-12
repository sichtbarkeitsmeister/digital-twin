-- Grounding Pages je Organisation (Hub + Entitätsseiten), Grounding Page Standard v1.7.
-- Fälligkeit richtet sich nach last_reviewed (letzte menschliche Faktenprüfung),
-- nicht nach uploaded_at oder date_modified.

CREATE TABLE IF NOT EXISTS public.dt_grounding_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'entity' CHECK (kind IN ('hub', 'entity')),
  url text NOT NULL,
  entity_name text,
  slug text,
  -- Standardversion, die die Seite selbst ausweist (z. B. '1.6' Entwurf, '1.7' nach Prüfung).
  standard_version text,
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'approved')),
  uploaded_at timestamptz,
  date_modified timestamptz,
  last_reviewed timestamptz,
  reviewed_by text,
  notes text,
  position integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_grounding_pages_url_len CHECK (char_length(url) BETWEEN 8 AND 2000),
  CONSTRAINT dt_grounding_pages_last_reviewed_not_future
    CHECK (last_reviewed IS NULL OR last_reviewed <= timezone('utc'::text, now()) + interval '1 day'),
  UNIQUE (organisation_id, url)
);

COMMENT ON TABLE public.dt_grounding_pages IS
  'Grounding Pages (Hub + Entitätsseiten) je Organisation. Fälligkeit nach last_reviewed (+3 Monate), Frühwarnung 14 Tage vorher.';
COMMENT ON COLUMN public.dt_grounding_pages.kind IS 'hub = Haupt-Grounding-Page der Organisation, entity = Entitätsseite (Spoke).';
COMMENT ON COLUMN public.dt_grounding_pages.standard_version IS 'Standardversion laut Seite (z. B. 1.6 ohne, 1.7 mit dokumentierter Prüfung).';
COMMENT ON COLUMN public.dt_grounding_pages.review_status IS 'draft = Entwurf / Prüfung ausstehend, approved = menschlich geprüft und freigegeben.';
COMMENT ON COLUMN public.dt_grounding_pages.uploaded_at IS 'Wann die Seite hochgeladen / veröffentlicht wurde.';
COMMENT ON COLUMN public.dt_grounding_pages.date_modified IS 'dateModified der Seite (letzte inhaltliche Änderung).';
COMMENT ON COLUMN public.dt_grounding_pages.last_reviewed IS 'lastReviewed: Datum der letzten dokumentierten menschlichen Faktenprüfung. Nie in der Zukunft.';
COMMENT ON COLUMN public.dt_grounding_pages.reviewed_by IS 'reviewedBy: Person oder Organisation, die geprüft hat.';

-- Genau ein Hub je Organisation.
CREATE UNIQUE INDEX IF NOT EXISTS dt_grounding_pages_one_hub_per_org_idx
  ON public.dt_grounding_pages(organisation_id)
  WHERE kind = 'hub';

CREATE INDEX IF NOT EXISTS dt_grounding_pages_org_position_idx
  ON public.dt_grounding_pages(organisation_id, kind, position, created_at);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_grounding_pages
    BEFORE UPDATE ON public.dt_grounding_pages
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.dt_grounding_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_grounding_pages_select" ON public.dt_grounding_pages;
CREATE POLICY "dt_grounding_pages_select"
ON public.dt_grounding_pages FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_grounding_pages_write" ON public.dt_grounding_pages;
CREATE POLICY "dt_grounding_pages_write"
ON public.dt_grounding_pages FOR ALL
USING (public.dt_user_can_access_seo(organisation_id))
WITH CHECK (public.dt_user_can_access_seo(organisation_id));

-- Backfill: bisherigen Hub aus dt_org_config übernehmen (einmalig, idempotent).
INSERT INTO public.dt_grounding_pages (
  organisation_id, kind, url, uploaded_at, notes, position
)
SELECT
  c.organisation_id,
  'hub',
  c.grounding_page_url,
  c.grounding_page_uploaded_at,
  c.grounding_page_notes,
  0
FROM public.dt_org_config c
WHERE c.grounding_page_url IS NOT NULL
  AND char_length(c.grounding_page_url) >= 8
  AND NOT EXISTS (
    SELECT 1 FROM public.dt_grounding_pages g
    WHERE g.organisation_id = c.organisation_id AND g.kind = 'hub'
  )
ON CONFLICT (organisation_id, url) DO NOTHING;

COMMENT ON COLUMN public.dt_org_config.grounding_page_url IS
  'Veraltet: Hub-URL liegt in dt_grounding_pages (kind = hub). Wird nur noch für Alt-Daten gelesen.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_uploaded_at IS
  'Veraltet: siehe dt_grounding_pages.uploaded_at / last_reviewed.';
COMMENT ON COLUMN public.dt_org_config.grounding_page_notes IS
  'Veraltet: siehe dt_grounding_pages.notes.';
