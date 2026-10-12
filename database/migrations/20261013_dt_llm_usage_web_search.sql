-- Websuche / Web-Abruf im SEO-Chat: Anzahl der Server-Tool-Aufrufe je KI-Antwort erfassen.
-- Websuche kostet 10 $ je 1.000 Suchen zusätzlich zu den Tokens; Web-Abruf nur Tokens.

ALTER TABLE public.dt_llm_usage_events
  ADD COLUMN IF NOT EXISTS web_search_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS web_fetch_requests integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.dt_llm_usage_events.web_search_requests IS
  'Anzahl der Websuchen (Anthropic web_search) in dieser KI-Antwort.';
COMMENT ON COLUMN public.dt_llm_usage_events.web_fetch_requests IS
  'Anzahl der Web-Abrufe (Anthropic web_fetch) in dieser KI-Antwort.';
