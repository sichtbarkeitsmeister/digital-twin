-- Phase 2: full-text search indexes for DigitalTwin chat discovery

CREATE INDEX IF NOT EXISTS dt_chats_title_search_idx
  ON public.dt_chats
  USING gin (to_tsvector('simple', coalesce(title, '')));

CREATE INDEX IF NOT EXISTS dt_chat_messages_content_search_idx
  ON public.dt_chat_messages
  USING gin (to_tsvector('simple', coalesce(content, '')));
