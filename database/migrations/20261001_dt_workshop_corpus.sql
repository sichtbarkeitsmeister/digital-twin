-- Workshop corpus: transcripts are one body of evidence per organisation.
-- Conversation date orders them. Later statements on the same point win.
-- Anbieter knowledge reaches the SEO advisor only after an explicit approval.

ALTER TABLE public.dt_meeting_transcripts
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'raw';

ALTER TABLE public.dt_meeting_transcripts
  DROP CONSTRAINT IF EXISTS dt_meeting_transcripts_source_kind_check;

ALTER TABLE public.dt_meeting_transcripts
  ADD CONSTRAINT dt_meeting_transcripts_source_kind_check
  CHECK (source_kind IN ('raw', 'summary'));

ALTER TABLE public.dt_meeting_transcripts
  ADD COLUMN IF NOT EXISTS spoken_on date;

COMMENT ON COLUMN public.dt_meeting_transcripts.source_kind IS
  'raw = Wortlaut, summary = mitgebrachte Zusammenfassung. Der Wortlaut bleibt liegen.';
COMMENT ON COLUMN public.dt_meeting_transcripts.spoken_on IS
  'Datum des Gesprächs. Der Bestand wird danach sortiert, nicht nach dem Upload.';

CREATE TABLE IF NOT EXISTS public.dt_workshop_corpus (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  anbieter jsonb NOT NULL DEFAULT '{}'::jsonb,
  avatar_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_workshop_corpus IS
  'Gemeinsame Auswertung aller Transkripte einer Organisation. SEO-Text und Avatare entstehen erst nach Freigabe.';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_workshop_corpus
    BEFORE UPDATE ON public.dt_workshop_corpus
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_workshop_corpus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_workshop_corpus_select" ON public.dt_workshop_corpus;
CREATE POLICY "dt_workshop_corpus_select"
ON public.dt_workshop_corpus FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_workshop_corpus_write" ON public.dt_workshop_corpus;
CREATE POLICY "dt_workshop_corpus_write"
ON public.dt_workshop_corpus FOR ALL
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
