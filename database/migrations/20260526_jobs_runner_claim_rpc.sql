-- Atomic job claim. Returns up to p_batch pending jobs whose run_after has passed,
-- atomically marking them as running for the given worker.

create or replace function public.claim_due_jobs(
  p_batch integer,
  p_worker text,
  p_now timestamptz
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  with picked as (
    select id
    from public.jobs
    where status = 'pending'
      and run_after <= p_now
    order by run_after asc
    limit greatest(1, p_batch)
    for update skip locked
  )
  update public.jobs j
  set status = 'running',
      locked_at = p_now,
      locked_by = p_worker,
      started_at = coalesce(j.started_at, p_now)
  from picked
  where j.id = picked.id
  returning j.*;
end;
$fn$;

revoke all on function public.claim_due_jobs(integer, text, timestamptz) from public, anon, authenticated;
