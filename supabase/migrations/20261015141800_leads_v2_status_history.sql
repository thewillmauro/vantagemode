-- /leads v2, step 4 of 6: an append-only log of status changes. Applied (in production history).
-- Requires steps 1 and 3.
--
-- Written only by a SECURITY DEFINER trigger. RLS is on; Will can read it (the dashboard
-- does not show it yet), nobody else can read it, and no client role can write it.
-- changed_by is the auth user (Will) or null for service-role writes (cal-webhook).

create table if not exists public.lead_status_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists lead_status_history_lead_idx on public.lead_status_history (lead_id, changed_at);
alter table public.lead_status_history enable row level security;

revoke all on public.lead_status_history from anon, authenticated;
grant select on public.lead_status_history to authenticated;

create policy "Will reads lead status history"
  on public.lead_status_history
  for select
  to authenticated
  using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);

create or replace function private.log_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_status_history (lead_id, old_status, new_status, changed_by)
  values (new.id, old.status, new.status, auth.uid());
  return null;
end;
$$;
revoke all on function private.log_lead_status() from public, anon, authenticated;

drop trigger if exists leads_log_status on public.leads;
create trigger leads_log_status
after update of status on public.leads
for each row
when (old.status is distinct from new.status)
execute function private.log_lead_status();

-- ROLLBACK (drops the history):
--   drop trigger if exists leads_log_status on public.leads;
--   drop function if exists private.log_lead_status();
--   drop table if exists public.lead_status_history;
