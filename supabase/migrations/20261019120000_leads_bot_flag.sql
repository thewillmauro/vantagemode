-- Auto-flag likely bot leads as spam at insert time. NOT APPLIED YET. Will applies it
-- (supabase db push, so history records this file's version).
--
-- Why here: the public forms insert straight into public.leads through PostgREST, so the
-- database is the first server-side code that sees a submission. Flagging in a BEFORE INSERT
-- trigger means the row is already status 'spam' when the lead-alert trigger fires, and
-- lead-alert's sweep and nurture both skip status 'spam' (same PR). Rows are flagged, never
-- dropped: a false positive is fixed by setting the status back on /leads, and the next
-- daily lead-alert sweep then alerts it (alerted_at is still null).
--
-- Rules (private.lead_bot_reasons, tunable constants are marked TUNE). Any one rule flags.
--   name_mixed_case     a word in the name has 3+ places where a lowercase letter is directly
--                       followed by an uppercase one ("xQwErTy"). McKinsey, HubSpot, iRobot,
--                       eBay, DeVon, SalesForceIQ have at most 2.
--   name_consonant_run  6+ consonants in a row in the name (a e i o u y count as vowels).
--                       Krzysztof, Zbigniew, Schmidt, Nguyen top out at 4.
--   company_mixed_case, company_consonant_run   the same two rules on brand (or company)
--   gmail_dots          a gmail.com or googlemail.com address with 4+ dots in the part before
--                       the @ (and before any +tag). Gmail ignores dots, so bots spray them to
--                       reuse one inbox. first.last@ and j.r.smith@ have 1 and 2. Same
--                       threshold as the /leads dashboard's "dot-split gmail" signal.
-- Words are runs of ASCII letters, so hyphens, apostrophes, spaces and accented letters
-- split them (Mary-Jane O'Neil is three short words).
--
-- Which rules fired is stored in the new column bot_reasons (null when none fired), so a
-- flag is always explainable. The rules never change status unless it is 'new', and never
-- run for demo rows or Cal.com bookings (source 'booking', inserted by cal-webhook).
--
-- Order of BEFORE INSERT triggers (Postgres fires them by name):
--   leads_guard_public_insert (honeypot drop, forces status 'new' for anon), then
--   leads_suspected_bot (this file). A honeypot row is dropped before this one runs.
-- leads_suspected_bot runs for every insert role, and its function is SECURITY DEFINER so
-- anon can reach private.lead_bot_reasons without any grant on schema private.
--
-- To try the rules on existing rows without writing anything, run
--   node scripts/bot_flag_impact.mjs
-- which prints a read-only, counts-only SELECT built from the function body below.
-- This migration does not touch existing rows.

alter table public.leads
  add column if not exists bot_reasons text[];
alter table public.leads
  add constraint leads_bot_reasons_len check (bot_reasons is null or cardinality(bot_reasons) <= 10);

-- Pure function: same input, same answer. Returns an empty array when nothing fired.
create or replace function private.lead_bot_reasons(p_name text, p_company text, p_email text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when exists (
      select 1 from regexp_matches(coalesce(p_name, ''), '[A-Za-z]+', 'g') as m(w)
      where m.w[1] ~ '([a-z][A-Z][A-Za-z]*){3}'                                 -- TUNE: {3}
    ) then 'name_mixed_case' end,
    case when coalesce(p_name, '') ~* '[bcdfghjklmnpqrstvwxz]{6}'                -- TUNE: {6}
      then 'name_consonant_run' end,
    case when exists (
      select 1 from regexp_matches(coalesce(p_company, ''), '[A-Za-z]+', 'g') as m(w)
      where m.w[1] ~ '([a-z][A-Z][A-Za-z]*){3}'                                 -- TUNE: {3}
    ) then 'company_mixed_case' end,
    case when coalesce(p_company, '') ~* '[bcdfghjklmnpqrstvwxz]{6}'             -- TUNE: {6}
      then 'company_consonant_run' end,
    case when lower(split_part(btrim(coalesce(p_email, '')), '@', 2)) in ('gmail.com', 'googlemail.com')
      and length(split_part(split_part(lower(btrim(coalesce(p_email, ''))), '@', 1), '+', 1))
        - length(replace(split_part(split_part(lower(btrim(coalesce(p_email, ''))), '@', 1), '+', 1), '.', '')) >= 4  -- TUNE: 4
      then 'gmail_dots' end
  ], null)
$$;
revoke all on function private.lead_bot_reasons(text, text, text) from public, anon, authenticated;

create or replace function private.flag_suspected_bot_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reasons text[];
begin
  if new.is_demo or new.source = 'booking' then
    return new;
  end if;
  v_reasons := private.lead_bot_reasons(new.name, coalesce(new.brand, new.company), new.email);
  if cardinality(v_reasons) > 0 then
    new.bot_reasons := v_reasons;
    if new.status = 'new' then
      new.status := 'spam';
    end if;
  else
    new.bot_reasons := null;
  end if;
  return new;
end;
$$;
revoke all on function private.flag_suspected_bot_lead() from public, anon, authenticated;

drop trigger if exists leads_suspected_bot on public.leads;
create trigger leads_suspected_bot
before insert on public.leads
for each row execute function private.flag_suspected_bot_lead();

-- Instant alert: skip rows that arrive flagged. (lead-alert's sweep skips them too.)
drop trigger if exists leads_notify_new_lead on public.leads;
create trigger leads_notify_new_lead
after insert on public.leads
for each row
when (new.is_demo = false and new.status <> 'spam')
execute function private.notify_new_lead();

-- ROLLBACK (keeps the bot_reasons values unless you also drop the column):
--   drop trigger if exists leads_notify_new_lead on public.leads;
--   create trigger leads_notify_new_lead after insert on public.leads
--     for each row when (new.is_demo = false) execute function private.notify_new_lead();
--   drop trigger if exists leads_suspected_bot on public.leads;
--   drop function if exists private.flag_suspected_bot_lead();
--   drop function if exists private.lead_bot_reasons(text, text, text);
--   alter table public.leads drop constraint if exists leads_bot_reasons_len;
--   alter table public.leads drop column if exists bot_reasons;   -- loses which rule fired
-- Rows already flagged stay status 'spam' after a rollback; set them back on /leads.
