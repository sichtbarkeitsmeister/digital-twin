-- Stop seeding the Standard-Avatar (slug=default) and remove the ones already created.
-- SEO-Berater stays. Chats that belonged only to the Standard-Avatar are removed with it.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.dt_seed_org_digitaltwin_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_name text;
  v_seo_tpl uuid;
BEGIN
  SELECT o.name INTO v_name FROM public.organisations o WHERE o.id = p_org_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dt_org_config (
    organisation_id,
    display_name,
    twin_provisioned,
    seo_enabled,
    ga4_account,
    gsc_account
  )
  VALUES (
    p_org_id,
    v_name,
    true,
    true,
    'ads@sichtbarkeitsmeister.de',
    'ads@sichtbarkeitsmeister.de'
  )
  ON CONFLICT (organisation_id) DO NOTHING;

  SELECT id INTO v_seo_tpl FROM public.dt_agent_templates WHERE slug = 'seo_advisor';

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

DELETE FROM public.dt_chats c
USING public.dt_agents a
WHERE c.agent_id = a.id
  AND a.slug = 'default'
  AND a.is_default = true
  AND a.kind IS DISTINCT FROM 'seo_advisor';

DELETE FROM public.dt_agents a
WHERE a.slug = 'default'
  AND a.is_default = true
  AND a.kind IS DISTINCT FROM 'seo_advisor';
