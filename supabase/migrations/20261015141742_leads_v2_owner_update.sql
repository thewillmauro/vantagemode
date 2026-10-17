-- /leads v2, step 3 of 6: Will can update status and notes, nothing else. Applied (in production history).
-- Requires step 1. Will's auth user id matches 20261015120000_leads_owner_read.sql.
--
-- Effect:
--   * authenticated gets UPDATE on (status, notes) only; the RLS policy limits it to Will's rows
--     (all rows) and pins the new row to Will too.
--   * status_updated_at is stamped by a trigger whenever status changes, for every writer
--     (Will via the dashboard, cal-webhook via the service role). Clients cannot write it:
--     they have no column grant, and the trigger overwrites it anyway.

create policy "Will updates leads"
  on public.leads
  for update
  to authenticated
  using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid)
  with check ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);

grant update (status, notes) on public.leads to authenticated;

create or replace function private.stamp_lead_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
  else
    new.status_updated_at := old.status_updated_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_lead_status() from public, anon, authenticated;

drop trigger if exists leads_stamp_status on public.leads;
create trigger leads_stamp_status
before update on public.leads
for each row execute function private.stamp_lead_status();

-- ROLLBACK:
--   drop trigger if exists leads_stamp_status on public.leads;
--   drop function if exists private.stamp_lead_status();
--   revoke update (status, notes) on public.leads from authenticated;
--   drop policy if exists "Will updates leads" on public.leads;
