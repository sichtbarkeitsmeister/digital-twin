-- Allow org owners/admins (and platform admins) to revoke pending invites
-- so the same email can be invited again.

CREATE OR REPLACE FUNCTION public.revoke_organisation_invite(invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.organisation_invites%ROWTYPE;
  my_role public.org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO inv
  FROM public.organisation_invites oi
  WHERE oi.id = invite_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invite_not_pending';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    my_role := public.my_org_role(inv.organisation_id);
    IF my_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;

    -- Org admins may only revoke employee invites (same rule as inviting).
    IF my_role = 'admin' AND inv.org_role IN ('admin', 'owner') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  UPDATE public.organisation_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE id = invite_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_organisation_invite(uuid) TO authenticated;
