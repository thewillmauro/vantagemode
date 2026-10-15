-- Follow-up email sequence for /scorecard and /kpi-scoreboard leads.
-- The nurture Edge Function records each email it sends here and reads unsubscribes.
-- Neither table has policies, so only the service role (the function) can touch them.
-- Applied to project tnkqxniwjomkojufuxlp on 2026-10-14.
create table if not exists public.nurture_sends (
  lead_id uuid not null references public.leads(id) on delete cascade,
  step smallint not null check (step between 0 and 4),
  sent_at timestamptz not null default now(),
  resend_id text,
  primary key (lead_id, step)
);
alter table public.nurture_sends enable row level security;

create table if not exists public.nurture_unsubscribes (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.nurture_unsubscribes enable row level security;

-- Hourly run. The function sends nothing until its secrets are set (see its header).
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule('nurture-hourly') where exists (select 1 from cron.job where jobname = 'nurture-hourly');
select cron.schedule(
  'nurture-hourly',
  '7 * * * *',
  $$select net.http_post(
      url := 'https://tnkqxniwjomkojufuxlp.supabase.co/functions/v1/nurture',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 60000
    )$$
);
