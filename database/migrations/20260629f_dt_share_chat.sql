-- Share a personal chat with the whole organisation (one-way: default -> team).

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

  IF NOT (
    public.is_platform_admin(v_uid)
    OR v_row.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.dt_chats
     SET mode = 'team',
         owner_user_id = NULL,
         updated_at = timezone('utc'::text, now())
   WHERE id = p_chat_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.dt_share_chat_to_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dt_share_chat_to_team(uuid) TO authenticated;
