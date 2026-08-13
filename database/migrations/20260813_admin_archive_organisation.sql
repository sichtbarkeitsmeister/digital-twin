-- Soft-delete (archive) an organisation. Platform admins only.
-- Archived orgs are hidden from overviews; data is retained.

CREATE OR REPLACE FUNCTION public.admin_archive_organisation(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'invalid_org';
  END IF;

  UPDATE public.organisations
  SET
    archived_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = org_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = org_id) THEN
      RAISE EXCEPTION 'org_not_found';
    END IF;
    -- Already archived → treat as success (idempotent).
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_archive_organisation(uuid) TO authenticated;
