-- Default SEO report window: last 90 days (~3 months, GSC-friendly rolling range).
ALTER TABLE public.dt_org_config
  ALTER COLUMN report_timeframe SET DEFAULT 'last_90_days';

-- Align existing orgs that still use the old 30-day default.
UPDATE public.dt_org_config
SET report_timeframe = 'last_90_days'
WHERE report_timeframe = 'last_30_days';
