-- /leads v2, step 2 of 6: anon can insert only the form columns, and a trigger guards them.
-- NOT APPLIED YET. Requires step 1 (20261016100000_leads_v2_columns.sql).
--
-- Columns the public forms write (checked on main 2026-10-16):
--   index.html contact form   name, email, brand, service, timeline, message, source
--   index.html project wizard name, email, brand, service, timeline, budget, message, source
--   index.html SDR calculator name, email, service, message, source
--   index.html submitSOW      name, email, service, source (its markup is no longer on the page)
--   scorecard/, kpi-scoreboard/ name, email, brand, service, message, source
--   every form                hp (honeypot, only sent when a bot fills it)
-- Nothing writes company or project_type any more, so anon loses those too. Anon can no
-- longer set id, created_at, alerted_at (it could suppress alerts before), or any v2 column.
--
-- The forms insert with Prefer: return=minimal, so anon still needs no SELECT.

revoke insert, references, trigger on public.leads from anon;
grant insert (name, email, brand, service, timeline, budget, message, source, hp) on public.leads to anon;

-- BEFORE INSERT guard for public (anon) and signed-in (authenticated) callers. Service role
-- (cal-webhook, migrations) is not touched. SECURITY INVOKER on purpose: current_user is the
-- PostgREST role (anon) inside the function. Firing a trigger needs no EXECUTE privilege.
create or replace function private.guard_public_lead_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  -- Honeypot filled: drop the row silently. PostgREST still answers 201, so the bot learns nothing.
  if coalesce(btrim(new.hp), '') <> '' then
    return null;
  end if;
  if new.source = 'booking' then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  new.hp := null;
  new.status := 'new';
  new.notes := null;
  new.status_updated_at := null;
  new.is_demo := false;
  new.booking_uid := null;
  new.alerted_at := null;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.guard_public_lead_insert() from public, anon, authenticated;

drop trigger if exists leads_guard_public_insert on public.leads;
create trigger leads_guard_public_insert
before insert on public.leads
for each row execute function private.guard_public_lead_insert();

-- ROLLBACK (back to the 20261015120000 grants; anon keeps table-level INSERT):
--   drop trigger if exists leads_guard_public_insert on public.leads;
--   drop function if exists private.guard_public_lead_insert();
--   revoke insert (name, email, brand, service, timeline, budget, message, source, hp) on public.leads from anon;
--   grant insert, references, trigger on public.leads to anon;
