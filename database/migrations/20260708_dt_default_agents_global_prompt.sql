-- Default agents + global (shared) prompts
-- Every org keeps two protected default agents:
--   * DigitalTwin (kind persona, slug 'default')      -> may be disabled, never deleted
--   * SEO-Berater (kind seo_advisor, slug 'seo_advisor') -> always enabled, never deleted
-- Their prompt body is read live from dt_agent_templates.default_prompt with a
-- {{organisation}} placeholder, so platform admins can edit it once globally.

ALTER TABLE public.dt_agents
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uses_global_prompt boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Global default prompts (single source of truth, {{organisation}} placeholder)
-- ---------------------------------------------------------------------------
INSERT INTO public.dt_agent_templates (slug, kind, name, short_description, default_prompt, is_public)
VALUES (
  'default',
  'persona',
  'DigitalTwin',
  'Allgemeiner DigitalTwin-Assistent für Team und Kunden.',
  'Du bist der DigitalTwin von {{organisation}}, ein freundlicher, kompetenter Assistent für Team und Kunden. Beantworte Fragen zu Angebot, Leistungen und Abläufen präzise und auf Deutsch. Fehlen dir Infos, stelle gezielte Rückfragen statt zu raten. Halte Antworten klar strukturiert und handlungsorientiert.',
  false
)
ON CONFLICT (slug) DO UPDATE
  SET kind = EXCLUDED.kind,
      name = EXCLUDED.name,
      short_description = EXCLUDED.short_description,
      default_prompt = EXCLUDED.default_prompt,
      is_public = EXCLUDED.is_public;

UPDATE public.dt_agent_templates
SET default_prompt = 'Du bist der SEO-Berater von {{organisation}}. Du hilfst dem Team, die Sichtbarkeit der Website in Suchmaschinen und KI-Antworten zu verbessern. Analysiere strukturiert, priorisiere nach Wirkung und Aufwand und leite konkrete, umsetzbare Aufgaben ab. Stütze dich auf die bereitgestellten SEO-Daten und stelle Rückfragen, wenn Daten fehlen. Antworte auf Deutsch, klar und handlungsorientiert.',
    is_public = false
WHERE slug = 'seo_advisor';

-- ---------------------------------------------------------------------------
-- Seed both default agents for new organisations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_seed_org_digitaltwin_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_name text;
  v_dt_tpl uuid;
  v_seo_tpl uuid;
BEGIN
  SELECT o.name INTO v_name FROM public.organisations o WHERE o.id = p_org_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dt_org_config (organisation_id, display_name, twin_provisioned, seo_enabled)
  VALUES (p_org_id, v_name, true, false)
  ON CONFLICT (organisation_id) DO NOTHING;

  SELECT id INTO v_dt_tpl FROM public.dt_agent_templates WHERE slug = 'default';
  SELECT id INTO v_seo_tpl FROM public.dt_agent_templates WHERE slug = 'seo_advisor';

  -- DigitalTwin default agent (may be disabled, never deleted)
  IF NOT EXISTS (
    SELECT 1 FROM public.dt_agents a
    WHERE a.organisation_id = p_org_id AND a.slug = 'default'
  ) THEN
    INSERT INTO public.dt_agents (
      organisation_id, template_id, kind, slug, name, role, prompt_template,
      is_enabled, position, is_default, uses_global_prompt
    )
    VALUES (
      p_org_id, v_dt_tpl, 'persona', 'default',
      'DigitalTwin von ' || v_name, 'Standard-Avatar',
      'Du bist der DigitalTwin von ' || v_name || '.',
      true, 0, true, true
    );
  END IF;

  -- SEO-Berater default agent (always enabled, never deleted)
  IF NOT EXISTS (
    SELECT 1 FROM public.dt_agents a
    WHERE a.organisation_id = p_org_id AND a.slug = 'seo_advisor'
  ) THEN
    INSERT INTO public.dt_agents (
      organisation_id, template_id, kind, slug, name, role, prompt_template,
      is_enabled, position, is_default, uses_global_prompt
    )
    VALUES (
      p_org_id, v_seo_tpl, 'seo_advisor', 'seo_advisor',
      'SEO-Berater', 'SEO-Analyse & Aufgaben',
      'Du bist der SEO-Berater von ' || v_name || '.',
      true, 1, true, true
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill existing organisations
-- ---------------------------------------------------------------------------
-- Existing generic DigitalTwin personas become protected + global-prompt driven.
UPDATE public.dt_agents a
SET is_default = true,
    uses_global_prompt = true,
    template_id = COALESCE(a.template_id, (SELECT id FROM public.dt_agent_templates WHERE slug = 'default'))
WHERE a.slug = 'default' AND a.kind = 'persona';

-- Existing subscribed SEO advisors become protected, always-on, global-prompt driven.
UPDATE public.dt_agents a
SET is_default = true,
    uses_global_prompt = true,
    is_enabled = true,
    template_id = COALESCE(a.template_id, (SELECT id FROM public.dt_agent_templates WHERE slug = 'seo_advisor'))
WHERE a.slug = 'seo_advisor' OR a.kind = 'seo_advisor';

-- Create a SEO advisor for every provisioned org that still lacks one.
INSERT INTO public.dt_agents (
  organisation_id, template_id, kind, slug, name, role, prompt_template,
  is_enabled, position, is_default, uses_global_prompt
)
SELECT
  cfg.organisation_id,
  (SELECT id FROM public.dt_agent_templates WHERE slug = 'seo_advisor'),
  'seo_advisor', 'seo_advisor', 'SEO-Berater', 'SEO-Analyse & Aufgaben',
  'Du bist der SEO-Berater.',
  true, 1, true, true
FROM public.dt_org_config cfg
WHERE NOT EXISTS (
  SELECT 1 FROM public.dt_agents a
  WHERE a.organisation_id = cfg.organisation_id
    AND (a.slug = 'seo_advisor' OR a.kind = 'seo_advisor')
);

-- ---------------------------------------------------------------------------
-- Protect default agents from deletion
-- ---------------------------------------------------------------------------
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
  v_is_default boolean;
  v_enabled_others int;
  v_chat_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT a.organisation_id, a.is_default INTO v_org, v_is_default
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

  IF v_is_default THEN
    RAISE EXCEPTION 'default_agent_protected';
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

-- ---------------------------------------------------------------------------
-- Update: keep SEO advisor always enabled, ignore per-org prompt for globals
-- ---------------------------------------------------------------------------
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

  UPDATE public.dt_agents a
  SET
    name = COALESCE(NULLIF(trim(p_patch->>'name'), ''), a.name),
    role = CASE WHEN p_patch ? 'role' THEN NULLIF(trim(p_patch->>'role'), '') ELSE a.role END,
    prompt_template = CASE
      WHEN v_uses_global THEN a.prompt_template
      ELSE COALESCE(NULLIF(trim(p_patch->>'prompt_template'), ''), a.prompt_template)
    END,
    quick_actions = COALESCE(p_patch->'quick_actions', a.quick_actions),
    is_enabled = CASE
      WHEN v_is_default AND v_slug = 'seo_advisor' THEN true
      ELSE COALESCE((p_patch->>'is_enabled')::boolean, a.is_enabled)
    END,
    position = COALESCE((p_patch->>'position')::int, a.position),
    avatar_data = COALESCE(p_patch->'avatar_data', a.avatar_data)
  WHERE a.id = p_agent_id;

  RETURN p_agent_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Platform-admin editor for the global default prompts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_update_default_prompt(
  p_slug text,
  p_prompt text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_slug NOT IN ('default', 'seo_advisor') THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF COALESCE(trim(p_prompt), '') = '' THEN
    RAISE EXCEPTION 'empty_prompt';
  END IF;

  UPDATE public.dt_agent_templates
  SET default_prompt = trim(p_prompt),
      updated_at = timezone('utc'::text, now())
  WHERE slug = p_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_delete_agent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dt_update_agent(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dt_update_default_prompt(text, text) TO authenticated;
