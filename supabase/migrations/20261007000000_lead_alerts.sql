-- New-lead alerts: every insert into public.leads calls the lead-alert Edge Function,
-- which emails the lead and stamps alerted_at. Applied to project tnkqxniwjomkojufuxlp
-- on 2026-10-07.
create extension if not exists pg_net with schema extensions;
alter table public.leads add column if not exists alerted_at timestamptz;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Runs as the table owner so anon inserts can queue the HTTP call; lives in a
-- non-exposed schema and swallows errors so a failed alert never blocks a lead.
create or replace function private.notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform net.http_post(
      url := 'https://tnkqxniwjomkojufuxlp.supabase.co/functions/v1/lead-alert',
      body := jsonb_build_object('lead_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise log 'lead-alert trigger failed: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.notify_new_lead() from public, anon, authenticated;

drop trigger if exists leads_notify_new_lead on public.leads;
create trigger leads_notify_new_lead
after insert on public.leads
for each row execute function private.notify_new_lead();
