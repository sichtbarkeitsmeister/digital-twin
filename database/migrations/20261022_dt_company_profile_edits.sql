-- Customer Firmenprofil edits: live apply + audit log for platform staff.

CREATE TABLE IF NOT EXISTS public.dt_company_profile_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  edited_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  changes jsonb NOT NULL,
  note text,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_company_profile_edits_changes_nonempty CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) > 0
  )
);

COMMENT ON TABLE public.dt_company_profile_edits IS
  'Kundenänderungen am Firmenprofil (Stammdaten, Ansprechpartner, Anbieter-Punkte). Sofort wirksam; Staff sieht die Diffs.';

CREATE INDEX IF NOT EXISTS dt_company_profile_edits_org_created_idx
  ON public.dt_company_profile_edits(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dt_company_profile_edits_unreviewed_idx
  ON public.dt_company_profile_edits(created_at DESC)
  WHERE reviewed_at IS NULL;

ALTER TABLE public.dt_company_profile_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_company_profile_edits_select" ON public.dt_company_profile_edits;
CREATE POLICY "dt_company_profile_edits_select"
ON public.dt_company_profile_edits FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND (
      public.my_org_role(organisation_id) IN ('owner', 'admin')
      OR EXISTS (
        SELECT 1 FROM public.organisations o
        WHERE o.id = dt_company_profile_edits.organisation_id
          AND o.owner_user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "dt_company_profile_edits_insert" ON public.dt_company_profile_edits;
CREATE POLICY "dt_company_profile_edits_insert"
ON public.dt_company_profile_edits FOR INSERT
WITH CHECK (
  edited_by_user_id = auth.uid()
  AND (
    public.is_platform_admin(auth.uid())
    OR public.my_org_role(organisation_id) IN ('owner', 'admin')
    OR EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = dt_company_profile_edits.organisation_id
        AND o.owner_user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "dt_company_profile_edits_update_admin" ON public.dt_company_profile_edits;
CREATE POLICY "dt_company_profile_edits_update_admin"
ON public.dt_company_profile_edits FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));
