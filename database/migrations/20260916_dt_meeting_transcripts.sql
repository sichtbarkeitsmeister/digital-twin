-- Meeting transcripts per organisation (customer interviews after website crawl).
-- Staff upload after a call; the DigitalTwin extracts Anbieter- and Persona-Wissen.

CREATE TABLE IF NOT EXISTS public.dt_meeting_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  filename text,
  mime_type text,
  title text,
  notes text,
  raw_text text NOT NULL,
  summary text,
  anbieter_markdown text,
  personas_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'processed', 'error')),
  error_message text,
  applied_at timestamptz,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_meeting_transcripts IS
  'Kundeninterview-Transkripte. Werden ausgewertet und dem Anbieter- sowie Persona-Wissen zugeordnet.';

CREATE INDEX IF NOT EXISTS dt_meeting_transcripts_org_created_idx
  ON public.dt_meeting_transcripts (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dt_meeting_transcripts_org_status_idx
  ON public.dt_meeting_transcripts (organisation_id, status);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_meeting_transcripts
    BEFORE UPDATE ON public.dt_meeting_transcripts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_meeting_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_meeting_transcripts_select" ON public.dt_meeting_transcripts;
CREATE POLICY "dt_meeting_transcripts_select"
ON public.dt_meeting_transcripts FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_meeting_transcripts_write" ON public.dt_meeting_transcripts;
CREATE POLICY "dt_meeting_transcripts_write"
ON public.dt_meeting_transcripts FOR ALL
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);
