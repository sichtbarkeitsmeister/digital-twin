-- Org owners submit agent edit requests; platform admins approve and apply changes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dt_agent_edit_request_status') THEN
    CREATE TYPE public.dt_agent_edit_request_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'cancelled'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.dt_agent_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.dt_agents(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.dt_agent_edit_request_status NOT NULL DEFAULT 'pending',
  proposed_changes jsonb NOT NULL,
  request_note text,
  reviewer_note text,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_agent_edit_requests_proposed_nonempty CHECK (
    jsonb_typeof(proposed_changes) = 'object'
    AND proposed_changes <> '{}'::jsonb
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS dt_agent_edit_requests_one_pending_per_agent
  ON public.dt_agent_edit_requests(agent_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS dt_agent_edit_requests_org_status_idx
  ON public.dt_agent_edit_requests(organisation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS dt_agent_edit_requests_pending_idx
  ON public.dt_agent_edit_requests(status, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.dt_agent_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_agent_edit_requests_select" ON public.dt_agent_edit_requests;
CREATE POLICY "dt_agent_edit_requests_select"
ON public.dt_agent_edit_requests FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND (
      public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.organisation_members om
        WHERE om.organisation_id = dt_agent_edit_requests.organisation_id
          AND om.user_id = auth.uid()
          AND om.org_role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.organisations o
        WHERE o.id = dt_agent_edit_requests.organisation_id
          AND o.owner_user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "dt_agent_edit_requests_insert" ON public.dt_agent_edit_requests;
CREATE POLICY "dt_agent_edit_requests_insert"
ON public.dt_agent_edit_requests FOR INSERT
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
  AND (
    EXISTS (
      SELECT 1 FROM public.organisation_members om
      WHERE om.organisation_id = dt_agent_edit_requests.organisation_id
        AND om.user_id = auth.uid()
        AND om.org_role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = dt_agent_edit_requests.organisation_id
        AND o.owner_user_id = auth.uid()
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.dt_agents a
    WHERE a.id = agent_id
      AND a.organisation_id = dt_agent_edit_requests.organisation_id
  )
);

DROP POLICY IF EXISTS "dt_agent_edit_requests_update_requester" ON public.dt_agent_edit_requests;
CREATE POLICY "dt_agent_edit_requests_update_requester"
ON public.dt_agent_edit_requests FOR UPDATE
USING (
  requested_by_user_id = auth.uid()
  AND status = 'pending'
)
WITH CHECK (
  requested_by_user_id = auth.uid()
  AND status = 'cancelled'
);

CREATE OR REPLACE FUNCTION public.dt_review_agent_edit_request(
  p_request_id uuid,
  p_decision text,
  p_reviewer_note text DEFAULT NULL
)
RETURNS public.dt_agent_edit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.dt_agent_edit_requests;
  v_changes jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_row
  FROM public.dt_agent_edit_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  IF p_decision = 'approve' THEN
    v_changes := v_row.proposed_changes;

    UPDATE public.dt_agents
       SET name = COALESCE(v_changes->>'name', name),
           role = CASE WHEN v_changes ? 'role' THEN NULLIF(v_changes->>'role', '') ELSE role END,
           prompt_template = COALESCE(v_changes->>'prompt_template', prompt_template),
           quick_actions = COALESCE(v_changes->'quick_actions', quick_actions),
           is_enabled = COALESCE((v_changes->>'is_enabled')::boolean, is_enabled),
           position = COALESCE((v_changes->>'position')::integer, position),
           updated_at = timezone('utc'::text, now())
     WHERE id = v_row.agent_id;

    UPDATE public.dt_agent_edit_requests
       SET status = 'approved',
           reviewer_note = NULLIF(trim(p_reviewer_note), ''),
           reviewed_by_user_id = v_uid,
           reviewed_at = timezone('utc'::text, now()),
           updated_at = timezone('utc'::text, now())
     WHERE id = p_request_id
    RETURNING * INTO v_row;

    RETURN v_row;
  ELSIF p_decision = 'reject' THEN
    UPDATE public.dt_agent_edit_requests
       SET status = 'rejected',
           reviewer_note = NULLIF(trim(p_reviewer_note), ''),
           reviewed_by_user_id = v_uid,
           reviewed_at = timezone('utc'::text, now()),
           updated_at = timezone('utc'::text, now())
     WHERE id = p_request_id
    RETURNING * INTO v_row;

    RETURN v_row;
  ELSE
    RAISE EXCEPTION 'invalid_decision';
  END IF;
END;
$$;
