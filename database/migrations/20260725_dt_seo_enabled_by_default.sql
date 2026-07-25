-- SEO is always on by default for DigitalTwin organisations.
-- Previously seed used seo_enabled=false, which blocked SEO workspace for
-- survey/avatar orgs until a buried settings toggle was flipped.

ALTER TABLE public.dt_org_config
  ALTER COLUMN seo_enabled SET DEFAULT true;

-- Enable SEO for all existing org configs (disabled flag still gates access).
UPDATE public.dt_org_config
SET seo_enabled = true
WHERE seo_enabled IS DISTINCT FROM true;

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
  VALUES (p_org_id, v_name, true, true)
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
