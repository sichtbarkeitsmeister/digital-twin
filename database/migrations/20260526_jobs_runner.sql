-- In-house background jobs runner.
-- Postgres queue + pg_cron tick + pg_net call to the Next.js worker route.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Centralised in-DB configuration. Read by Postgres functions (cron tick).
-- Service role only; no RLS policies are defined intentionally.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.app_settings enable row level security;

do $$ begin
  create trigger set_updated_at_app_settings
    before update on public.app_settings
    for each row
    execute function public.handle_updated_at();
exception when duplicate_object then null; end $$;

-- Job queue.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete set null,
  kind text not null,
  status text not null check (status in ('pending','running','succeeded','failed','dead')) default 'pending',
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  run_after timestamptz not null default timezone('utc'::text, now()),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  result jsonb,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

do $$ begin
  create trigger set_updated_at_jobs
    before update on public.jobs
    for each row
    execute function public.handle_updated_at();
exception when duplicate_object then null; end $$;

create index if not exists jobs_status_run_after_idx
  on public.jobs(status, run_after)
  where status in ('pending', 'running');

create index if not exists jobs_kind_status_idx on public.jobs(kind, status);
create index if not exists jobs_organisation_id_idx on public.jobs(organisation_id);
create index if not exists jobs_created_at_idx on public.jobs(created_at desc);

-- Prevent duplicates with the same dedupe_key while a previous one is in flight.
create unique index if not exists jobs_dedupe_active_idx
  on public.jobs(kind, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

alter table public.jobs enable row level security;

-- Read access for org admins; writes are service-role only.
drop policy if exists "jobs_select_admin" on public.jobs;
create policy "jobs_select_admin"
on public.jobs
for select
using (
  public.is_platform_admin(auth.uid())
  or (
    organisation_id is not null
    and public.my_org_role(organisation_id) in ('owner', 'admin')
  )
);

-- Cron tick: invoked every 30s by pg_cron, calls the Next.js worker.
-- If app_settings rows are missing, the tick is a no-op so the migration is safe to apply
-- before deployment is finished.
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
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function public.jobs_cron_tick() from public, anon, authenticated;

-- (Re)schedule the cron tick. pg_cron 1.6+ supports sub-minute schedules.
do $$
declare
  existing_job_id integer;
begin
  select jobid into existing_job_id from cron.job where jobname = 'jobs_runner_tick_30s';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
  perform cron.schedule(
    'jobs_runner_tick_30s',
    '30 seconds',
    $cron$ select public.jobs_cron_tick(); $cron$
  );
end $$;
