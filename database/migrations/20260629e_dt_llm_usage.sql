-- LLM token usage events for DigitalTwin chat analytics.

CREATE TABLE IF NOT EXISTS public.dt_llm_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.dt_chats(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.dt_chat_messages(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.dt_agents(id) ON DELETE SET NULL,
  mode text,
  via text NOT NULL CHECK (via IN ('direct', 'n8n', 'ghost')),
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_llm_usage_events_org_created_idx
  ON public.dt_llm_usage_events(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dt_llm_usage_events_org_user_idx
  ON public.dt_llm_usage_events(organisation_id, user_id);

ALTER TABLE public.dt_llm_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_llm_usage_select" ON public.dt_llm_usage_events;
CREATE POLICY "dt_llm_usage_select"
ON public.dt_llm_usage_events FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);
