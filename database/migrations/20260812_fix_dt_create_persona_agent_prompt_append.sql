-- Fix: survey→persona create must persist prompt_append + uses_global_prompt.
-- Without this, create-agent only stores the stub "Avatar: {name}" and the
-- Avatar-Prompt field stays empty (seen with TM Dentaltechnik / Gasanov).
--
-- Paste into Supabase SQL Editor and run once.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.dt_create_persona_agent(
  p_organisation_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_slug text;
  v_agent_id uuid;
  v_response_id uuid;
  v_template_id uuid;
  v_uses_global boolean;
  v_prompt_append text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.is_platform_admin(v_uid)
    OR (
      public.is_org_member(p_organisation_id, v_uid)
      AND public.my_org_role(p_organisation_id) IN ('owner', 'admin')
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_slug := lower(trim(COALESCE(p_payload->>'slug', '')));
  IF v_slug = '' OR v_slug !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dt_agents a
    WHERE a.organisation_id = p_organisation_id
      AND a.slug = v_slug
  ) THEN
    RAISE EXCEPTION 'agent_slug_exists';
  END IF;

  v_response_id := NULLIF(trim(p_payload->>'source_survey_response_id'), '')::uuid;
  IF v_response_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.dt_agents a
    WHERE a.source_survey_response_id = v_response_id
  ) THEN
    RAISE EXCEPTION 'agent_already_created_for_response';
  END IF;

  v_uses_global := COALESCE((p_payload->>'uses_global_prompt')::boolean, false);
  v_prompt_append := NULLIF(trim(p_payload->>'prompt_append'), '');

  IF p_payload ? 'template_id' AND NULLIF(trim(p_payload->>'template_id'), '') IS NOT NULL THEN
    v_template_id := NULLIF(trim(p_payload->>'template_id'), '')::uuid;
  ELSIF v_uses_global THEN
    SELECT t.id INTO v_template_id
    FROM public.dt_agent_templates t
    WHERE t.slug = 'default'
    LIMIT 1;
  ELSE
    v_template_id := NULL;
  END IF;

  INSERT INTO public.dt_agents (
    organisation_id,
    template_id,
    kind,
    slug,
    name,
    role,
    prompt_template,
    prompt_append,
    avatar_data,
    quick_actions,
    is_enabled,
    position,
    created_by_user_id,
    source_survey_id,
    source_survey_response_id,
    uses_global_prompt
  )
  VALUES (
    p_organisation_id,
    v_template_id,
    'persona',
    v_slug,
    COALESCE(NULLIF(trim(p_payload->>'name'), ''), 'Persona'),
    NULLIF(trim(p_payload->>'role'), ''),
    COALESCE(NULLIF(trim(p_payload->>'prompt_template'), ''), 'Du bist ein hilfreicher Assistent.'),
    v_prompt_append,
    COALESCE(p_payload->'avatar_data', '{}'::jsonb),
    COALESCE(p_payload->'quick_actions', '[]'::jsonb),
    COALESCE((p_payload->>'is_enabled')::boolean, true),
    COALESCE((p_payload->>'position')::int, 0),
    v_uid,
    NULLIF(trim(p_payload->>'source_survey_id'), '')::uuid,
    v_response_id,
    v_uses_global
  )
  RETURNING id INTO v_agent_id;

  RETURN v_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_create_persona_agent(uuid, jsonb) TO authenticated;
