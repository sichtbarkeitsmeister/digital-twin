-- DigitalTwin SaaS Database Schema
-- Phase 1: Minimal schema for authentication and user management

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy: Users can insert their own profile (for signup)
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Helper: avoid RLS recursion by checking admin status in SECURITY DEFINER context
-- with row_security disabled. Safe because it returns only a boolean.
CREATE OR REPLACE FUNCTION public.is_platform_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = uid AND p.role = 'admin'
  );
$$;

-- Allow users to view other profiles if they share an organisation.
-- SECURITY DEFINER + row_security off prevents RLS recursion and keeps it fast.
CREATE OR REPLACE FUNCTION public.can_view_profile(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT
    public.is_platform_admin(auth.uid())
    OR auth.uid() = target_user_id
    OR EXISTS (
      SELECT 1
      FROM public.organisation_members me
      JOIN public.organisation_members them
        ON them.organisation_id = me.organisation_id
      WHERE me.user_id = auth.uid()
        AND them.user_id = target_user_id
    );
$$;

-- Policy: Admins can view all profiles (for future admin dashboard)
-- IMPORTANT: do NOT self-query public.profiles inside a profiles policy (can recurse).
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

-- Policy: Org members can view each other's profiles
DROP POLICY IF EXISTS "Org members can view profiles in same org" ON public.profiles;
CREATE POLICY "Org members can view profiles in same org"
ON public.profiles
FOR SELECT
USING (public.can_view_profile(profiles.id));

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on profile updates
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    'customer' -- Default role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);

-- ============================================================
-- Phase 2: Organisations + Memberships + Invites (RBAC)
-- ============================================================

-- =============================
-- 1) Enums
-- =============================
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================
-- 2) Tables
-- =============================
CREATE TABLE IF NOT EXISTS public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,

  -- Nullable supports “owner invited but not signed up yet”
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.organisation_members (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_role public.org_role NOT NULL DEFAULT 'employee',

  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  PRIMARY KEY (organisation_id, user_id)
);

-- Enable PostgREST embedding of member emails (admins only via profiles RLS)
DO $$ BEGIN
  ALTER TABLE public.organisation_members
    ADD CONSTRAINT organisation_members_user_profile_fk
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.organisation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  email text NOT NULL,
  org_role public.org_role NOT NULL DEFAULT 'employee',
  invited_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  status public.invite_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  accepted_at timestamptz,
  revoked_at timestamptz,

  CONSTRAINT organisation_invites_email_lower CHECK (email = lower(email))
);

-- =============================
-- 3) updated_at trigger reuse
-- =============================
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_organisations
    BEFORE UPDATE ON public.organisations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================
-- 4) Indexes (performance)
-- =============================
CREATE INDEX IF NOT EXISTS organisations_owner_user_id_idx ON public.organisations(owner_user_id);
CREATE INDEX IF NOT EXISTS organisations_created_by_user_id_idx ON public.organisations(created_by_user_id);
CREATE INDEX IF NOT EXISTS organisations_archived_at_idx ON public.organisations(archived_at);

CREATE INDEX IF NOT EXISTS organisation_members_user_id_idx ON public.organisation_members(user_id);
CREATE INDEX IF NOT EXISTS organisation_members_org_role_idx ON public.organisation_members(organisation_id, org_role);

CREATE INDEX IF NOT EXISTS organisation_invites_org_id_idx ON public.organisation_invites(organisation_id);
CREATE INDEX IF NOT EXISTS organisation_invites_email_idx ON public.organisation_invites(email);

-- Only one pending invite per org+email
CREATE UNIQUE INDEX IF NOT EXISTS organisation_invites_pending_unique
  ON public.organisation_invites(organisation_id, email)
  WHERE status = 'pending';

-- =============================
-- 5) Helper functions
-- =============================
-- NOTE: public.is_platform_admin(...) is defined above (profiles section) as SECURITY DEFINER

-- Avoid RLS recursion by checking membership inside a SECURITY DEFINER function
-- with row_security disabled. This is safe because it returns only a boolean.
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_members om
    WHERE om.organisation_id = org_id
      AND om.user_id = uid
  );
$$;

-- Pending-invite check (used for inbox + org metadata visibility pre-join)
CREATE OR REPLACE FUNCTION public.has_pending_org_invite(org_id uuid, invited_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_invites oi
    WHERE oi.organisation_id = org_id
      AND oi.status = 'pending'
      AND oi.email = lower(invited_email)
  );
$$;

CREATE OR REPLACE FUNCTION public.my_org_role(org_id uuid)
RETURNS public.org_role
LANGUAGE sql
STABLE
AS $$
  SELECT om.org_role
  FROM public.organisation_members om
  WHERE om.organisation_id = org_id
    AND om.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_kick(org_id uuid, target_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  my_role public.org_role;
  target_role public.org_role;
BEGIN
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN TRUE;
  END IF;

  SELECT org_role INTO my_role
  FROM public.organisation_members
  WHERE organisation_id = org_id AND user_id = auth.uid();

  SELECT org_role INTO target_role
  FROM public.organisation_members
  WHERE organisation_id = org_id AND user_id = target_user_id;

  IF my_role IS NULL OR target_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF my_role = 'owner' THEN
    RETURN target_user_id <> auth.uid();
  END IF;

  IF my_role = 'admin' THEN
    -- admins can kick employees only
    RETURN target_role = 'employee';
  END IF;

  RETURN FALSE;
END;
$$;

-- =============================
-- 6) RPCs (SECURITY DEFINER)
-- =============================

-- Transfer ownership (owner or platform admin)
CREATE OR REPLACE FUNCTION public.transfer_organisation_ownership(
  org_id uuid,
  new_owner_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
  my_role public.org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  is_admin := public.is_platform_admin(auth.uid());
  my_role := public.my_org_role(org_id);

  IF NOT (is_admin OR my_role = 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- ensure new owner is a member
  INSERT INTO public.organisation_members (organisation_id, user_id, org_role, created_by_user_id)
  VALUES (org_id, new_owner_user_id, 'admin', auth.uid())
  ON CONFLICT (organisation_id, user_id) DO NOTHING;

  -- promote new owner
  UPDATE public.organisation_members
  SET org_role = 'owner'
  WHERE organisation_id = org_id AND user_id = new_owner_user_id;

  -- demote previous owner to admin (if any)
  UPDATE public.organisation_members
  SET org_role = 'admin'
  WHERE organisation_id = org_id
    AND org_role = 'owner'
    AND user_id <> new_owner_user_id;

  UPDATE public.organisations
  SET owner_user_id = new_owner_user_id
  WHERE id = org_id;
END;
$$;

-- Invite by email (owner/admin/platform admin)
CREATE OR REPLACE FUNCTION public.invite_to_organisation(
  org_id uuid,
  invited_email text,
  role public.org_role
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e text;
  invite_id uuid;
  my_role public.org_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Ownership must be transferred explicitly via transfer_organisation_ownership().
  -- Only admin_create_organisation() is allowed to create an initial owner invite.
  IF role = 'owner' THEN
    RAISE EXCEPTION 'cannot_invite_owner_role';
  END IF;

  e := lower(trim(invited_email));
  IF e = '' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  -- permission check
  IF NOT public.is_platform_admin(auth.uid()) THEN
    my_role := public.my_org_role(org_id);
    IF my_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;

    -- org admins cannot invite other admins/owners
    IF my_role = 'admin' AND role IN ('admin', 'owner') THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  INSERT INTO public.organisation_invites (organisation_id, email, org_role, invited_by_user_id)
  VALUES (org_id, e, role, auth.uid())
  RETURNING id INTO invite_id;

  RETURN invite_id;
END;
$$;

-- Accept an invite for the currently logged-in user (by email claim).
CREATE OR REPLACE FUNCTION public.accept_organisation_invite(invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.organisation_invites%ROWTYPE;
  jwt_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  jwt_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF jwt_email = '' THEN
    RAISE EXCEPTION 'missing_email_claim';
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

  IF inv.email <> jwt_email THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.organisation_members (organisation_id, user_id, org_role, created_by_user_id)
  VALUES (inv.organisation_id, auth.uid(), inv.org_role, inv.invited_by_user_id)
  ON CONFLICT (organisation_id, user_id) DO UPDATE SET org_role = EXCLUDED.org_role;

  UPDATE public.organisation_invites
  SET status = 'accepted', accepted_at = timezone('utc'::text, now())
  WHERE id = invite_id;
END;
$$;

-- Kick member (owner/admin/platform admin)
CREATE OR REPLACE FUNCTION public.kick_from_organisation(
  org_id uuid,
  target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.can_kick(org_id, target_user_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organisation_members
    WHERE organisation_id = org_id AND user_id = target_user_id AND org_role = 'owner'
  ) THEN
    RAISE EXCEPTION 'cannot_kick_owner';
  END IF;

  DELETE FROM public.organisation_members
  WHERE organisation_id = org_id AND user_id = target_user_id;
END;
$$;

-- Platform admin: create org with initial owner email.
-- If owner exists -> create membership immediately as owner; else -> pending owner invite.
CREATE OR REPLACE FUNCTION public.admin_create_organisation(
  org_name text,
  owner_email text,
  org_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  e text;
  owner_uid uuid;
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

  INSERT INTO public.organisations (name, slug, created_by_user_id)
  VALUES (trim(org_name), org_slug, auth.uid())
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

-- =============================
-- 7) Auto-claim invites on signup
-- =============================
CREATE OR REPLACE FUNCTION public.handle_claim_org_invites_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e text;
BEGIN
  e := lower(NEW.email);

  -- create memberships for pending invites
  INSERT INTO public.organisation_members (organisation_id, user_id, org_role, created_by_user_id)
  SELECT oi.organisation_id, NEW.id, oi.org_role, oi.invited_by_user_id
  FROM public.organisation_invites oi
  WHERE oi.email = e AND oi.status = 'pending'
  ON CONFLICT (organisation_id, user_id) DO NOTHING;

  -- mark invites accepted
  UPDATE public.organisation_invites
  SET status = 'accepted', accepted_at = timezone('utc'::text, now())
  WHERE email = e AND status = 'pending';

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER on_auth_user_created_claim_org_invites
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_claim_org_invites_on_signup();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================
-- 8) RLS
-- =============================
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_invites ENABLE ROW LEVEL SECURITY;

-- Organisations
DROP POLICY IF EXISTS "orgs_select_if_member_or_platform_admin" ON public.organisations;
CREATE POLICY "orgs_select_if_member_or_platform_admin"
ON public.organisations
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisations.id, auth.uid())
  OR public.has_pending_org_invite(
    organisations.id,
    coalesce(auth.jwt() ->> 'email', '')
  )
);

DROP POLICY IF EXISTS "orgs_insert_platform_admin_only" ON public.organisations;
CREATE POLICY "orgs_insert_platform_admin_only"
ON public.organisations
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "orgs_update_owner_or_platform_admin" ON public.organisations;
CREATE POLICY "orgs_update_owner_or_platform_admin"
ON public.organisations
FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisations.id) = 'owner'
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisations.id) = 'owner'
);

-- Members: visible to members; writes via RPCs
DROP POLICY IF EXISTS "org_members_select_if_member_or_platform_admin" ON public.organisation_members;
CREATE POLICY "org_members_select_if_member_or_platform_admin"
ON public.organisation_members
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_members.organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "org_members_no_direct_insert" ON public.organisation_members;
CREATE POLICY "org_members_no_direct_insert"
ON public.organisation_members
FOR INSERT
WITH CHECK (false);

DROP POLICY IF EXISTS "org_members_no_direct_update" ON public.organisation_members;
CREATE POLICY "org_members_no_direct_update"
ON public.organisation_members
FOR UPDATE
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "org_members_no_direct_delete" ON public.organisation_members;
CREATE POLICY "org_members_no_direct_delete"
ON public.organisation_members
FOR DELETE
USING (false);

-- Invites: visible to members; writes via RPCs
DROP POLICY IF EXISTS "org_invites_select_if_member_or_platform_admin" ON public.organisation_invites;
CREATE POLICY "org_invites_select_if_member_or_platform_admin"
ON public.organisation_invites
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_invites.organisation_id, auth.uid())
);

-- Inbox: invitees can see their own pending invites
DROP POLICY IF EXISTS "org_invites_select_own_pending" ON public.organisation_invites;
CREATE POLICY "org_invites_select_own_pending"
ON public.organisation_invites
FOR SELECT
USING (
  organisation_invites.status = 'pending'
  AND organisation_invites.email = lower(coalesce(auth.jwt() ->> 'email', ''))
);

DROP POLICY IF EXISTS "org_invites_no_direct_insert" ON public.organisation_invites;
CREATE POLICY "org_invites_no_direct_insert"
ON public.organisation_invites
FOR INSERT
WITH CHECK (false);

DROP POLICY IF EXISTS "org_invites_no_direct_update" ON public.organisation_invites;
CREATE POLICY "org_invites_no_direct_update"
ON public.organisation_invites
FOR UPDATE
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "org_invites_no_direct_delete" ON public.organisation_invites;
CREATE POLICY "org_invites_no_direct_delete"
ON public.organisation_invites
FOR DELETE
USING (false);

-- ============================================================
-- Phase 3: Surveys (drafts, publishing, responses, Q&A)
-- ============================================================

-- =============================
-- 1) Enums
-- =============================
DO $$ BEGIN
  CREATE TYPE public.survey_visibility AS ENUM ('private', 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.survey_response_status AS ENUM ('in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================
-- 2) Tables
-- =============================
CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  slug text UNIQUE,
  visibility public.survey_visibility NOT NULL DEFAULT 'private',
  definition jsonb NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  published_at timestamptz,
  CONSTRAINT surveys_slug_lower CHECK (slug IS NULL OR slug = lower(slug)),
  CONSTRAINT surveys_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9-]+$')
);

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  status public.survey_response_status NOT NULL DEFAULT 'in_progress',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.survey_field_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  field_id text NOT NULL,
  question text NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  answer text,
  answered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at timestamptz,
  CONSTRAINT survey_field_questions_question_nonempty CHECK (length(trim(question)) > 0)
);

-- =============================
-- 3) updated_at trigger reuse
-- =============================
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_surveys
    BEFORE UPDATE ON public.surveys
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_survey_responses
    BEFORE UPDATE ON public.survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================
-- 4) Indexes (performance)
-- =============================
CREATE INDEX IF NOT EXISTS surveys_visibility_idx ON public.surveys(visibility);
CREATE INDEX IF NOT EXISTS surveys_created_by_user_id_idx ON public.surveys(created_by_user_id);

CREATE INDEX IF NOT EXISTS survey_responses_survey_id_idx ON public.survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS survey_responses_status_idx ON public.survey_responses(survey_id, status);

CREATE INDEX IF NOT EXISTS survey_field_questions_response_id_idx ON public.survey_field_questions(response_id);
CREATE INDEX IF NOT EXISTS survey_field_questions_survey_id_idx ON public.survey_field_questions(survey_id);
CREATE INDEX IF NOT EXISTS survey_field_questions_field_id_idx ON public.survey_field_questions(field_id);

-- =============================
-- 5) RLS
-- =============================
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_field_questions ENABLE ROW LEVEL SECURITY;

-- Surveys: platform admins only (public access via RPCs)
DROP POLICY IF EXISTS "surveys_select_platform_admin_only" ON public.surveys;
CREATE POLICY "surveys_select_platform_admin_only"
ON public.surveys
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "surveys_insert_platform_admin_only" ON public.surveys;
CREATE POLICY "surveys_insert_platform_admin_only"
ON public.surveys
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "surveys_update_platform_admin_only" ON public.surveys;
CREATE POLICY "surveys_update_platform_admin_only"
ON public.surveys
FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "surveys_delete_platform_admin_only" ON public.surveys;
CREATE POLICY "surveys_delete_platform_admin_only"
ON public.surveys
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- Responses: admins can read/manage; public access via RPCs (token-gated)
DROP POLICY IF EXISTS "survey_responses_select_platform_admin_only" ON public.survey_responses;
CREATE POLICY "survey_responses_select_platform_admin_only"
ON public.survey_responses
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_responses_update_platform_admin_only" ON public.survey_responses;
CREATE POLICY "survey_responses_update_platform_admin_only"
ON public.survey_responses
FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_responses_delete_platform_admin_only" ON public.survey_responses;
CREATE POLICY "survey_responses_delete_platform_admin_only"
ON public.survey_responses
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_responses_no_direct_insert" ON public.survey_responses;
CREATE POLICY "survey_responses_no_direct_insert"
ON public.survey_responses
FOR INSERT
WITH CHECK (false);

-- Field questions: admins can view/answer; public create/list via RPCs
DROP POLICY IF EXISTS "survey_field_questions_select_platform_admin_only" ON public.survey_field_questions;
CREATE POLICY "survey_field_questions_select_platform_admin_only"
ON public.survey_field_questions
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_field_questions_update_platform_admin_only" ON public.survey_field_questions;
CREATE POLICY "survey_field_questions_update_platform_admin_only"
ON public.survey_field_questions
FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_field_questions_delete_platform_admin_only" ON public.survey_field_questions;
CREATE POLICY "survey_field_questions_delete_platform_admin_only"
ON public.survey_field_questions
FOR DELETE
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_field_questions_no_direct_insert" ON public.survey_field_questions;
CREATE POLICY "survey_field_questions_no_direct_insert"
ON public.survey_field_questions
FOR INSERT
WITH CHECK (false);

-- =============================
-- 6) Public (anonymous) RPCs (SECURITY DEFINER)
-- =============================

-- Return a published survey by slug (public link)
CREATE OR REPLACE FUNCTION public.get_public_survey_by_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  slug text,
  definition jsonb,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT s.id, s.title, s.description, s.slug, s.definition, s.published_at
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

-- Single-response mode: each published survey has exactly one response.
-- The link (/s/[slug]) is the access mechanism.
CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_survey_id_unique
  ON public.survey_responses(survey_id);

-- Create (or return) the single response for a published survey.
CREATE OR REPLACE FUNCTION public.create_public_survey_response(p_slug text)
RETURNS TABLE (
  response_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
  v_token text;
BEGIN
  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;

  IF v_survey_id IS NULL THEN
    RAISE EXCEPTION 'survey_not_found';
  END IF;

  SELECT r.id INTO v_response_id
  FROM public.survey_responses r
  WHERE r.survey_id = v_survey_id
  LIMIT 1;

  IF v_response_id IS NULL THEN
    -- token_hash is kept for compatibility; not used for auth in single-response mode
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.survey_responses (survey_id, token_hash)
    VALUES (v_survey_id, extensions.digest(convert_to(v_token, 'utf8'), 'sha256'::text))
    RETURNING id INTO v_response_id;
  END IF;

  response_id := v_response_id;
  RETURN NEXT;
END;
$$;

-- Save answers for the single response (slug-gated). Optionally mark as completed.
CREATE OR REPLACE FUNCTION public.save_public_survey_response(
  p_slug text,
  p_answers jsonb,
  p_mark_completed boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
BEGIN
  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;

  IF v_survey_id IS NULL THEN
    RAISE EXCEPTION 'survey_not_found';
  END IF;

  SELECT r.id INTO v_response_id
  FROM public.survey_responses r
  WHERE r.survey_id = v_survey_id
  LIMIT 1;

  IF v_response_id IS NULL THEN
    RAISE EXCEPTION 'response_not_found';
  END IF;

  UPDATE public.survey_responses
  SET answers = coalesce(p_answers, '{}'::jsonb),
      status = CASE
        WHEN p_mark_completed THEN 'completed'::public.survey_response_status
        ELSE status
      END,
      completed_at = CASE
        WHEN p_mark_completed THEN coalesce(completed_at, timezone('utc'::text, now()))
        ELSE completed_at
      END
  WHERE id = v_response_id;
END;
$$;

-- List Q&A entries for a specific field (slug-gated)
CREATE OR REPLACE FUNCTION public.list_public_field_questions(
  p_slug text,
  p_field_id text
)
RETURNS TABLE (
  id uuid,
  field_id text,
  question text,
  asked_at timestamptz,
  answer text,
  answered_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT q.id, q.field_id, q.question, q.asked_at, q.answer, q.answered_at
  FROM public.survey_field_questions q
  JOIN public.surveys s ON s.id = q.survey_id
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
    AND q.field_id = p_field_id
  ORDER BY q.asked_at ASC;
$$;

-- Ask a question on a specific field (slug-gated)
CREATE OR REPLACE FUNCTION public.ask_public_field_question(
  p_slug text,
  p_field_id text,
  p_question text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
  v_question_id uuid;
BEGIN
  IF length(trim(coalesce(p_question, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;

  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;

  IF v_survey_id IS NULL THEN
    RAISE EXCEPTION 'survey_not_found';
  END IF;

  SELECT r.id INTO v_response_id
  FROM public.survey_responses r
  WHERE r.survey_id = v_survey_id
  LIMIT 1;

  IF v_response_id IS NULL THEN
    RAISE EXCEPTION 'response_not_found';
  END IF;

  INSERT INTO public.survey_field_questions (survey_id, response_id, field_id, question)
  VALUES (v_survey_id, v_response_id, p_field_id, trim(p_question))
  RETURNING id INTO v_question_id;

  RETURN v_question_id;
END;
$$;

-- Read the single response for a published survey (slug-gated)
CREATE OR REPLACE FUNCTION public.get_public_survey_response(p_slug text)
RETURNS TABLE (
  answers jsonb,
  status public.survey_response_status,
  updated_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT r.answers, r.status, r.updated_at, r.completed_at
  FROM public.surveys s
  JOIN public.survey_responses r ON r.survey_id = s.id
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;
$$;
