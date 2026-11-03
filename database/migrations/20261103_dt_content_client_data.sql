-- Texte: client data – Kontaktdaten (with Google-Profil) and Kundenwünsche.
--
-- RUN THIS BEFORE DEPLOYING THE CODE, once, in the Supabase SQL Editor. The new code reads
-- dt_org_contact_data, dt_content_settings.client_wishes and dt_content_pages.client_wishes
-- for every Texte step; without them Texte shows a message naming this file
-- (contentDbErrorMessage) and no page runs. The Firmenprofil keeps working without it, but
-- its new card „Kontaktdaten“ shows the same message instead of the fields.
--
-- What it does:
--   1. dt_org_contact_data: the public contact data of an organisation, ONE row per
--      organisation, next to the Firmenprofil (dt_org_config, dt_org_onboarding). Texte and
--      the Firmenprofil read and write the same row. Firmenname, Website and Ansprechpartner
--      are not duplicated: they stay in dt_org_config.display_name, dt_org_config.website_url
--      and the first entry of dt_org_onboarding.customer_contacts; this row only keeps their
--      source (crawl, websuche, manuell, antwort) next to the new fields.
--        fields          { key: { value, source, updated_at } } per field
--        custom_fields   [{ label, value, source, updated_at }] („+ Feld hinzufügen“)
--        no_google_profile  „Kein Google-Profil“
--        google_search   the last web search for the Google-Profil (once per organisation)
--        crawl_fill      the last fill from the crawled website (when, which fields, cost)
--      Manual values always win: the crawl and the web search never overwrite a field whose
--      source is „manuell“ or „antwort“. Changes go into dt_company_profile_edits as before.
--   2. dt_content_settings.client_wishes: „Kundenwünsche“ of the organisation, one per line.
--   3. dt_content_pages.client_wishes: „Zusätzliche Wünsche für diese Seite“, one per line.
--      „Zurücksetzen“ of a page keeps them (like page_type and skip_steps).
--
-- Idempotent: tables, columns and policies are created only once / dropped and created again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dt_org_contact_data (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  no_google_profile boolean NOT NULL DEFAULT false,
  google_search jsonb,
  crawl_fill jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dt_org_contact_data_fields_object CHECK (jsonb_typeof(fields) = 'object'),
  CONSTRAINT dt_org_contact_data_custom_array CHECK (jsonb_typeof(custom_fields) = 'array')
);

COMMENT ON TABLE public.dt_org_contact_data IS
  'Öffentliche Kontaktdaten einer Organisation (Adresse, Telefon, E-Mail, Öffnungszeiten, Google-Profil, Social Links, freie Felder). Eine Zeile pro Organisation, geteilt von Firmenprofil und Texte. Firmenname, Website und Ansprechpartner stehen weiter in dt_org_config / dt_org_onboarding; hier nur ihre Quelle. Manuelle Werte gewinnen immer.';

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_dt_org_contact_data
    BEFORE UPDATE ON public.dt_org_contact_data
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.dt_org_contact_data ENABLE ROW LEVEL SECURITY;

-- Same audience as dt_org_config: members read, owners/admins and platform admins write.
-- Texte and the background jobs use the service client.
DROP POLICY IF EXISTS "dt_org_contact_data_select_member" ON public.dt_org_contact_data;
CREATE POLICY "dt_org_contact_data_select_member"
ON public.dt_org_contact_data FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_org_member(organisation_id, auth.uid())
);

DROP POLICY IF EXISTS "dt_org_contact_data_insert_admin" ON public.dt_org_contact_data;
CREATE POLICY "dt_org_contact_data_insert_admin"
ON public.dt_org_contact_data FOR INSERT
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
  OR EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = dt_org_contact_data.organisation_id
      AND o.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "dt_org_contact_data_update_admin" ON public.dt_org_contact_data;
CREATE POLICY "dt_org_contact_data_update_admin"
ON public.dt_org_contact_data FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
  OR EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = dt_org_contact_data.organisation_id
      AND o.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR public.my_org_role(organisation_id) IN ('owner', 'admin')
  OR EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = dt_org_contact_data.organisation_id
      AND o.owner_user_id = auth.uid()
  )
);

ALTER TABLE public.dt_content_settings
  ADD COLUMN IF NOT EXISTS client_wishes text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dt_content_settings.client_wishes IS
  'Kundenwünsche für alle Texte der Organisation, ein Wunsch pro Zeile. Verbindlich für jeden Schritt, der Text schreibt; gehen dem Texter-Prompt und den Textvorlagen vor, nie den Fakten-Regeln, der Anrede, den verbotenen Wörtern und der Branchenregel.';

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS client_wishes text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dt_content_pages.client_wishes IS
  'Zusätzliche Wünsche des Kunden nur für diese Seite, ein Wunsch pro Zeile. Gilt ab dem nächsten Schritt, der läuft. „Zurücksetzen“ behält sie.';

COMMIT;
