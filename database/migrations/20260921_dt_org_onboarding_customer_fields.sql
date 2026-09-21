-- Customer project contacts and free-text notes on onboarding records.

ALTER TABLE public.dt_org_onboarding
  ADD COLUMN IF NOT EXISTS customer_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS additional_info text;

DO $$ BEGIN
  ALTER TABLE public.dt_org_onboarding
    ADD CONSTRAINT dt_org_onboarding_customer_contacts_is_array
    CHECK (jsonb_typeof(customer_contacts) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.dt_org_onboarding.customer_contacts IS
  'Ansprechpartner des Kunden für das Projekt (Name, Funktion, E-Mail, Telefon).';

COMMENT ON COLUMN public.dt_org_onboarding.additional_info IS
  'Freitext: weitere Informationen, die der Kunde ergänzen möchte.';
