-- Split Q&A vs remarks: remarks are editable field notes, not answer-required items.

CREATE INDEX IF NOT EXISTS survey_field_questions_kind_idx ON public.survey_field_questions(kind);
CREATE UNIQUE INDEX IF NOT EXISTS survey_field_questions_remark_unique_idx
  ON public.survey_field_questions(response_id, field_id)
  WHERE kind = 'remark';

DROP FUNCTION IF EXISTS public.list_public_field_questions(text, text);
CREATE FUNCTION public.list_public_field_questions(
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
    AND q.kind = 'question'
  ORDER BY q.asked_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_public_field_remark(
  p_slug text,
  p_field_id text
)
RETURNS TABLE (
  id uuid,
  field_id text,
  remark text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT q.id, q.field_id, q.question AS remark, q.asked_at AS updated_at
  FROM public.survey_field_questions q
  JOIN public.surveys s ON s.id = q.survey_id
  WHERE s.visibility = 'public'
    AND s.slug = lower(trim(p_slug))
    AND q.field_id = p_field_id
    AND q.kind = 'remark'
  ORDER BY q.asked_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.upsert_public_field_remark(
  p_slug text,
  p_field_id text,
  p_remark text
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
  v_remark_id uuid;
  v_text text;
BEGIN
  v_text := trim(coalesce(p_remark, ''));

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

  IF v_text = '' THEN
    DELETE FROM public.survey_field_questions
    WHERE response_id = v_response_id
      AND field_id = p_field_id
      AND kind = 'remark';
    RETURN NULL;
  END IF;

  INSERT INTO public.survey_field_questions (
    survey_id,
    response_id,
    field_id,
    kind,
    question,
    asked_notification_sent_at,
    answer,
    answered_by_user_id,
    answered_at,
    asked_at
  )
  VALUES (
    v_survey_id,
    v_response_id,
    p_field_id,
    'remark',
    v_text,
    timezone('utc'::text, now()),
    v_text,
    NULL,
    timezone('utc'::text, now()),
    timezone('utc'::text, now())
  )
  ON CONFLICT (response_id, field_id) WHERE (kind = 'remark')
  DO UPDATE SET
    question = EXCLUDED.question,
    asked_at = timezone('utc'::text, now()),
    answer = EXCLUDED.answer,
    answered_at = timezone('utc'::text, now()),
    answered_by_user_id = NULL,
    asked_notification_sent_at = timezone('utc'::text, now())
  RETURNING id INTO v_remark_id;

  RETURN v_remark_id;
END;
$$;
