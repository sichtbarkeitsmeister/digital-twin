-- DigitalTwin Portal — Phase 1 schema, RLS, RPCs, storage, org seeding

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.dt_chat_mode AS ENUM ('default', 'seo', 'team', 'ghost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dt_agent_kind AS ENUM ('persona', 'seo_advisor', 'geo_advisor', 'wunschkunde', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dt_msg_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dt_task_status AS ENUM ('open', 'in_progress', 'done', 'wont_fix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dt_report_state AS ENUM ('idle', 'queued', 'running', 'done', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dt_agent_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  kind public.dt_agent_kind NOT NULL,
  name text NOT NULL,
  short_description text NOT NULL DEFAULT '',
  long_description text NOT NULL DEFAULT '',
  default_prompt text NOT NULL,
  default_avatar_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.dt_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.dt_agent_templates(id) ON DELETE SET NULL,
  kind public.dt_agent_kind NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  role text,
  prompt_template text NOT NULL,
  avatar_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  quick_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, slug)
);

CREATE TABLE IF NOT EXISTS public.dt_org_config (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  website_url text,
  footer_url text,
  seo_enabled boolean NOT NULL DEFAULT false,
  ga4_property_id text,
  gsc_site_url text,
  sistrix_domain text,
  sitemap_url text,
  focus_keyword text,
  report_recipient_email text,
  report_timeframe text NOT NULL DEFAULT 'last_30_days'
    CHECK (report_timeframe IN ('last_7_days', 'last_30_days', 'last_90_days')),
  seo_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  twin_provisioned boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.dt_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.dt_agents(id) ON DELETE RESTRICT,
  mode public.dt_chat_mode NOT NULL DEFAULT 'default',
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Neuer Chat',
  archived_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_chats_org_idx ON public.dt_chats(organisation_id);
CREATE INDEX IF NOT EXISTS dt_chats_owner_idx ON public.dt_chats(owner_user_id);
CREATE INDEX IF NOT EXISTS dt_chats_agent_idx ON public.dt_chats(agent_id);
CREATE INDEX IF NOT EXISTS dt_chats_mode_idx ON public.dt_chats(mode);
CREATE INDEX IF NOT EXISTS dt_chats_updated_idx ON public.dt_chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.dt_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.dt_chats(id) ON DELETE CASCADE,
  role public.dt_msg_role NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stopped boolean NOT NULL DEFAULT false,
  token_count_in int,
  token_count_out int,
  model text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_chat_messages_chat_id_idx ON public.dt_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS dt_chat_messages_chat_created_idx ON public.dt_chat_messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS public.dt_chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.dt_chats(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.dt_chat_messages(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_chat_attachments_chat_id_idx ON public.dt_chat_attachments(chat_id);

CREATE TABLE IF NOT EXISTS public.dt_seo_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.dt_chats(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.dt_chat_messages(id) ON DELETE SET NULL,
  title text NOT NULL,
  url text,
  keyword text,
  current_status text,
  action text,
  assigned_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_label text,
  status public.dt_task_status NOT NULL DEFAULT 'open',
  priority text CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  notes text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_seo_tasks_org_idx ON public.dt_seo_tasks(organisation_id);

CREATE TABLE IF NOT EXISTS public.dt_seo_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  triggered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('intern', 'kunde')),
  recipient_email text NOT NULL,
  state public.dt_report_state NOT NULL DEFAULT 'queued',
  state_message text,
  url text,
  focus_keyword text,
  timeframe text,
  ga4_property_id text,
  gsc_site_url text,
  sistrix_domain text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_path text,
  followup_due_at timestamptz,
  followup_done boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS dt_seo_reports_org_idx ON public.dt_seo_reports(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dt_seo_reports_state_idx ON public.dt_seo_reports(state);
CREATE INDEX IF NOT EXISTS dt_seo_reports_followup_idx ON public.dt_seo_reports(followup_due_at)
  WHERE followup_done = false;

CREATE TABLE IF NOT EXISTS public.dt_site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  h1 text,
  meta_description text,
  text_content text,
  is_excluded boolean NOT NULL DEFAULT false,
  crawled_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, url)
);

CREATE TABLE IF NOT EXISTS public.dt_seo_monthly_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  ai_clicks int NOT NULL DEFAULT 0,
  total_clicks int NOT NULL DEFAULT 0,
  impressions int NOT NULL DEFAULT 0,
  rankings_top10 int NOT NULL DEFAULT 0,
  rankings_top3 int NOT NULL DEFAULT 0,
  visibility_index numeric,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (organisation_id, period_month)
);

CREATE TABLE IF NOT EXISTS public.dt_user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  global_assistant_rules text NOT NULL DEFAULT '',
  show_archived_chats boolean NOT NULL DEFAULT false,
  default_agent_id uuid REFERENCES public.dt_agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_agent_templates
    BEFORE UPDATE ON public.dt_agent_templates
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_agents
    BEFORE UPDATE ON public.dt_agents
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_org_config
    BEFORE UPDATE ON public.dt_org_config
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_chats
    BEFORE UPDATE ON public.dt_chats
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_seo_tasks
    BEFORE UPDATE ON public.dt_seo_tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_seo_reports
    BEFORE UPDATE ON public.dt_seo_reports
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_user_preferences
    BEFORE UPDATE ON public.dt_user_preferences
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bump chat.updated_at when a message is inserted
CREATE OR REPLACE FUNCTION public.dt_bump_chat_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.dt_chats
  SET updated_at = timezone('utc'::text, now())
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dt_chat_messages_bump_chat ON public.dt_chat_messages;
CREATE TRIGGER dt_chat_messages_bump_chat
  AFTER INSERT ON public.dt_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.dt_bump_chat_on_message();

-- SEO report follow-up due date
CREATE OR REPLACE FUNCTION public.dt_seo_report_set_followup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'done'
     AND (OLD.state IS DISTINCT FROM 'done')
     AND NEW.followup_due_at IS NULL THEN
    NEW.followup_due_at := timezone('utc'::text, now()) + interval '3 months';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dt_seo_reports_followup ON public.dt_seo_reports;
CREATE TRIGGER dt_seo_reports_followup
  BEFORE UPDATE ON public.dt_seo_reports
  FOR EACH ROW EXECUTE FUNCTION public.dt_seo_report_set_followup();

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dt_user_can_view_chat(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dt_chats c
    WHERE c.id = p_chat_id
      AND (
        public.is_platform_admin(auth.uid())
        OR (
          public.is_org_member(c.organisation_id, auth.uid())
          AND (c.mode = 'team' OR c.owner_user_id = auth.uid())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.dt_storage_chat_id_from_path(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(replace(split_part(p_path, '/', 2), 'chat_', ''), '')::uuid;
$$;

-- Seed default org config + stub agent (§11.1)
CREATE OR REPLACE FUNCTION public.dt_seed_org_digitaltwin_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT o.name INTO v_name FROM public.organisations o WHERE o.id = p_org_id;
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dt_org_config (organisation_id, display_name, twin_provisioned, seo_enabled)
  VALUES (p_org_id, v_name, true, false)
  ON CONFLICT (organisation_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.dt_agents a WHERE a.organisation_id = p_org_id
  ) THEN
    INSERT INTO public.dt_agents (
      organisation_id, kind, slug, name, role, prompt_template, is_enabled, position
    )
    VALUES (
      p_org_id,
      'persona',
      'default',
      'DigitalTwin von ' || v_name,
      'Standard-Avatar',
      'Du bist der DigitalTwin von ' || v_name
        || '. Du hilfst dem Team und Kunden bei allgemeinen Fragen. '
        || 'Antworte auf Deutsch, freundlich und prägnant. Stelle Rückfragen, wenn du unsicher bist.',
      true,
      0
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dt_on_organisation_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.dt_seed_org_digitaltwin_defaults(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dt_organisation_seed_defaults ON public.organisations;
CREATE TRIGGER dt_organisation_seed_defaults
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.dt_on_organisation_created();

-- Create chat (RPC-only insert path for dt_chats)
CREATE OR REPLACE FUNCTION public.dt_create_chat(
  p_organisation_id uuid,
  p_agent_id uuid,
  p_mode public.dt_chat_mode,
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_chat_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.is_platform_admin(v_uid)
    OR public.is_org_member(p_organisation_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_mode = 'ghost' THEN
    RAISE EXCEPTION 'ghost_mode_not_persisted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.dt_agents a
    WHERE a.id = p_agent_id
      AND a.organisation_id = p_organisation_id
      AND a.is_enabled = true
  ) THEN
    RAISE EXCEPTION 'invalid_agent';
  END IF;

  INSERT INTO public.dt_chats (organisation_id, agent_id, mode, owner_user_id, title)
  VALUES (
    p_organisation_id,
    p_agent_id,
    p_mode,
    v_uid,
    COALESCE(NULLIF(trim(p_title), ''), 'Neuer Chat')
  )
  RETURNING id INTO v_chat_id;

  RETURN v_chat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dt_create_chat(uuid, uuid, public.dt_chat_mode, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.dt_agent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_org_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_seo_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_seo_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_seo_monthly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_user_preferences ENABLE ROW LEVEL SECURITY;

-- dt_agent_templates
DROP POLICY IF EXISTS "dt_agent_templates_select" ON public.dt_agent_templates;
CREATE POLICY "dt_agent_templates_select"
ON public.dt_agent_templates FOR SELECT
USING (is_public = true OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "dt_agent_templates_insert_admin" ON public.dt_agent_templates;
CREATE POLICY "dt_agent_templates_insert_admin"
ON public.dt_agent_templates FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "dt_agent_templates_update_admin" ON public.dt_agent_templates;
CREATE POLICY "dt_agent_templates_update_admin"
ON public.dt_agent_templates FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "dt_agent_templates_delete_admin" ON public.dt_agent_templates;
CREATE POLICY "dt_agent_templates_delete_admin"
ON public.dt_agent_templates FOR DELETE
USING (public.is_platform_admin(auth.uid()));

-- dt_agents (reads only; writes via SECURITY DEFINER seed/RPC later)
DROP POLICY IF EXISTS "dt_agents_select_member" ON public.dt_agents;
CREATE POLICY "dt_agents_select_member"
ON public.dt_agents FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

-- dt_org_config
DROP POLICY IF EXISTS "dt_org_config_select_member" ON public.dt_org_config;
CREATE POLICY "dt_org_config_select_member"
ON public.dt_org_config FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_config_update_admin" ON public.dt_org_config;
CREATE POLICY "dt_org_config_update_admin"
ON public.dt_org_config FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);

-- dt_chats (no INSERT/DELETE policies — use dt_create_chat RPC)
DROP POLICY IF EXISTS "dt_chats_select_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_select_visible"
ON public.dt_chats FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND (mode = 'team' OR owner_user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "dt_chats_update_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_update_visible"
ON public.dt_chats FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode = 'team'
    AND public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode = 'team'
    AND public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS "dt_chats_delete_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_delete_visible"
ON public.dt_chats FOR DELETE
USING (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode = 'team'
    AND public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);

-- dt_chat_messages
DROP POLICY IF EXISTS "dt_chat_messages_select" ON public.dt_chat_messages;
CREATE POLICY "dt_chat_messages_select"
ON public.dt_chat_messages FOR SELECT
USING (public.dt_user_can_view_chat(chat_id));

DROP POLICY IF EXISTS "dt_chat_messages_insert" ON public.dt_chat_messages;
CREATE POLICY "dt_chat_messages_insert"
ON public.dt_chat_messages FOR INSERT
WITH CHECK (
  public.dt_user_can_view_chat(chat_id)
  AND (
    role <> 'user'
    OR author_user_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS "dt_chat_messages_update" ON public.dt_chat_messages;
CREATE POLICY "dt_chat_messages_update"
ON public.dt_chat_messages FOR UPDATE
USING (
  public.dt_user_can_view_chat(chat_id)
  AND (
    public.is_platform_admin(auth.uid())
    OR author_user_id = auth.uid()
  )
)
WITH CHECK (public.dt_user_can_view_chat(chat_id));

DROP POLICY IF EXISTS "dt_chat_messages_delete" ON public.dt_chat_messages;
CREATE POLICY "dt_chat_messages_delete"
ON public.dt_chat_messages FOR DELETE
USING (
  public.dt_user_can_view_chat(chat_id)
  AND (
    public.is_platform_admin(auth.uid())
    OR author_user_id = auth.uid()
  )
);

-- dt_chat_attachments
DROP POLICY IF EXISTS "dt_chat_attachments_select" ON public.dt_chat_attachments;
CREATE POLICY "dt_chat_attachments_select"
ON public.dt_chat_attachments FOR SELECT
USING (public.dt_user_can_view_chat(chat_id));

DROP POLICY IF EXISTS "dt_chat_attachments_insert" ON public.dt_chat_attachments;
CREATE POLICY "dt_chat_attachments_insert"
ON public.dt_chat_attachments FOR INSERT
WITH CHECK (public.dt_user_can_view_chat(chat_id));

DROP POLICY IF EXISTS "dt_chat_attachments_delete" ON public.dt_chat_attachments;
CREATE POLICY "dt_chat_attachments_delete"
ON public.dt_chat_attachments FOR DELETE
USING (public.dt_user_can_view_chat(chat_id));

-- dt_seo_tasks
DROP POLICY IF EXISTS "dt_seo_tasks_select" ON public.dt_seo_tasks;
CREATE POLICY "dt_seo_tasks_select"
ON public.dt_seo_tasks FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_seo_tasks_insert" ON public.dt_seo_tasks;
CREATE POLICY "dt_seo_tasks_insert"
ON public.dt_seo_tasks FOR INSERT
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_seo_tasks_update" ON public.dt_seo_tasks;
CREATE POLICY "dt_seo_tasks_update"
ON public.dt_seo_tasks FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_seo_tasks_delete" ON public.dt_seo_tasks;
CREATE POLICY "dt_seo_tasks_delete"
ON public.dt_seo_tasks FOR DELETE
USING (
  public.is_platform_admin(auth.uid())
  OR (
    public.is_org_member(organisation_id, auth.uid())
    AND public.my_org_role(organisation_id) IN ('owner', 'admin')
  )
);

-- dt_seo_reports (reads; writes via service/RPC in later phases)
DROP POLICY IF EXISTS "dt_seo_reports_select" ON public.dt_seo_reports;
CREATE POLICY "dt_seo_reports_select"
ON public.dt_seo_reports FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

-- dt_site_pages
DROP POLICY IF EXISTS "dt_site_pages_select" ON public.dt_site_pages;
CREATE POLICY "dt_site_pages_select"
ON public.dt_site_pages FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

-- dt_seo_monthly_stats
DROP POLICY IF EXISTS "dt_seo_monthly_stats_select" ON public.dt_seo_monthly_stats;
CREATE POLICY "dt_seo_monthly_stats_select"
ON public.dt_seo_monthly_stats FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

-- dt_user_preferences
DROP POLICY IF EXISTS "dt_user_preferences_select_own" ON public.dt_user_preferences;
CREATE POLICY "dt_user_preferences_select_own"
ON public.dt_user_preferences FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "dt_user_preferences_insert_own" ON public.dt_user_preferences;
CREATE POLICY "dt_user_preferences_insert_own"
ON public.dt_user_preferences FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "dt_user_preferences_update_own" ON public.dt_user_preferences;
CREATE POLICY "dt_user_preferences_update_own"
ON public.dt_user_preferences FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "dt_user_preferences_delete_own" ON public.dt_user_preferences;
CREATE POLICY "dt_user_preferences_delete_own"
ON public.dt_user_preferences FOR DELETE
USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage bucket: dt-chat-attachments
-- Path: org_{organisation_id}/chat_{chat_id}/msg_{message_id}/{filename}
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dt-chat-attachments',
  'dt-chat-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "dt_chat_attachments_storage_select" ON storage.objects;
CREATE POLICY "dt_chat_attachments_storage_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'dt-chat-attachments'
  AND public.dt_user_can_view_chat(public.dt_storage_chat_id_from_path(name))
);

DROP POLICY IF EXISTS "dt_chat_attachments_storage_insert" ON storage.objects;
CREATE POLICY "dt_chat_attachments_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'dt-chat-attachments'
  AND public.dt_user_can_view_chat(public.dt_storage_chat_id_from_path(name))
);

DROP POLICY IF EXISTS "dt_chat_attachments_storage_update" ON storage.objects;
CREATE POLICY "dt_chat_attachments_storage_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'dt-chat-attachments'
  AND public.dt_user_can_view_chat(public.dt_storage_chat_id_from_path(name))
)
WITH CHECK (
  bucket_id = 'dt-chat-attachments'
  AND public.dt_user_can_view_chat(public.dt_storage_chat_id_from_path(name))
);

DROP POLICY IF EXISTS "dt_chat_attachments_storage_delete" ON storage.objects;
CREATE POLICY "dt_chat_attachments_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'dt-chat-attachments'
  AND public.dt_user_can_view_chat(public.dt_storage_chat_id_from_path(name))
);

-- ---------------------------------------------------------------------------
-- Backfill existing organisations (§11.1)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.organisations LOOP
    PERFORM public.dt_seed_org_digitaltwin_defaults(r.id);
  END LOOP;
END;
$$;
