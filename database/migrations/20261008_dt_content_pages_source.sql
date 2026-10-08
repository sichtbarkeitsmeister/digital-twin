-- Texte: where a page row came from. „Seiten“ has two sources now — the uploaded
-- Seitenstruktur (Excel template, dt_website_structures) or the crawl of the existing
-- website (dt_site_pages). The typed page list („Seiten eintragen“) is gone.

ALTER TABLE public.dt_content_pages
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'structure'
    CHECK (source IN ('structure', 'crawl')),
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS crawled_at timestamptz;

COMMENT ON COLUMN public.dt_content_pages.source IS
  'structure = aus der hochgeladenen Seitenstruktur, crawl = aus dem Crawl der bestehenden Website übernommen.';
COMMENT ON COLUMN public.dt_content_pages.source_url IS
  'Live-URL der Seite (Crawl). Der bisherige Seitentext aus dt_site_pages fließt als Orientierung in die Schritte ein.';
COMMENT ON COLUMN public.dt_content_pages.crawled_at IS
  'crawled_at der dt_site_pages-Zeile beim letzten Übernehmen aus dem Crawl.';

CREATE INDEX IF NOT EXISTS dt_content_pages_org_source_idx
  ON public.dt_content_pages (organisation_id, source);
