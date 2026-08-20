-- Allow existing platform admins to grant or revoke platform-admin
-- (profiles.role = 'admin'). That role is what unlocks Organisation anlegen,
-- Fragebögen, Alle Umfragen and the rest of Verwaltung — org membership is
-- not enough.

CREATE OR REPLACE FUNCTION public.set_platform_admin(
  target_user_id uuid,
  make_admin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = target_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF make_admin THEN
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = target_user_id;
  ELSE
    IF target_user_id = v_uid THEN
      RAISE EXCEPTION 'cannot_demote_self';
    END IF;

    SELECT count(*)::integer
    INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'last_admin';
    END IF;

    UPDATE public.profiles
    SET role = 'customer'
    WHERE id = target_user_id
      AND role = 'admin';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_platform_admin(uuid, boolean) TO authenticated;
