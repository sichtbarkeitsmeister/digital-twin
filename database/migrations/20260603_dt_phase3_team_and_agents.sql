-- Phase 3: team chat ownership, agent subscribe/update RPCs, public templates

-- Team chats are org-wide (no personal owner)
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

  v_owner := CASE WHEN p_mode = 'team' THEN NULL ELSE v_uid END;

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

CREATE OR REPLACE FUNCTION public.dt_subscribe_agent_template(
  p_organisation_id uuid,
  p_template_id uuid,
  p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tpl public.dt_agent_templates%ROWTYPE;
  v_slug text;
  v_agent_id uuid;
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

  SELECT * INTO v_tpl
  FROM public.dt_agent_templates t
  WHERE t.id = p_template_id
    AND t.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  IF NOT (v_tpl.is_public OR public.is_platform_admin(v_uid)) THEN
    RAISE EXCEPTION 'template_not_available';
  END IF;

  v_slug := COALESCE(NULLIF(trim(p_overrides->>'slug'), ''), v_tpl.slug);

  IF EXISTS (
    SELECT 1
    FROM public.dt_agents a
    WHERE a.organisation_id = p_organisation_id
      AND a.slug = v_slug
  ) THEN
    RAISE EXCEPTION 'agent_slug_exists';
  END IF;

  INSERT INTO public.dt_agents (
    organisation_id,
    template_id,
    kind,
    slug,
    name,
    role,
    prompt_template,
    avatar_data,
    quick_actions,
    is_enabled,
    position,
    created_by_user_id
  )
  VALUES (
    p_organisation_id,
    v_tpl.id,
    v_tpl.kind,
    v_slug,
    COALESCE(NULLIF(trim(p_overrides->>'name'), ''), v_tpl.name),
    NULLIF(trim(p_overrides->>'role'), ''),
    COALESCE(NULLIF(trim(p_overrides->>'prompt_template'), ''), v_tpl.default_prompt),
    COALESCE(p_overrides->'avatar_data', v_tpl.default_avatar_data),
    COALESCE(p_overrides->'quick_actions', '[]'::jsonb),
    COALESCE((p_overrides->>'is_enabled')::boolean, true),
    COALESCE((p_overrides->>'position')::int, 0),
    v_uid
  )
  RETURNING id INTO v_agent_id;

  RETURN v_agent_id;
END;
$$;

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

  UPDATE public.dt_agents a
  SET
    name = COALESCE(NULLIF(trim(p_patch->>'name'), ''), a.name),
    role = CASE WHEN p_patch ? 'role' THEN NULLIF(trim(p_patch->>'role'), '') ELSE a.role END,
    prompt_template = COALESCE(NULLIF(trim(p_patch->>'prompt_template'), ''), a.prompt_template),
    quick_actions = COALESCE(p_patch->'quick_actions', a.quick_actions),
    is_enabled = COALESCE((p_patch->>'is_enabled')::boolean, a.is_enabled),
    position = COALESCE((p_patch->>'position')::int, a.position),
    avatar_data = COALESCE(p_patch->'avatar_data', a.avatar_data)
  WHERE a.id = p_agent_id;

  RETURN p_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_subscribe_agent_template(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dt_update_agent(uuid, jsonb) TO authenticated;

INSERT INTO public.dt_agent_templates (slug, kind, name, short_description, default_prompt, is_public)
VALUES
  (
    'seo_advisor',
    'seo_advisor',
    'SEO-Berater',
    'Strukturierte SEO-Analyse und Aufgaben für deine Website.',
    'Du bist der SEO-Berater des Kunden. Antworte auf Deutsch, strukturiert und handlungsorientiert. Stelle Rückfragen, wenn Daten fehlen.',
    true
  ),
  (
    'geo_advisor',
    'geo_advisor',
    'GEO-Berater',
    'Sichtbarkeit in KI-Suchmaschinen und generativen Antworten.',
    'Du bist der GEO-Berater. Hilf dem Team, in generativen Suchergebnissen sichtbar zu werden. Antworte auf Deutsch.',
    true
  ),
  (
    'wunschkunde',
    'wunschkunde',
    'Wunschkunde',
    'Simuliert typische Kundenfragen zu Angebot und Leistungen.',
    'Du spielst einen potenziellen Kunden. Stelle realistische Fragen zum Angebot der Organisation. Antworte kurz und auf Deutsch.',
    true
  )
ON CONFLICT (slug) DO NOTHING;
