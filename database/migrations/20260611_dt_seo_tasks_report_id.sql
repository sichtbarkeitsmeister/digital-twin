-- Link SEO tasks to reports and prevent duplicate auto-creation on webhook retries.

ALTER TABLE public.dt_seo_tasks
  ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES public.dt_seo_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dt_seo_tasks_report_id_idx ON public.dt_seo_tasks(report_id);

CREATE UNIQUE INDEX IF NOT EXISTS dt_seo_tasks_report_title_uniq
  ON public.dt_seo_tasks (report_id, title)
  WHERE report_id IS NOT NULL;

-- Remove duplicate tasks (keep oldest per org + title).
DELETE FROM public.dt_seo_tasks dup
WHERE dup.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organisation_id, title
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.dt_seo_tasks
  ) ranked
  WHERE rn > 1
);

-- Backfill report_id for tasks created around a completed report run.
UPDATE public.dt_seo_tasks t
SET report_id = match.report_id
FROM (
  SELECT
    t2.id AS task_id,
    (
      SELECT rep.id
      FROM public.dt_seo_reports rep
      WHERE rep.organisation_id = t2.organisation_id
        AND rep.state = 'done'
        AND rep.finished_at IS NOT NULL
        AND t2.created_at >= rep.finished_at - interval '2 hours'
        AND t2.created_at <= rep.finished_at + interval '30 minutes'
      ORDER BY rep.finished_at DESC
      LIMIT 1
    ) AS report_id
  FROM public.dt_seo_tasks t2
  WHERE t2.report_id IS NULL
) match
WHERE t.id = match.task_id
  AND match.report_id IS NOT NULL;
