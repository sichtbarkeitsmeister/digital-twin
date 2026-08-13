-- Fix: slug allocation must see all organisations (bypass RLS).
-- Without SECURITY DEFINER + row_security=off, platform admins could fail
-- org create with opaque errors when slug uniqueness checks are RLS-filtered.

CREATE OR REPLACE FUNCTION public.slugify_organisation_name(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  s := lower(coalesce(raw, ''));
  s := regexp_replace(s, 'gebr\.\s*', '', 'gi');
  s := regexp_replace(s, '\ygmbh\y|\yug\y|\yag\y|\ye\.v\.\y|\ygbr\y|\yco\.\y|\ykg\y', '', 'gi');
  s := replace(s, 'ü', 'ue');
  s := replace(s, 'ö', 'oe');
  s := replace(s, 'ä', 'ae');
  s := replace(s, 'ß', 'ss');
  s := regexp_replace(s, '[^a-z0-9\s-]', '', 'g');
  s := trim(s);
  s := regexp_replace(s, '\s+', '-', 'g');
  s := regexp_replace(s, '-+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  IF char_length(s) > 64 THEN
    s := left(s, 64);
    s := regexp_replace(s, '-+$', '', 'g');
  END IF;
  RETURN NULLIF(s, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_unique_organisation_slug(base text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  candidate text;
  n int := 2;
BEGIN
  candidate := NULLIF(trim(base), '');
  IF candidate IS NULL THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.slug = candidate) THEN
    RETURN candidate;
  END IF;

  WHILE n < 1000 LOOP
    candidate := left(base, greatest(1, 64 - 1 - char_length(n::text))) || '-' || n::text;
    IF NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.slug = candidate) THEN
      RETURN candidate;
    END IF;
    n := n + 1;
  END LOOP;

  RAISE EXCEPTION 'slug_collision';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_organisation(
  org_name text,
  owner_email text,
  org_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  org_id uuid;
  e text;
  owner_uid uuid;
  resolved_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  e := lower(trim(owner_email));
  IF e = '' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  resolved_slug := nullif(trim(org_slug), '');
  IF resolved_slug IS NULL THEN
    resolved_slug := public.slugify_organisation_name(org_name);
  ELSIF resolved_slug ~ '^[a-zA-Z0-9-]+$' THEN
    resolved_slug := lower(resolved_slug);
  ELSE
    -- Free-form slug (e.g. company name with spaces/umlauts) → same rules as name.
    resolved_slug := public.slugify_organisation_name(resolved_slug);
  END IF;

  IF resolved_slug IS NULL OR resolved_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  resolved_slug := public.allocate_unique_organisation_slug(resolved_slug);

  INSERT INTO public.organisations (name, slug, created_by_user_id)
  VALUES (trim(org_name), resolved_slug, auth.uid())
  RETURNING id INTO org_id;

  SELECT u.id INTO owner_uid
  FROM auth.users u
  WHERE lower(u.email) = e
  LIMIT 1;

  IF owner_uid IS NOT NULL THEN
    UPDATE public.organisations SET owner_user_id = owner_uid WHERE id = org_id;

    INSERT INTO public.organisation_members (organisation_id, user_id, org_role, created_by_user_id)
    VALUES (org_id, owner_uid, 'owner', auth.uid())
    ON CONFLICT (organisation_id, user_id) DO UPDATE SET org_role = 'owner';
  ELSE
    INSERT INTO public.organisation_invites (organisation_id, email, org_role, invited_by_user_id)
    VALUES (org_id, e, 'owner', auth.uid());
  END IF;

  RETURN org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.slugify_organisation_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_unique_organisation_slug(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_organisation(text, text, text) TO authenticated;
