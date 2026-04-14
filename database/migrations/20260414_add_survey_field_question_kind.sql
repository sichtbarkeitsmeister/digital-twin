-- Separate user field items into question vs remark.

DO $$ BEGIN
  ALTER TABLE public.survey_field_questions
    ADD COLUMN kind text NOT NULL DEFAULT 'question';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

UPDATE public.survey_field_questions
SET kind = 'question'
WHERE kind IS NULL OR length(trim(kind)) = 0;

DO $$ BEGIN
  ALTER TABLE public.survey_field_questions
    DROP CONSTRAINT IF EXISTS survey_field_questions_kind_valid;
  ALTER TABLE public.survey_field_questions
    ADD CONSTRAINT survey_field_questions_kind_valid CHECK (kind IN ('question', 'remark'));
EXCEPTION WHEN undefined_table THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.list_public_field_questions(
  p_slug text,
  p_field_id text
)
RETURNS TABLE (
  id uuid,
  field_id text,
  kind text,
  question text,
  asked_at timestamptz,
  answer text,
  answered_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT q.id, q.field_id, q.kind, q.question, q.asked_at, q.answer, q.answered_at
  FROM public.survey_field_questions q
  JOIN public.surveys s ON s.id = q.survey_id
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
    AND q.field_id = p_field_id
  ORDER BY q.asked_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.ask_public_field_question(
  p_slug text,
  p_field_id text,
  p_question text,
  p_kind text DEFAULT 'question'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
  v_question_id uuid;
BEGIN
  p_kind := lower(trim(coalesce(p_kind, 'question')));

  IF length(trim(coalesce(p_question, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_question';
  END IF;
  IF p_kind NOT IN ('question', 'remark') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;

  IF v_survey_id IS NULL THEN
    RAISE EXCEPTION 'survey_not_found';
  END IF;

  SELECT r.id INTO v_response_id
  FROM public.survey_responses r
  WHERE r.survey_id = v_survey_id
  LIMIT 1;

  IF v_response_id IS NULL THEN
    RAISE EXCEPTION 'response_not_found';
  END IF;

  INSERT INTO public.survey_field_questions (survey_id, response_id, field_id, kind, question)
  VALUES (v_survey_id, v_response_id, p_field_id, p_kind, trim(p_question))
  RETURNING id INTO v_question_id;

  RETURN v_question_id;
END;
$$;
