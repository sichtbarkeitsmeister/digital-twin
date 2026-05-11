-- Soft delete support for surveys so AI actions can be reverted.

DO $$ BEGIN
  ALTER TABLE public.surveys
    ADD COLUMN deleted_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.surveys
    ADD COLUMN deleted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS surveys_deleted_at_idx ON public.surveys(deleted_at);

-- Public RPCs must ignore soft-deleted surveys.
CREATE OR REPLACE FUNCTION public.get_public_survey_by_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  slug text,
  definition jsonb,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT s.id, s.title, s.description, s.slug, s.definition, s.published_at
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.deleted_at IS NULL
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.create_public_survey_response(p_slug text)
RETURNS TABLE (
  response_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
  v_token text;
BEGIN
  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.deleted_at IS NULL
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
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.survey_responses (survey_id, token_hash)
    VALUES (v_survey_id, extensions.digest(convert_to(v_token, 'utf8'), 'sha256'::text))
    RETURNING id INTO v_response_id;
  END IF;

  response_id := v_response_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_public_survey_response(
  p_slug text,
  p_answers jsonb,
  p_mark_completed boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
DECLARE
  v_survey_id uuid;
  v_response_id uuid;
BEGIN
  SELECT s.id INTO v_survey_id
  FROM public.surveys s
  WHERE s.visibility = 'public'
    AND s.deleted_at IS NULL
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

  UPDATE public.survey_responses
  SET answers = coalesce(p_answers, '{}'::jsonb),
      status = CASE
        WHEN p_mark_completed THEN 'completed'::public.survey_response_status
        ELSE status
      END,
      completed_at = CASE
        WHEN p_mark_completed THEN coalesce(completed_at, timezone('utc'::text, now()))
        ELSE completed_at
      END
  WHERE id = v_response_id;
END;
$$;

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
    AND s.deleted_at IS NULL
    AND s.slug = lower(trim(p_slug))
    AND q.field_id = p_field_id
    AND q.kind = 'question'
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
    AND s.deleted_at IS NULL
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
    AND s.deleted_at IS NULL
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
    AND s.deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION public.get_public_survey_response(p_slug text)
RETURNS TABLE (
  answers jsonb,
  status public.survey_response_status,
  updated_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
SET row_security = off
AS $$
  SELECT r.answers, r.status, r.updated_at, r.completed_at
  FROM public.surveys s
  JOIN public.survey_responses r ON r.survey_id = s.id
  WHERE s.visibility = 'public'
    AND s.deleted_at IS NULL
    AND s.slug = lower(trim(p_slug))
  LIMIT 1;
$$;
