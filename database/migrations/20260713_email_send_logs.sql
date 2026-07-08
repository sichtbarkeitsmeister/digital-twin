-- Email send audit log for platform-admin debugging.

CREATE TABLE IF NOT EXISTS public.email_send_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'generic',
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  to_addresses text[] NOT NULL DEFAULT '{}'::text[],
  subject text NOT NULL,
  from_address text,
  error_message text,
  smtp_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS email_send_logs_created_at_idx
  ON public.email_send_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS email_send_logs_status_idx
  ON public.email_send_logs(status);

CREATE INDEX IF NOT EXISTS email_send_logs_kind_idx
  ON public.email_send_logs(kind);

ALTER TABLE public.email_send_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_send_logs_select_platform_admin" ON public.email_send_logs;
CREATE POLICY "email_send_logs_select_platform_admin"
ON public.email_send_logs
FOR SELECT
USING (public.is_platform_admin(auth.uid()));
