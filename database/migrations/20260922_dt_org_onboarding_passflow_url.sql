-- Optional Passflow share link on onboarding records (encrypted at rest in the app).

ALTER TABLE public.dt_org_onboarding
  ADD COLUMN IF NOT EXISTS passflow_url text,
  ADD COLUMN IF NOT EXISTS passflow_notified_at timestamptz;

COMMENT ON COLUMN public.dt_org_onboarding.passflow_url IS
  'Passflow-Link als Notlösung, wenn Zugangsdaten nicht in den Feldern stehen. In der App verschlüsselt.';

COMMENT ON COLUMN public.dt_org_onboarding.passflow_notified_at IS
  'Zeitpunkt der letzten Benachrichtigung an das Projektteam über einen hinterlegten Passflow-Link.';
