-- Normalized leads from Leadinfo (and future providers reusing the same shape).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  domain text not null,
  name text,
  industry text,
  size_range text,
  country text,
  region text,
  city text,
  source text not null default 'leadinfo',
  agent_status text not null check (agent_status in ('active', 'paused', 'handed_off', 'blocked')) default 'active',
  channel_preference text not null check (channel_preference in ('email', 'linkedin', 'any')) default 'any',
  approval_mode_override text check (approval_mode_override in ('always', 'first_message_only', 'never')),
  first_seen_at timestamptz not null default timezone('utc'::text, now()),
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  visit_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (organisation_id, domain)
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  raw_event_id uuid references public.integration_raw_events(id) on delete set null,
  source text not null default 'leadinfo',
  visited_at timestamptz not null default timezone('utc'::text, now()),
  pages jsonb not null default '[]'::jsonb,
  duration_s integer,
  referrer text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'leadinfo' check (source in ('leadinfo', 'apollo', 'manual')),
  full_name text,
  first_name text,
  last_name text,
  title text,
  seniority text,
  email text,
  email_verified boolean not null default false,
  linkedin_url text,
  phone text,
  score integer,
  is_primary boolean not null default false,
  do_not_contact boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Track which raw events have already been normalized.
alter table public.integration_raw_events
  add column if not exists processed_at timestamptz;

create index if not exists integration_raw_events_unprocessed_idx
  on public.integration_raw_events(received_at desc)
  where processed_at is null;

-- Triggers (handle_updated_at exists in the base schema).
do $$ begin
  create trigger set_updated_at_companies
    before update on public.companies
    for each row
    execute function public.handle_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger set_updated_at_contacts
    before update on public.contacts
    for each row
    execute function public.handle_updated_at();
exception when duplicate_object then null; end $$;

-- Indexes
create index if not exists companies_organisation_id_idx on public.companies(organisation_id);
create index if not exists companies_last_seen_idx on public.companies(organisation_id, last_seen_at desc);
create index if not exists companies_status_idx on public.companies(organisation_id, agent_status);

create index if not exists visits_company_id_idx on public.visits(company_id);
create index if not exists visits_organisation_visited_at_idx on public.visits(organisation_id, visited_at desc);
create index if not exists visits_raw_event_id_idx on public.visits(raw_event_id);

create index if not exists contacts_company_id_idx on public.contacts(company_id);
create index if not exists contacts_organisation_id_idx on public.contacts(organisation_id);
create index if not exists contacts_email_idx on public.contacts(organisation_id, email) where email is not null;

-- Only one primary contact per company.
create unique index if not exists contacts_primary_per_company_idx
  on public.contacts(company_id)
  where is_primary;

-- One row per (org, company, email) when email is present (allow multiple null-email contacts).
create unique index if not exists contacts_email_unique_idx
  on public.contacts(organisation_id, company_id, email)
  where email is not null;

-- RLS
alter table public.companies enable row level security;
alter table public.visits enable row level security;
alter table public.contacts enable row level security;

-- Companies
drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member"
on public.companies for select
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) is not null
);

drop policy if exists "companies_insert_admin" on public.companies;
create policy "companies_insert_admin"
on public.companies for insert
with check (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
);

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin"
on public.companies for update
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
)
with check (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
);

drop policy if exists "companies_delete_admin" on public.companies;
create policy "companies_delete_admin"
on public.companies for delete
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
);

-- Visits
drop policy if exists "visits_select_member" on public.visits;
create policy "visits_select_member"
on public.visits for select
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) is not null
);

drop policy if exists "visits_admin_write" on public.visits;
create policy "visits_admin_write"
on public.visits for all
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
)
with check (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
);

-- Contacts
drop policy if exists "contacts_select_member" on public.contacts;
create policy "contacts_select_member"
on public.contacts for select
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) is not null
);

drop policy if exists "contacts_admin_write" on public.contacts;
create policy "contacts_admin_write"
on public.contacts for all
using (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
)
with check (
  public.is_platform_admin(auth.uid())
  or public.my_org_role(organisation_id) in ('owner', 'admin')
);
