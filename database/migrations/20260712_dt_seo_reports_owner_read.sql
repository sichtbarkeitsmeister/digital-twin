-- Org owners may read SEO reports for their organisation (read-only; full SEO workspace stays platform-admin).

CREATE OR REPLACE FUNCTION public.dt_user_can_view_org_seo_reports(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.organisation_members om
      WHERE om.organisation_id = p_org_id
        AND om.user_id = auth.uid()
        AND om.org_role = 'owner'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organisations o
      WHERE o.id = p_org_id
        AND o.owner_user_id = auth.uid()
    );
$$;

DROP POLICY IF EXISTS "dt_seo_reports_select" ON public.dt_seo_reports;
CREATE POLICY "dt_seo_reports_select"
ON public.dt_seo_reports FOR SELECT
USING (
  public.dt_user_can_access_seo(organisation_id)
  OR public.dt_user_can_view_org_seo_reports(organisation_id)
);
