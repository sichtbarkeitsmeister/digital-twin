-- Change or remove an organisation owner.
-- The previous owner can be removed from the team (not only demoted),
-- and pending owner invites are revoked so the old address cannot claim
-- the role again on signup.

DROP FUNCTION IF EXISTS public.transfer_organisation_ownership(uuid, uuid);
DROP FUNCTION IF EXISTS public.transfer_organisation_ownership(uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.transfer_organisation_ownership(
  org_id uuid,
  new_owner_user_id uuid,
  remove_previous_owner boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  is_admin boolean;
  my_role public.org_role;
  do_remove boolean := coalesce(remove_previous_owner, false);
  previous_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF new_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organisations o
    WHERE o.id = org_id
      AND o.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  is_admin := public.is_platform_admin(auth.uid());
  my_role := public.my_org_role(org_id);

  IF NOT (is_admin OR my_role = 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  previous_ids := ARRAY(
    SELECT om.user_id
    FROM public.organisation_members om
    WHERE om.organisation_id = org_id
      AND om.org_role = 'owner'
      AND om.user_id IS DISTINCT FROM new_owner_user_id
  );

  INSERT INTO public.organisation_members (organisation_id, user_id, org_role, created_by_user_id)
  VALUES (org_id, new_owner_user_id, 'owner', auth.uid())
  ON CONFLICT (organisation_id, user_id) DO UPDATE
    SET org_role = 'owner';

  IF do_remove THEN
    DELETE FROM public.organisation_members
    WHERE organisation_id = org_id
      AND user_id = ANY(previous_ids);
  ELSE
    UPDATE public.organisation_members
    SET org_role = 'admin'
    WHERE organisation_id = org_id
      AND user_id = ANY(previous_ids);
  END IF;

  UPDATE public.organisation_invites oi
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE oi.organisation_id = org_id
    AND oi.status = 'pending'
    AND (
      oi.org_role = 'owner'
      OR (
        do_remove
        AND lower(oi.email) IN (
          SELECT lower(p.email)
          FROM public.profiles p
          WHERE p.id = ANY(previous_ids)
            AND p.email IS NOT NULL
        )
      )
    );

  UPDATE public.organisations
  SET owner_user_id = new_owner_user_id
  WHERE id = org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_organisation_owner(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  previous_ids uuid[];
  recorded_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT o.owner_user_id
  INTO recorded_owner
  FROM public.organisations o
  WHERE o.id = org_id
    AND o.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  previous_ids := ARRAY(
    SELECT om.user_id
    FROM public.organisation_members om
    WHERE om.organisation_id = org_id
      AND (
        om.org_role = 'owner'
        OR om.user_id IS NOT DISTINCT FROM recorded_owner
      )
  );

  DELETE FROM public.organisation_members
  WHERE organisation_id = org_id
    AND user_id = ANY(previous_ids);

  UPDATE public.organisation_invites oi
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE oi.organisation_id = org_id
    AND oi.status = 'pending'
    AND (
      oi.org_role = 'owner'
      OR lower(oi.email) IN (
        SELECT lower(p.email)
        FROM public.profiles p
        WHERE p.id = ANY(previous_ids)
          AND p.email IS NOT NULL
      )
    );

  UPDATE public.organisations
  SET owner_user_id = NULL
  WHERE id = org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_organisation_ownership(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_organisation_ownership(uuid, uuid, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.clear_organisation_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_organisation_owner(uuid) TO authenticated, service_role;
