-- Add per-survey recipient emails + idempotent notification tracking.

ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS notification_emails text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS completed_notification_sent_at timestamptz;

ALTER TABLE public.survey_field_questions
  ADD COLUMN IF NOT EXISTS asked_notification_sent_at timestamptz;

