-- Texte → Seitenquelle → „Verbesserung“ → „Texte hochladen“: second matching step „KI“.
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor, after
-- 20261110_dt_content_text_uploads.sql. Without it the AI step is skipped („Mit KI zuordnen“
-- shows a message naming this file) and everything else keeps working: the name match in code
-- and the manual assignment read and write only the columns that exist already.
--
-- What it does on dt_content_text_uploads:
--   1. match also allows 'ai': the file got its page from the AI step
--      (lib/dt/content/upload-ai-match.ts), which looks only at files the name rule left
--      unassigned. 'manual' still wins over it.
--   2. ai_tried_at: when the AI last looked at the file without assigning it. Such a file is
--      not sent again until a new Webseitenstruktur is uploaded (or „Mit KI zuordnen“ is clicked).
--   3. ai_reason: the AI's one-line reason for its assignment, shown in the table.
--
-- Idempotent: the constraint is dropped and created again, the columns are added only once.

BEGIN;

ALTER TABLE public.dt_content_text_uploads DROP CONSTRAINT IF EXISTS dt_content_text_uploads_match_check;
ALTER TABLE public.dt_content_text_uploads
  ADD CONSTRAINT dt_content_text_uploads_match_check CHECK (match IS NULL OR match IN ('auto', 'ai', 'manual'));

ALTER TABLE public.dt_content_text_uploads ADD COLUMN IF NOT EXISTS ai_tried_at timestamptz;
ALTER TABLE public.dt_content_text_uploads ADD COLUMN IF NOT EXISTS ai_reason text;

COMMENT ON TABLE public.dt_content_text_uploads IS
  'Texte → Verbesserung → „Texte hochladen“: je hochgeladener Word-Datei der ausgelesene Text (Abschnitte), nicht die Originaldatei. Dateiname = Seitenname; Zuordnung zur Seitenstruktur per fester Namensregel (match auto), per KI (match ai) oder von Hand (match manual; structure_slug null = von Hand gelöst oder Seite nicht mehr in der Seitenstruktur).';
COMMENT ON COLUMN public.dt_content_text_uploads.ai_tried_at IS
  'Wann die KI die Datei zuletzt angesehen hat, ohne sie zuzuordnen. Älter als der Upload der Webseitenstruktur = wird erneut versucht.';
COMMENT ON COLUMN public.dt_content_text_uploads.ai_reason IS
  'Einzeilige Begründung der KI für ihre Zuordnung (nur bei match ai).';

COMMIT;
