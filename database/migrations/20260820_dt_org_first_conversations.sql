-- Erstgespräch / Kundendefinition: one persisted briefing per organisation.

CREATE TABLE IF NOT EXISTS public.dt_org_first_conversations (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_org_first_conversations IS
  'Agentur-Erstgespräch / Kundendefinition. Wird vor Fragebögen geführt und als Prefill übernommen.';

CREATE INDEX IF NOT EXISTS dt_org_first_conversations_updated_idx
  ON public.dt_org_first_conversations(updated_at DESC);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_org_first_conversations
    BEFORE UPDATE ON public.dt_org_first_conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.dt_org_first_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_org_first_conversations_select" ON public.dt_org_first_conversations;
CREATE POLICY "dt_org_first_conversations_select"
ON public.dt_org_first_conversations FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_first_conversations_write_admin" ON public.dt_org_first_conversations;
CREATE POLICY "dt_org_first_conversations_write_admin"
ON public.dt_org_first_conversations FOR ALL
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
