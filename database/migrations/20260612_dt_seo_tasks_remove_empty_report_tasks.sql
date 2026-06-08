-- Remove auto-generated report tasks that had no Maßnahme (keyword-only placeholders).
DELETE FROM public.dt_seo_tasks
WHERE report_id IS NOT NULL
  AND (action IS NULL OR btrim(action) = '');
