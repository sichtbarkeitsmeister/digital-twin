-- Allow platform admins to import survey responses and field questions.

DROP POLICY IF EXISTS "survey_responses_no_direct_insert" ON public.survey_responses;
DROP POLICY IF EXISTS "survey_responses_insert_platform_admin_only" ON public.survey_responses;
CREATE POLICY "survey_responses_insert_platform_admin_only"
ON public.survey_responses
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "survey_field_questions_no_direct_insert" ON public.survey_field_questions;
DROP POLICY IF EXISTS "survey_field_questions_insert_platform_admin_only" ON public.survey_field_questions;
CREATE POLICY "survey_field_questions_insert_platform_admin_only"
ON public.survey_field_questions
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

