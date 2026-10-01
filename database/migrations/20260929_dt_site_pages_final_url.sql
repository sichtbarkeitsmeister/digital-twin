-- Landed URL after redirects, so the crawl viewer can label
-- "Seite mit Weiterleitung" the same way GSC Coverage does.
ALTER TABLE public.dt_site_pages
  ADD COLUMN IF NOT EXISTS final_url text;

COMMENT ON COLUMN public.dt_site_pages.final_url IS
  'URL after following redirects during crawl; equal to url when there was no redirect';
