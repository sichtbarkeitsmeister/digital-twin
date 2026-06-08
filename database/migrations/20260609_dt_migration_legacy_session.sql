-- Phase 7: idempotent legacy chat import (session_id from OLD Supabase)

ALTER TABLE public.dt_chats
  ADD COLUMN IF NOT EXISTS legacy_session_id text;

CREATE UNIQUE INDEX IF NOT EXISTS dt_chats_org_legacy_session_uidx
  ON public.dt_chats(organisation_id, legacy_session_id)
  WHERE legacy_session_id IS NOT NULL;
