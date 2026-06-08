-- Per-org Google Analytics / Search Console OAuth account routing (legacy seo_clients.ga4_account / gsc_account)

ALTER TABLE public.dt_org_config
  ADD COLUMN IF NOT EXISTS ga4_account text,
  ADD COLUMN IF NOT EXISTS gsc_account text;

COMMENT ON COLUMN public.dt_org_config.ga4_account IS
  'Legacy seo_clients.ga4_account — n8n If node compares to ads@sichtbarkeitsmeister.de';
COMMENT ON COLUMN public.dt_org_config.gsc_account IS
  'Legacy seo_clients.gsc_account — empty/null routes to ads2@ GSC credential in n8n';

-- Backfill from OLD seo_clients mapping (by organisations.slug)
UPDATE public.dt_org_config AS c
SET
  ga4_account = m.ga4_account,
  gsc_account = m.gsc_account
FROM public.organisations AS o
JOIN (
  VALUES
    ('allround', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('arctictub', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('dr-muster', 'ads@sichtbarkeitsmeister.de', NULL),
    ('droste', 'ads', NULL),
    ('finedent-duesseldorf', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('gasanov', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('hemmersbach-druck', 'ads2@sichtbarkeitsmeister.de', 'ads2@sichtbarkeitsmeister.de'),
    ('intensivpflege-ayags', 'ads', NULL),
    ('naturheilpraxis-weber', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('online-media-atelier', 'ads2@sichtbarkeitsmeister.de', 'ads2@sichtbarkeitsmeister.de'),
    ('roggendorf', 'ads2@sichtbarkeitsmeister.de', 'ads2@sichtbarkeitsmeister.de'),
    ('schoepker', 'ads2@sichtbarkeitsmeister.de', NULL),
    ('sichtbarkeitsmeister', 'ads@sichtbarkeitsmeister.de', 'ads@sichtbarkeitsmeister.de'),
    ('steiner-umzuege', 'ads', NULL)
) AS m(slug, ga4_account, gsc_account) ON m.slug = o.slug
WHERE c.organisation_id = o.id;
