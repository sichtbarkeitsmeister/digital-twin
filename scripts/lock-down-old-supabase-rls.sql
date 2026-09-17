-- Lock down the LEGACY Supabase project "digitaltwin n8n Workflow"
-- (ref zijlepanidmvwxbuwldz, URL https://zijlepanidmvwxbuwldz.supabase.co).
--
-- Security Advisor findings this fixes:
--   - RLS Disabled in Public on archived_sessions, website_content, seo_tasks,
--     seo_clients, client_config, seo_cache
--   - Sensitive Columns Exposed on archived_sessions
--
-- DO NOT run this on NEW (hqjszschgjzfnsecngit / sbkm). The guard below aborts
-- if dt_* portal tables exist or the legacy tables are missing.
--
-- Effect:
--   - Enables RLS (default deny for JWT / anon / authenticated).
--   - Revokes Data API grants from anon and authenticated.
--   - n8n / scripts using the service_role key keep working (BYPASSRLS).
--   - Legacy WordPress avatar + seo-admin pages that call these tables with
--     the public anon key will stop working. Cut over to the NEW portal first.
--
-- How to apply:
--   1. Confirm WordPress DigitalTwin pages are redirected / unused.
--   2. Open OLD project → SQL Editor → paste this file → Run.
--   3. Security Advisor → Rerun linter.
--   4. Optionally rotate the OLD anon key (Settings → API).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.dt_seo_tasks') IS NOT NULL
     OR to_regclass('public.dt_org_config') IS NOT NULL THEN
    RAISE EXCEPTION
      'Aborting: this looks like NEW (dt_* tables exist). Run only on OLD.';
  END IF;

  IF to_regclass('public.seo_clients') IS NULL
     OR to_regclass('public.client_config') IS NULL THEN
    RAISE EXCEPTION
      'Aborting: expected legacy tables missing. Wrong project?';
  END IF;
END
$$;

ALTER TABLE public.archived_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_cache ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY on purpose: no anon/authenticated access.
-- service_role bypasses RLS and keeps n8n/admin access.

REVOKE ALL ON TABLE public.archived_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.website_content FROM anon, authenticated;
REVOKE ALL ON TABLE public.seo_tasks FROM anon, authenticated;
REVOKE ALL ON TABLE public.seo_clients FROM anon, authenticated;
REVOKE ALL ON TABLE public.client_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.seo_cache FROM anon, authenticated;

-- Uncomment after WordPress chat pages are fully decommissioned.
-- chat_messages / persona_prompts already have RLS, but may still have
-- permissive policies plus grants for the public anon key.
--
-- REVOKE ALL ON TABLE public.chat_messages FROM anon, authenticated;
-- REVOKE ALL ON TABLE public.persona_prompts FROM anon, authenticated;

COMMIT;
