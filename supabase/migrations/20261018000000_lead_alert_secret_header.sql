-- lead-alert shared secret: the leads insert trigger sends x-lead-alert-secret, read from
-- Supabase Vault (secret name 'lead_alert_secret'). NOT APPLIED YET. Will applies it.
--
-- Order (see the PR): create the Vault secret first, then apply this, then deploy the
-- lead-alert version that checks the header. The deployed function before that ignores
-- headers, so applying this early changes nothing for alerts.
--
-- If the Vault secret is missing, the trigger still calls lead-alert, without the header,
-- and logs a warning. Before the checking function is deployed that call still works; after,
-- it gets a 401 and the lead stays unalerted (alerted_at null) until the daily keep-alive
-- sweep, which is the same outcome as skipping the call. A failed alert never blocks the
-- insert. The secret value is never in this file or in git.
--
-- Changes only the function body. The trigger itself (leads_notify_new_lead, AFTER INSERT,
-- WHEN new.is_demo = false, from 20261015141802_leads_v2_alert_skip_demo) is untouched.
-- Vault is available: supabase_vault 0.3.1, vault.decrypted_secrets readable by postgres
-- (this function's owner, SECURITY DEFINER) and not by anon or authenticated (checked
-- read-only on 2026-10-18).
--
-- Note: pg_net keeps each queued request, headers included (so this secret), in
-- net.http_request_queue until its worker sends it. pg_net's tables are granted SELECT to
-- PUBLIC by supabase_admin, and that grant can't be revoked per project (Supabase
-- troubleshooting: "Revoking access to pg_net objects has no effect"). So ANY database role
-- that can log in can read queued requests until they are sent. Today the only login roles
-- are Supabase's built-ins: authenticator, pgbouncer, postgres and the supabase_* service
-- roles (verified read-only 2026-10-18). Never expose the net schema through the API, never
-- create an extra login role without considering this, and rotate the lead-alert secret if
-- any database login is exposed.

create or replace function private.notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_headers jsonb := '{"Content-Type": "application/json"}'::jsonb;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'lead_alert_secret'
     limit 1;
    if v_secret is null or v_secret = '' then
      raise warning 'lead-alert trigger: Vault secret lead_alert_secret is missing; calling without it';
    else
      v_headers := v_headers || jsonb_build_object('x-lead-alert-secret', v_secret);
    end if;

    perform net.http_post(
      url := 'https://tnkqxniwjomkojufuxlp.supabase.co/functions/v1/lead-alert',
      body := jsonb_build_object('lead_id', new.id),
      headers := v_headers,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise log 'lead-alert trigger failed: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.notify_new_lead() from public, anon, authenticated;

-- ROLLBACK (production's definition as of 2026-10-18, applied 2026-10-07 outside migration history):
--   create or replace function private.notify_new_lead()
--   returns trigger language plpgsql security definer set search_path = '' as $f$
--   begin
--     begin
--       perform net.http_post(
--         url := 'https://tnkqxniwjomkojufuxlp.supabase.co/functions/v1/lead-alert',
--         body := jsonb_build_object('lead_id', new.id),
--         headers := '{"Content-Type": "application/json"}'::jsonb,
--         timeout_milliseconds := 10000
--       );
--     exception when others then
--       raise log 'lead-alert trigger failed: %', sqlerrm;
--     end;
--     return new;
--   end;
--   $f$;
--   Roll back only together with a lead-alert deploy that no longer checks the header,
--   or every trigger call is rejected.
