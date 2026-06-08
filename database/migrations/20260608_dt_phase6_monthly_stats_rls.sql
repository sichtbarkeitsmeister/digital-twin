-- Phase 6: monthly SEO stats visible only to SEO admins (align with other SEO tables)

DROP POLICY IF EXISTS "dt_seo_monthly_stats_select" ON public.dt_seo_monthly_stats;
CREATE POLICY "dt_seo_monthly_stats_select"
ON public.dt_seo_monthly_stats FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));
