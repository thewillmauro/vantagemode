-- /leads dashboard: only Will's auth user can read leads. NOT APPLIED YET.
--
-- Before applying: create Will's user in Supabase Auth (dashboard), then replace
-- <WILL_USER_UUID> below with its id. As written, the placeholder is not a valid uuid,
-- so this migration fails instead of applying a policy that matches nobody.
--
-- Effect:
--   * authenticated users can select only when auth.uid() is Will's id (RLS policy).
--   * anon keeps INSERT (public forms, via "Allow anonymous inserts on leads") and loses
--     SELECT/UPDATE/DELETE/TRUNCATE. It never had a select/update/delete policy, so this
--     is defense in depth, not a behavior change for the forms (they insert without
--     returning rows).
--   * authenticated keeps only SELECT.
--   * service_role (lead-alert, nurture) and the security-definer trigger are unaffected.

create policy "Will reads leads"
  on public.leads
  for select
  to authenticated
  using ((select auth.uid()) = '<WILL_USER_UUID>'::uuid);

revoke select, update, delete, truncate on public.leads from anon;
revoke insert, update, delete, truncate, references, trigger on public.leads from authenticated;
grant select on public.leads to authenticated;

-- ROLLBACK (restores the pre-migration state captured on 2026-10-15):
--   drop policy if exists "Will reads leads" on public.leads;
--   grant select, update, delete, truncate on public.leads to anon;
--   grant insert, update, delete, truncate, references, trigger on public.leads to authenticated;
