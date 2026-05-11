-- Global AI chat persistence (user-scoped, multi-chat, action trace).

CREATE TABLE IF NOT EXISTS public.ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Neuer Chat',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.ai_chats(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ai_chat_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.ai_chats(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.ai_chat_messages(id) ON DELETE SET NULL,
  proposal_kind text NOT NULL,
  proposal_json jsonb NOT NULL,
  execution_status text NOT NULL DEFAULT 'proposed' CHECK (execution_status IN ('proposed', 'applied', 'reverted', 'failed')),
  execution_result jsonb,
  revert_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ai_chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.ai_chats(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.ai_chat_messages(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_ai_chats
    BEFORE UPDATE ON public.ai_chats
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ai_chats_user_id_idx ON public.ai_chats(user_id);
CREATE INDEX IF NOT EXISTS ai_chats_archived_at_idx ON public.ai_chats(archived_at);
CREATE INDEX IF NOT EXISTS ai_chats_created_at_idx ON public.ai_chats(created_at DESC);

CREATE INDEX IF NOT EXISTS ai_chat_messages_chat_id_idx ON public.ai_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS ai_chat_messages_created_at_idx ON public.ai_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_chat_messages_chat_id_created_at_idx ON public.ai_chat_messages(chat_id, created_at);

CREATE INDEX IF NOT EXISTS ai_chat_actions_chat_id_idx ON public.ai_chat_actions(chat_id);
CREATE INDEX IF NOT EXISTS ai_chat_actions_message_id_idx ON public.ai_chat_actions(message_id);
CREATE INDEX IF NOT EXISTS ai_chat_actions_created_at_idx ON public.ai_chat_actions(created_at DESC);

CREATE INDEX IF NOT EXISTS ai_chat_attachments_chat_id_idx ON public.ai_chat_attachments(chat_id);
CREATE INDEX IF NOT EXISTS ai_chat_attachments_message_id_idx ON public.ai_chat_attachments(message_id);

CREATE INDEX IF NOT EXISTS ai_chats_title_search_idx
  ON public.ai_chats
  USING gin (to_tsvector('simple', coalesce(title, '')));

CREATE INDEX IF NOT EXISTS ai_chat_messages_content_search_idx
  ON public.ai_chat_messages
  USING gin (to_tsvector('simple', coalesce(content, '')));

ALTER TABLE public.ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_chats_select_own" ON public.ai_chats;
CREATE POLICY "ai_chats_select_own"
ON public.ai_chats
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_chats_insert_own" ON public.ai_chats;
CREATE POLICY "ai_chats_insert_own"
ON public.ai_chats
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_chats_update_own" ON public.ai_chats;
CREATE POLICY "ai_chats_update_own"
ON public.ai_chats
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_chats_delete_own" ON public.ai_chats;
CREATE POLICY "ai_chats_delete_own"
ON public.ai_chats
FOR DELETE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_chat_messages_select_own_chat" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_select_own_chat"
ON public.ai_chat_messages
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_messages.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_messages_insert_own_chat" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_insert_own_chat"
ON public.ai_chat_messages
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_messages.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_messages_update_own_chat" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_update_own_chat"
ON public.ai_chat_messages
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_messages.chat_id AND c.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_messages.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_messages_delete_own_chat" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_delete_own_chat"
ON public.ai_chat_messages
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_messages.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_actions_select_own_chat" ON public.ai_chat_actions;
CREATE POLICY "ai_chat_actions_select_own_chat"
ON public.ai_chat_actions
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_actions.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_actions_insert_own_chat" ON public.ai_chat_actions;
CREATE POLICY "ai_chat_actions_insert_own_chat"
ON public.ai_chat_actions
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_actions.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_actions_update_own_chat" ON public.ai_chat_actions;
CREATE POLICY "ai_chat_actions_update_own_chat"
ON public.ai_chat_actions
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_actions.chat_id AND c.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_actions.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_actions_delete_own_chat" ON public.ai_chat_actions;
CREATE POLICY "ai_chat_actions_delete_own_chat"
ON public.ai_chat_actions
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_actions.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_attachments_select_own_chat" ON public.ai_chat_attachments;
CREATE POLICY "ai_chat_attachments_select_own_chat"
ON public.ai_chat_attachments
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_attachments.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_attachments_insert_own_chat" ON public.ai_chat_attachments;
CREATE POLICY "ai_chat_attachments_insert_own_chat"
ON public.ai_chat_attachments
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_attachments.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_attachments_update_own_chat" ON public.ai_chat_attachments;
CREATE POLICY "ai_chat_attachments_update_own_chat"
ON public.ai_chat_attachments
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_attachments.chat_id AND c.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_attachments.chat_id AND c.user_id = auth.uid()
));

DROP POLICY IF EXISTS "ai_chat_attachments_delete_own_chat" ON public.ai_chat_attachments;
CREATE POLICY "ai_chat_attachments_delete_own_chat"
ON public.ai_chat_attachments
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.ai_chats c WHERE c.id = ai_chat_attachments.chat_id AND c.user_id = auth.uid()
));

