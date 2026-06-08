-- Phase 4: queue SEO report RPC

CREATE OR REPLACE FUNCTION public.dt_queue_seo_report(
  p_organisation_id uuid,
  p_recipient_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cfg public.dt_org_config%ROWTYPE;
  v_email text;
  v_report_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_recipient_type NOT IN ('intern', 'kunde') THEN
    RAISE EXCEPTION 'invalid_recipient_type';
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

  SELECT * INTO v_cfg
  FROM public.dt_org_config c
  WHERE c.organisation_id = p_organisation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_config_not_found';
  END IF;

  IF NOT v_cfg.seo_enabled THEN
    RAISE EXCEPTION 'seo_not_enabled';
  END IF;

  IF v_cfg.disabled THEN
    RAISE EXCEPTION 'org_disabled';
  END IF;

  v_email := COALESCE(NULLIF(trim(v_cfg.report_recipient_email), ''), '');
  IF v_email = '' THEN
    RAISE EXCEPTION 'missing_recipient_email';
  END IF;

  INSERT INTO public.dt_seo_reports (
    organisation_id,
    triggered_by_user_id,
    recipient_type,
    recipient_email,
    state,
    url,
    focus_keyword,
    timeframe,
    ga4_property_id,
    gsc_site_url,
    sistrix_domain
  )
  VALUES (
    p_organisation_id,
    v_uid,
    p_recipient_type,
    v_email,
    'queued',
    v_cfg.website_url,
    v_cfg.focus_keyword,
    v_cfg.report_timeframe,
    v_cfg.ga4_property_id,
    v_cfg.gsc_site_url,
    v_cfg.sistrix_domain
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_queue_seo_report(uuid, text) TO authenticated;
