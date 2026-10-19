-- Verwaltung → SEO: its own set of writing recipes („Textvorlagen“), independent of Texte.
-- A second row in dt_content_type_prompts (id = 'seo_tool') next to the agency row of Texte.
-- It starts as a copy of the Texte recipes as they are today; after that each tool saves
-- only its own row, so a change under Texte never changes the SEO tool and vice versa.
-- Without the row the SEO tool uses the defaults in lib/dt/content/type-prompts.ts.

-- The columns of the later Texte migrations, in case one of them was skipped.
ALTER TABLE public.dt_content_type_prompts
  ADD COLUMN IF NOT EXISTS startseite text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ueber_uns text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hauptseite text NOT NULL DEFAULT '';

ALTER TABLE public.dt_content_type_prompts DROP CONSTRAINT IF EXISTS dt_content_type_prompts_id_check;
ALTER TABLE public.dt_content_type_prompts
  ADD CONSTRAINT dt_content_type_prompts_id_check CHECK (id IN ('agency', 'seo_tool'));

INSERT INTO public.dt_content_type_prompts
  (id, hauptsilo, hauptseite, unterseite, ratgeber, standort, startseite, ueber_uns, updated_by, updated_by_email)
SELECT 'seo_tool', hauptsilo, hauptseite, unterseite, ratgeber, standort, startseite, ueber_uns, updated_by, updated_by_email
FROM public.dt_content_type_prompts
WHERE id = 'agency'
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.dt_content_type_prompts IS
  'Textvorlagen je Seitentyp (Hauptsilo-Seite, Hauptseite, Unterseite, Ratgeberartikel, Standortseite, Startseite, Über-uns-Seite). id = agency: SEO-Schritt von Texte. id = seo_tool: Werkzeug Verwaltung → SEO, unabhängig von Texte.';
