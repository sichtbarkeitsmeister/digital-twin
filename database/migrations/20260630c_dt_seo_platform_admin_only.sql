-- SEO mode: platform admins only.

CREATE OR REPLACE FUNCTION public.dt_user_can_access_seo(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT public.is_platform_admin(auth.uid());
$$;
