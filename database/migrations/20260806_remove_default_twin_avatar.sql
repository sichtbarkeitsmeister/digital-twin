-- Stop creating the auto-seeded Standard-Avatar (slug=default) for new orgs.
-- Soft-disable existing unused starters when the org already has another persona.

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

-- Disable existing Standard-Avatars when the org already has another enabled persona.
-- Orgs with only the starter twin keep it enabled as a temporary chat fallback.
UPDATE public.dt_agents AS starter
SET is_enabled = false,
    updated_at = timezone('utc'::text, now())
WHERE starter.slug = 'default'
  AND starter.is_default = true
  AND starter.is_enabled = true
  AND EXISTS (
    SELECT 1
    FROM public.dt_agents other
    WHERE other.organisation_id = starter.organisation_id
      AND other.id <> starter.id
      AND other.is_enabled = true
      AND other.slug IS DISTINCT FROM 'seo_advisor'
      AND other.kind IS DISTINCT FROM 'seo_advisor'
      AND other.kind IS DISTINCT FROM 'geo_advisor'
  );
