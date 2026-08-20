-- SBKM agency staff (@sichtbarkeitsmeister.de) are platform admins.
-- Signup previously always inserted profiles.role = 'customer', so colleagues
-- never saw Verwaltung / SEO Modus. Also allow existing admins to grant the
-- platform role from the dashboard (RLS only lets users update their own row).

CREATE OR REPLACE FUNCTION public.is_sbkm_staff_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT split_part(lower(trim(coalesce(p_email, ''))), '@', 2) = 'sichtbarkeitsmeister.de';
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE
      WHEN public.is_sbkm_staff_email(NEW.email) THEN 'admin'
      ELSE 'customer'
    END
  );
  RETURN NEW;
END;
$$;

-- Existing SBKM accounts (e.g. vanessa.may@sichtbarkeitsmeister.de) stay
-- customer until this backfill runs.
UPDATE public.profiles
SET role = 'admin'
WHERE public.is_sbkm_staff_email(email)
  AND role IS DISTINCT FROM 'admin';

CREATE OR REPLACE FUNCTION public.set_platform_admin_role(
  target_email text,
  make_admin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  e text;
  target_uid uuid;
  current_role text;
  admin_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  e := lower(trim(coalesce(target_email, '')));
  IF e = '' OR position('@' in e) = 0 THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  SELECT u.id INTO target_uid
  FROM auth.users u
  WHERE lower(u.email) = e
  LIMIT 1;

  IF target_uid IS NULL THEN
    SELECT p.id INTO target_uid
    FROM public.profiles p
    WHERE lower(p.email) = e
    LIMIT 1;
  END IF;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  SELECT p.role INTO current_role
  FROM public.profiles p
  WHERE p.id = target_uid;

  IF make_admin THEN
    INSERT INTO public.profiles (id, email, role)
    VALUES (target_uid, e, 'admin')
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          role = 'admin';
    RETURN;
  END IF;

  IF current_role IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF current_role IS DISTINCT FROM 'admin' THEN
    RETURN;
  END IF;

  SELECT count(*)::int INTO admin_count
  FROM public.profiles p
  WHERE p.role = 'admin';

  IF admin_count <= 1 THEN
    RAISE EXCEPTION 'last_admin';
  END IF;

  UPDATE public.profiles
  SET role = 'customer'
  WHERE id = target_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_sbkm_staff_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_admin_role(text, boolean) TO authenticated;

-- Users must not be able to escalate their own platform role via a direct UPDATE.
CREATE OR REPLACE FUNCTION public.prevent_platform_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  -- SQL editor / service-role jobs have no JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'forbidden';
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_role_self_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_role_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_role_self_escalation();
