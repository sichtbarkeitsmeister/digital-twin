-- System queue for unattended SEO reports (monthly scheduler).
-- No auth.uid() required; called via service role from internal APIs.

ALTER TABLE public.dt_seo_reports
  ADD COLUMN IF NOT EXISTS trigger_source text;

COMMENT ON COLUMN public.dt_seo_reports.trigger_source IS
  'manual | monthly_scheduler | null (legacy manual)';

CREATE OR REPLACE FUNCTION public.dt_queue_seo_report_system(
  p_organisation_id uuid,
  p_recipient_type text DEFAULT 'kunde',
  p_send_to_owner boolean DEFAULT true,
  p_trigger_source text DEFAULT 'monthly_scheduler'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_cfg public.dt_org_config%ROWTYPE;
  v_email text;
  v_report_id uuid;
  v_source text;
BEGIN
  IF p_recipient_type NOT IN ('intern', 'kunde') THEN
    RAISE EXCEPTION 'invalid_recipient_type';
  END IF;

  v_source := NULLIF(trim(COALESCE(p_trigger_source, '')), '');
  IF v_source IS NULL THEN
    v_source := 'monthly_scheduler';
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
    send_to_owner,
    trigger_source,
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
    NULL,
    p_recipient_type,
    v_email,
    COALESCE(p_send_to_owner, true),
    v_source,
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

-- Executable by service role / postgres; not granted to authenticated (system-only).
REVOKE ALL ON FUNCTION public.dt_queue_seo_report_system(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dt_queue_seo_report_system(uuid, text, boolean, text) TO service_role;
