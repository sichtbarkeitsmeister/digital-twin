-- Texte: why the model stopped in a step's last call, for the step log in the page window.
-- `tool_use` / `end_turn` = finished answer, `max_tokens` = cut off at the token limit,
-- `timeout` = the time limit cut the stream (set by the app, the API sends no stop_reason then).
-- The app runs without this column too; it then stores and shows no stop_reason.

ALTER TABLE public.dt_content_steps
  ADD COLUMN IF NOT EXISTS stop_reason text;

COMMENT ON COLUMN public.dt_content_steps.stop_reason IS
  'stop_reason des letzten KI-Aufrufs des Schritts (tool_use, end_turn, max_tokens, timeout). Ausgabe-Tokens stehen in output_tokens.';
