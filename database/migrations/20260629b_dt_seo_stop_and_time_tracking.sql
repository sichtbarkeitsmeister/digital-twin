-- SEO report stop + per-ticket work time tracking.
-- Depends on: 20260601_dt_portal_phase1.sql (tables/enums),
--             20260606_dt_seo_admin_only.sql (dt_user_can_access_seo),
--             20260629a_dt_report_cancelled_enum.sql ('cancelled' enum value).

-- ---------------------------------------------------------------------------
-- 1) Stop a running/queued SEO report (user-initiated abort).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_stop_seo_report(p_report_id uuid)
RETURNS public.dt_seo_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_row public.dt_seo_reports;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT organisation_id INTO v_org
  FROM public.dt_seo_reports
  WHERE id = p_report_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  IF NOT public.dt_user_can_access_seo(v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.dt_seo_reports
     SET state = 'cancelled',
         state_message = 'Vom Benutzer abgebrochen.',
         finished_at = timezone('utc'::text, now())
   WHERE id = p_report_id
     AND state IN ('queued', 'running')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'report_not_stoppable';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_stop_seo_report(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Per-ticket work time tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dt_seo_task_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.dt_seo_tasks(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  ended_at timestamptz,
  duration_seconds integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_seo_task_time_entries_task_idx
  ON public.dt_seo_task_time_entries(task_id);
CREATE INDEX IF NOT EXISTS dt_seo_task_time_entries_org_idx
  ON public.dt_seo_task_time_entries(organisation_id);
CREATE INDEX IF NOT EXISTS dt_seo_task_time_entries_user_idx
  ON public.dt_seo_task_time_entries(user_id);

-- A user may only have a single running timer at a time across all tasks.
CREATE UNIQUE INDEX IF NOT EXISTS dt_seo_task_time_entries_one_running
  ON public.dt_seo_task_time_entries(user_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.dt_seo_task_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_task_time_select" ON public.dt_seo_task_time_entries;
CREATE POLICY "dt_task_time_select"
ON public.dt_seo_task_time_entries FOR SELECT
USING (public.dt_user_can_access_seo(organisation_id));

DROP POLICY IF EXISTS "dt_task_time_insert" ON public.dt_seo_task_time_entries;
CREATE POLICY "dt_task_time_insert"
ON public.dt_seo_task_time_entries FOR INSERT
WITH CHECK (public.dt_user_can_access_seo(organisation_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS "dt_task_time_update" ON public.dt_seo_task_time_entries;
CREATE POLICY "dt_task_time_update"
ON public.dt_seo_task_time_entries FOR UPDATE
USING (public.dt_user_can_access_seo(organisation_id) AND user_id = auth.uid())
WITH CHECK (public.dt_user_can_access_seo(organisation_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS "dt_task_time_delete" ON public.dt_seo_task_time_entries;
CREATE POLICY "dt_task_time_delete"
ON public.dt_seo_task_time_entries FOR DELETE
USING (public.dt_user_can_access_seo(organisation_id) AND user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) Start a timer on a ticket (auto-stops any other running timer for the user).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_start_task_timer(p_task_id uuid)
RETURNS public.dt_seo_task_time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_now timestamptz := timezone('utc'::text, now());
  v_row public.dt_seo_task_time_entries;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT organisation_id INTO v_org
  FROM public.dt_seo_tasks
  WHERE id = p_task_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;

  IF NOT public.dt_user_can_access_seo(v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Close any timer the user has currently running (on this or another task).
  UPDATE public.dt_seo_task_time_entries
     SET ended_at = v_now,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (v_now - started_at))::int)
   WHERE user_id = v_uid
     AND ended_at IS NULL;

  INSERT INTO public.dt_seo_task_time_entries (task_id, organisation_id, user_id, started_at)
  VALUES (p_task_id, v_org, v_uid, v_now)
  RETURNING * INTO v_row;

  -- Move an open ticket into "in progress" once work begins.
  UPDATE public.dt_seo_tasks
     SET status = 'in_progress'
   WHERE id = p_task_id
     AND status = 'open';

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_start_task_timer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Stop the running timer for the current user on a given ticket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_stop_task_timer(p_task_id uuid)
RETURNS public.dt_seo_task_time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_now timestamptz := timezone('utc'::text, now());
  v_row public.dt_seo_task_time_entries;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT organisation_id INTO v_org
  FROM public.dt_seo_tasks
  WHERE id = p_task_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;

  IF NOT public.dt_user_can_access_seo(v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.dt_seo_task_time_entries
     SET ended_at = v_now,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (v_now - started_at))::int)
   WHERE task_id = p_task_id
     AND user_id = v_uid
     AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no_running_timer';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_stop_task_timer(uuid) TO authenticated;
