-- Allow dt_update_agent to record survey lineage when refining an existing agent.

CREATE OR REPLACE FUNCTION public.dt_update_agent(
  p_agent_id uuid,
  p_patch jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_slug text;
  v_is_default boolean;
  v_uses_global boolean;
  v_new_uses_global boolean;
  v_response_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT a.organisation_id, a.slug, a.is_default, a.uses_global_prompt
  INTO v_org, v_slug, v_is_default, v_uses_global
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

  IF p_patch ? 'source_survey_response_id' THEN
    v_response_id := NULLIF(trim(p_patch->>'source_survey_response_id'), '')::uuid;
    IF v_response_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.dt_agents a
      WHERE a.source_survey_response_id = v_response_id
        AND a.id <> p_agent_id
    ) THEN
      RAISE EXCEPTION 'agent_already_created_for_response';
    END IF;
  END IF;

  v_new_uses_global := COALESCE((p_patch->>'uses_global_prompt')::boolean, v_uses_global);

  UPDATE public.dt_agents a
  SET
    name = COALESCE(NULLIF(trim(p_patch->>'name'), ''), a.name),
    role = CASE WHEN p_patch ? 'role' THEN NULLIF(trim(p_patch->>'role'), '') ELSE a.role END,
    uses_global_prompt = v_new_uses_global,
    prompt_template = CASE
      WHEN v_new_uses_global AND NOT (p_patch ? 'source_survey_response_id') THEN a.prompt_template
      ELSE COALESCE(NULLIF(trim(p_patch->>'prompt_template'), ''), a.prompt_template)
    END,
    prompt_append = CASE
      WHEN p_patch ? 'prompt_append' THEN NULLIF(trim(p_patch->>'prompt_append'), '')
      ELSE a.prompt_append
    END,
    quick_actions = COALESCE(p_patch->'quick_actions', a.quick_actions),
    is_enabled = CASE
      WHEN v_is_default AND v_slug = 'seo_advisor' THEN true
      ELSE COALESCE((p_patch->>'is_enabled')::boolean, a.is_enabled)
    END,
    position = COALESCE((p_patch->>'position')::int, a.position),
    avatar_data = COALESCE(p_patch->'avatar_data', a.avatar_data),
    source_survey_id = CASE
      WHEN p_patch ? 'source_survey_id' THEN NULLIF(trim(p_patch->>'source_survey_id'), '')::uuid
      ELSE a.source_survey_id
    END,
    source_survey_response_id = CASE
      WHEN p_patch ? 'source_survey_response_id' THEN NULLIF(trim(p_patch->>'source_survey_response_id'), '')::uuid
      ELSE a.source_survey_response_id
    END
  WHERE a.id = p_agent_id;

  RETURN p_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_update_agent(uuid, jsonb) TO authenticated;
