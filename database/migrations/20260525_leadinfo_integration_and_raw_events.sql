-- Org-scoped integration credentials and raw inbound webhook capture.

CREATE TABLE IF NOT EXISTS public.org_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  webhook_token text UNIQUE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT org_integrations_org_provider_unique UNIQUE (organisation_id, provider)
);

CREATE TABLE IF NOT EXISTS public.integration_raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  integration_id uuid REFERENCES public.org_integrations(id) ON DELETE SET NULL,
  provider text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  match_status text NOT NULL CHECK (match_status IN ('matched', 'unknown_token', 'missing_token')),
  http_method text,
  path text,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_raw text,
  body_json jsonb,
  signature_header text,
  source_ip text
);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_org_integrations
    BEFORE UPDATE ON public.org_integrations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS org_integrations_organisation_id_idx
  ON public.org_integrations(organisation_id);

CREATE INDEX IF NOT EXISTS org_integrations_provider_idx
  ON public.org_integrations(provider);

CREATE UNIQUE INDEX IF NOT EXISTS org_integrations_webhook_token_idx
  ON public.org_integrations(webhook_token)
  WHERE webhook_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS integration_raw_events_org_received_at_idx
  ON public.integration_raw_events(organisation_id, received_at DESC);

CREATE INDEX IF NOT EXISTS integration_raw_events_match_status_idx
  ON public.integration_raw_events(match_status);

CREATE INDEX IF NOT EXISTS integration_raw_events_provider_received_at_idx
  ON public.integration_raw_events(provider, received_at DESC);

ALTER TABLE public.org_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_raw_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_integrations_select_admin" ON public.org_integrations;
CREATE POLICY "org_integrations_select_admin"
ON public.org_integrations
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "org_integrations_insert_admin" ON public.org_integrations;
CREATE POLICY "org_integrations_insert_admin"
ON public.org_integrations
FOR INSERT
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "org_integrations_update_admin" ON public.org_integrations;
CREATE POLICY "org_integrations_update_admin"
ON public.org_integrations
FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "org_integrations_delete_admin" ON public.org_integrations;
CREATE POLICY "org_integrations_delete_admin"
ON public.org_integrations
FOR DELETE
USING (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "integration_raw_events_select_admin" ON public.integration_raw_events;
CREATE POLICY "integration_raw_events_select_admin"
ON public.integration_raw_events
FOR SELECT
USING (
  organisation_id IS NOT NULL
  AND (
    public.is_platform_admin(auth.uid())
    OR public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);
