-- Alternative to hoster and SMTP credentials: the customer's IT contact.
-- The project team asks that person for the technical access itself.

ALTER TABLE public.dt_org_onboarding
  ADD COLUMN IF NOT EXISTS access_via_it boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS it_contact_name text,
  ADD COLUMN IF NOT EXISTS it_contact_company text,
  ADD COLUMN IF NOT EXISTS it_contact_email text,
  ADD COLUMN IF NOT EXISTS it_contact_phone text;

COMMENT ON COLUMN public.dt_org_onboarding.access_via_it IS
  'Kunde gibt statt Hoster- und SMTP-Zugangsdaten den IT-Kontakt an. Das Team fragt dort selbst nach.';

COMMENT ON COLUMN public.dt_org_onboarding.it_contact_name IS
  'Name der IT-Ansprechperson für Hoster und SMTP.';

COMMENT ON COLUMN public.dt_org_onboarding.it_contact_company IS
  'Firma der IT-Ansprechperson, optional.';

COMMENT ON COLUMN public.dt_org_onboarding.it_contact_email IS
  'E-Mail der IT-Ansprechperson.';

COMMENT ON COLUMN public.dt_org_onboarding.it_contact_phone IS
  'Telefon der IT-Ansprechperson.';
