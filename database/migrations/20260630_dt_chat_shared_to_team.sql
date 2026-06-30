-- Personal chats shared with the team stay in Meine (mode=default, owner kept).

ALTER TABLE public.dt_chats
  ADD COLUMN IF NOT EXISTS shared_to_team_at timestamptz;

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
          AND (
            c.mode = 'team'
            OR c.shared_to_team_at IS NOT NULL
            OR (c.mode = 'seo' AND public.dt_user_can_access_seo(c.organisation_id))
            OR (c.mode NOT IN ('team', 'seo') AND c.owner_user_id = auth.uid())
          )
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
    AND (
      mode = 'team'
      OR shared_to_team_at IS NOT NULL
      OR (mode = 'seo' AND public.dt_user_can_access_seo(organisation_id))
      OR (mode NOT IN ('team', 'seo') AND owner_user_id = auth.uid())
    )
  )
);

CREATE OR REPLACE FUNCTION public.dt_share_chat_to_team(p_chat_id uuid)
RETURNS public.dt_chats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.dt_chats;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.dt_chats
  WHERE id = p_chat_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat_not_found';
  END IF;

  IF v_row.mode <> 'default' THEN
    RAISE EXCEPTION 'only_personal_chats_can_be_shared';
  END IF;

  IF v_row.shared_to_team_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_already_shared';
  END IF;

  IF NOT (
    public.is_platform_admin(v_uid)
    OR v_row.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.dt_chats
     SET shared_to_team_at = timezone('utc'::text, now()),
         updated_at = timezone('utc'::text, now())
   WHERE id = p_chat_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
