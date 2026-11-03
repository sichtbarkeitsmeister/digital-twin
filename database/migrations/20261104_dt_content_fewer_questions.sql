-- Texte: far fewer customer questions – company questions once per organisation, one stop per page.
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor, after
-- 20261103_dt_content_client_data.sql. The new code reads dt_content_pages.question_stop and
-- dt_content_org_questions for every Texte step; without them Texte shows a message naming this
-- file (contentDbErrorMessage) and no page runs. Pages may be „Läuft“ while it runs; nothing is
-- renumbered, and pages that wait as „Braucht Sie“ under the old rules keep working as they are.
--
-- What it does:
--   1. dt_content_org_questions: questions about the company (Telefon, Öffnungszeiten,
--      Google-Profil …) asked ONCE per organisation instead of on every page („Fragen zum
--      Unternehmen“ in Texte). One row per topic or per question text (dedupe_key), with the
--      pages that raised it. An answer applies to all pages: a contact topic goes into the
--      Kontaktdaten (source „antwort“), any other answer is a confirmed fact for every later step.
--   2. dt_content_pages.question_stop: the page's one stop for questions, before the Watermark
--      Entfernung ({} until the run gets there; then waiting → answered → done). The short pass
--      „Antworten einarbeiten“ records its cost here and on the page; it is no step of its own.
--
-- Idempotent: table, index, column and policy are created only once / dropped and created again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dt_content_org_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- The topic of the code's topic map (telefon, adresse, oeffnungszeiten …) or „text:<loose text>“.
  dedupe_key text NOT NULL,
  topic_key text,
  question text NOT NULL,
  -- Placeholder and sentence of the first page that asked, for the answer field.
  placeholder text,
  excerpt text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'no_answer')),
  answer text,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at timestamptz,
  page_slugs text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.dt_content_org_questions IS
  'Fragen zum Unternehmen aus Texte: einmal je Organisation statt auf jeder Seite (Telefon, Adresse, Öffnungszeiten, Google-Profil …). Eine Antwort gilt für alle Seiten; Kontaktthemen gehen in die Kontaktdaten (Quelle „antwort“), andere Antworten sind bestätigte Fakten.';

CREATE UNIQUE INDEX IF NOT EXISTS dt_content_org_questions_dedupe_idx
  ON public.dt_content_org_questions(organisation_id, dedupe_key);

CREATE INDEX IF NOT EXISTS dt_content_org_questions_org_status_idx
  ON public.dt_content_org_questions(organisation_id, status);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_content_org_questions
    BEFORE UPDATE ON public.dt_content_org_questions
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_content_org_questions ENABLE ROW LEVEL SECURITY;

-- Like every Texte table: read for whoever may use Texte; writes through the service client.
DROP POLICY IF EXISTS "dt_content_org_questions_select" ON public.dt_content_org_questions;
CREATE POLICY "dt_content_org_questions_select"
ON public.dt_content_org_questions FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS question_stop jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.dt_content_pages.question_stop IS
  'Der eine Halt für Fragen vor der Watermark Entfernung: {} bis der Lauf dort ankommt, dann status waiting (Braucht Sie) → answered („Antworten einarbeiten & weiter“) → done, mit den Antworten und den Kosten des kurzen Einarbeitungs-Durchgangs (kein eigener Schritt). „Zurücksetzen“ und „Mit Anmerkung wiederholen“ bis zum Lektorat leeren ihn.';

COMMIT;
