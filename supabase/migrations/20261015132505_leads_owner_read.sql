-- /leads dashboard: only Will's auth user can read leads. Applied (in production history).
--
-- Will's auth user (will@vantagemode.com) id is filled in below. Created 2026-10-15.
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
  using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);

revoke select, update, delete, truncate on public.leads from anon;
revoke insert, update, delete, truncate, references, trigger on public.leads from authenticated;
grant select on public.leads to authenticated;

-- ROLLBACK (restores the pre-migration state captured on 2026-10-15):
--   drop policy if exists "Will reads leads" on public.leads;
--   grant select, update, delete, truncate on public.leads to anon;
--   grant insert, update, delete, truncate, references, trigger on public.leads to authenticated;
