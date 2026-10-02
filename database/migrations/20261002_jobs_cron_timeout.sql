-- Crawl chunks need more than 25s (pg_net used to abort /api/jobs/run
-- while URLs stayed in `processing` and the crawl never finished).
create or replace function public.jobs_cron_tick()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  base_url text;
  token text;
begin
  select value into base_url from public.app_settings where key = 'app_base_url';
  select value into token from public.app_settings where key = 'jobs_worker_token';

  if base_url is null or token is null or base_url = '' or token = '' then
    return;
  end if;

  perform net.http_post(
    url := base_url || '/api/jobs/run',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Content-Type', 'application/json'
    ),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
