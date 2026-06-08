-- Phase 5: delete org agent when another enabled agent remains and no chats reference it

CREATE OR REPLACE FUNCTION public.dt_delete_agent(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_enabled_others int;
  v_chat_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT a.organisation_id INTO v_org
  FROM public.dt_agents a
  WHERE a.id = p_agent_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agent_not_found';
  END IF;

  IF NOT (
    public.is_platform_admin(v_uid)
    OR (
      public.is_org_member(v_org, v_uid)
      AND public.my_org_role(v_org) IN ('owner', 'admin')
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::int INTO v_enabled_others
  FROM public.dt_agents a
  WHERE a.organisation_id = v_org
    AND a.is_enabled = true
    AND a.id <> p_agent_id;

  IF v_enabled_others < 1 THEN
    RAISE EXCEPTION 'last_enabled_agent';
  END IF;

  SELECT count(*)::int INTO v_chat_count
  FROM public.dt_chats c
  WHERE c.agent_id = p_agent_id;

  IF v_chat_count > 0 THEN
    RAISE EXCEPTION 'agent_has_chats';
  END IF;

  DELETE FROM public.dt_agents WHERE id = p_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_delete_agent(uuid) TO authenticated;
