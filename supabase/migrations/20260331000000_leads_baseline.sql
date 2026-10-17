-- BASELINE: public.leads and its anon-insert policy, captured from production
-- (project tnkqxniwjomkojufuxlp) via catalog queries on 2026-10-15. The table was
-- created by remote migrations 20260331044531 create_leads_and_projects_tables and
-- 20260331123349 update_leads_columns, which were never committed to this repo.
-- Idempotent: on production this is a no-op. Only the leads table is captured here.
--
-- Production grants at capture time were the Supabase defaults (anon and authenticated
-- had every table privilege; RLS decides what they can actually do).
-- 20261015132505_leads_owner_read.sql tightens those grants.

create table if not exists public.leads (
  id uuid not null default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  project_type text,
  budget text,
  message text,
  source text default 'website'::text,
  created_at timestamptz default now(),
  service text,
  brand text,
  timeline text,
  -- also added by 20261007000000_lead_alerts.sql (add column if not exists)
  alerted_at timestamptz,
  constraint leads_pkey primary key (id)
);

alter table public.leads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads' and policyname = 'Allow anonymous inserts on leads'
  ) then
    create policy "Allow anonymous inserts on leads"
      on public.leads
      as permissive
      for insert
      to anon
      with check (true);
  end if;
end
$$;
