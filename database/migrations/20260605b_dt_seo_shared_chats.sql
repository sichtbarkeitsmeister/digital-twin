-- SEO chats are org-shared (like team chats)

CREATE OR REPLACE FUNCTION public.dt_user_can_view_chat(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dt_chats c
    WHERE c.id = p_chat_id
      AND (
        public.is_platform_admin(auth.uid())
        OR (
          public.is_org_member(c.organisation_id, auth.uid())
          AND (c.mode IN ('team', 'seo') OR c.owner_user_id = auth.uid())
        )
      )
  );
$$;

DROP POLICY IF EXISTS "dt_chats_select_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_select_visible"
ON public.dt_chats FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND (mode IN ('team', 'seo') OR owner_user_id = auth.uid())
  )
);

CREATE OR REPLACE FUNCTION public.dt_create_chat(
  p_organisation_id uuid,
  p_agent_id uuid,
  p_mode public.dt_chat_mode,
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_chat_id uuid;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.is_platform_admin(v_uid)
    OR public.is_org_member(p_organisation_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_mode = 'ghost' THEN
    RAISE EXCEPTION 'ghost_mode_not_persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.dt_agents a
    WHERE a.id = p_agent_id
      AND a.organisation_id = p_organisation_id
      AND a.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'invalid_agent';
  END IF;

  v_owner := CASE WHEN p_mode IN ('team', 'seo') THEN NULL ELSE v_uid END;

  INSERT INTO public.dt_chats (organisation_id, agent_id, mode, owner_user_id, title)
  VALUES (
    p_organisation_id,
    p_agent_id,
    p_mode,
    v_owner,
    COALESCE(NULLIF(trim(p_title), ''), 'Neuer Chat')
  )
  RETURNING id INTO v_chat_id;

  RETURN v_chat_id;
END;
$$;

DROP POLICY IF EXISTS "dt_chats_update_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_update_visible"
ON public.dt_chats FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode IN ('team', 'seo')
    AND public.is_org_member(organisation_id, auth.uid())
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode IN ('team', 'seo')
    AND public.is_org_member(organisation_id, auth.uid())
  )
);
