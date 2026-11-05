-- Grounding Pages im Design der Kunden-Website: ein Designprofil je Organisation
-- (Farben, Schriften, Überschriften-Stil), aus dem die Grounding Page ihr Inline-CSS baut.
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor (after
-- 20261023_dt_grounding_runs.sql). Without the table the code keeps working: every Grounding
-- Page uses the neutral template as before, the automatic detection during a Grounding check
-- is skipped (a warning in the log), and the card „Design der Grounding Page“ in the
-- Grounding tab names this file instead of the fields.
--
-- Two layers, so manual values always win:
--   detected  – the last automatic detection (homepage + same-origin CSS). Every detection
--               replaces this column as a whole.
--   manual    – values set in the Grounding tab. A detection never writes here.
-- The page uses manual ?? detected per field. enabled = false („Auf Standard zurücksetzen“)
-- renders the neutral template until someone saves the design or detects it again.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dt_grounding_design (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  -- { colors: {text, background, heading, link, accent, muted}, fonts: {body, heading},
  --   typography: {headingWeight, headingLetterSpacing, headingUppercase, baseFontSize}, notes: [] }
  detected jsonb,
  -- Same shape without notes; only fields a person set.
  manual jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz,
  detected_from_url text,
  -- What the last detection read (stylesheets, theme systems, accent candidates), for support.
  detection_report jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_grounding_design IS
  'Design profile of the Grounding Pages per organisation (colours, fonts, heading style). manual wins over detected; enabled = false means neutral template.';
COMMENT ON COLUMN public.dt_grounding_design.detected IS
  'Last automatic detection from the homepage and its same-origin CSS. Fonts: only self-hosted files on the client''s own domain; external fonts are mapped to system stacks (source "external").';
COMMENT ON COLUMN public.dt_grounding_design.manual IS
  'Values set by a person in the Grounding tab. Never overwritten by a detection.';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_grounding_design
    BEFORE UPDATE ON public.dt_grounding_design
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_grounding_design ENABLE ROW LEVEL SECURITY;

-- Platform admins only, like the other Grounding tables (dt_user_can_access_seo).
DROP POLICY IF EXISTS "dt_grounding_design_select" ON public.dt_grounding_design;
CREATE POLICY "dt_grounding_design_select"
ON public.dt_grounding_design FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_grounding_design_write" ON public.dt_grounding_design;
CREATE POLICY "dt_grounding_design_write"
ON public.dt_grounding_design FOR ALL
USING (public.dt_user_can_access_seo(organisation_id))
WITH CHECK (public.dt_user_can_access_seo(organisation_id));

COMMIT;
