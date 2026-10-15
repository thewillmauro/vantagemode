-- /leads v2, step 1 of 6: pipeline columns and sanity CHECKs on form columns. NOT APPLIED YET.
-- Apply in order: 20261016100000 .. 20261016100500. The MFA policy change lives in
-- supabase/manual/ and is applied separately, only after Will enrolls two TOTP factors.
--
-- New columns:
--   status            new | contacted | booked | won | lost | spam (Will sets it on /leads)
--   notes             Will's private notes, max 5000 characters
--   status_updated_at set by a trigger when status changes (step 3); never written by clients
--   is_demo           demo personas for the dashboard; skipped by lead-alert and nurture
--   booking_uid       Cal.com booking uid, unique, written only by the cal-webhook function
--   hp                honeypot; a filled value makes the anon insert trigger drop the row (step 2)
--
-- Form column CHECKs are generous upper bounds, far above anything the site forms send
-- (the longest real value is a scorecard summary, about 2,500 characters). They are added
-- NOT VALID so existing rows are not re-checked at apply time. Postgres still checks a
-- NOT VALID constraint when an existing row is UPDATEd, so run this preflight first; it
-- returns counts only, no lead data. Every count should be 0:
--
--   select count(*) filter (where length(name) > 200) as name,
--          count(*) filter (where length(email) > 320 or email !~ '^[^[:space:]@]+@[^[:space:]@]+$') as email,
--          count(*) filter (where length(brand) > 300 or length(company) > 300) as brand,
--          count(*) filter (where length(service) > 200 or length(project_type) > 200) as service,
--          count(*) filter (where length(budget) > 100 or length(timeline) > 100) as budget_timeline,
--          count(*) filter (where length(message) > 20000) as message,
--          count(*) filter (where source !~ '^[a-z][a-z0-9_]{0,39}$') as source
--   from public.leads;
--
-- If all are 0 you can also run the VALIDATE statements at the bottom (optional).

alter table public.leads
  add column if not exists status text not null default 'new',
  add column if not exists notes text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists is_demo boolean not null default false,
  add column if not exists booking_uid text,
  add column if not exists hp text;

alter table public.leads
  add constraint leads_status_check check (status in ('new', 'contacted', 'booked', 'won', 'lost', 'spam')),
  add constraint leads_notes_len check (notes is null or length(notes) <= 5000),
  add constraint leads_booking_uid_key unique (booking_uid),
  add constraint leads_booking_uid_len check (booking_uid is null or length(booking_uid) between 1 and 200),
  add constraint leads_hp_len check (hp is null or length(hp) <= 500);

alter table public.leads
  add constraint leads_name_len check (length(name) <= 200) not valid,
  add constraint leads_email_fmt check (length(email) <= 320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$') not valid,
  add constraint leads_brand_len check (brand is null or length(brand) <= 300) not valid,
  add constraint leads_company_len check (company is null or length(company) <= 300) not valid,
  add constraint leads_service_len check (service is null or length(service) <= 200) not valid,
  add constraint leads_project_type_len check (project_type is null or length(project_type) <= 200) not valid,
  add constraint leads_budget_len check (budget is null or length(budget) <= 100) not valid,
  add constraint leads_timeline_len check (timeline is null or length(timeline) <= 100) not valid,
  add constraint leads_message_len check (message is null or length(message) <= 20000) not valid,
  add constraint leads_source_fmt check (source is null or source ~ '^[a-z][a-z0-9_]{0,39}$') not valid;

-- Dashboard filters and the webhook's email lookup.
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_email_lower_idx on public.leads (lower(email));

-- Optional, only if the preflight counts were all 0:
--   alter table public.leads validate constraint leads_name_len;
--   alter table public.leads validate constraint leads_email_fmt;
--   alter table public.leads validate constraint leads_brand_len;
--   alter table public.leads validate constraint leads_company_len;
--   alter table public.leads validate constraint leads_service_len;
--   alter table public.leads validate constraint leads_project_type_len;
--   alter table public.leads validate constraint leads_budget_len;
--   alter table public.leads validate constraint leads_timeline_len;
--   alter table public.leads validate constraint leads_message_len;
--   alter table public.leads validate constraint leads_source_fmt;

-- ROLLBACK (drops the v2 columns and their data; roll back steps 6 to 2 first):
--   drop index if exists public.leads_status_idx;
--   drop index if exists public.leads_email_lower_idx;
--   alter table public.leads
--     drop constraint if exists leads_name_len, drop constraint if exists leads_email_fmt,
--     drop constraint if exists leads_brand_len, drop constraint if exists leads_company_len,
--     drop constraint if exists leads_service_len, drop constraint if exists leads_project_type_len,
--     drop constraint if exists leads_budget_len, drop constraint if exists leads_timeline_len,
--     drop constraint if exists leads_message_len, drop constraint if exists leads_source_fmt;
--   alter table public.leads
--     drop column if exists status, drop column if exists notes, drop column if exists status_updated_at,
--     drop column if exists is_demo, drop column if exists booking_uid, drop column if exists hp;
