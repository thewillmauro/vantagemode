-- APPLY ONLY AFTER WILL ENROLLS TWO TOTP FACTORS (phone authenticator app + password manager)
-- on /leads > Security, and has signed in once with a code to prove both work.
--
-- Kept outside supabase/migrations on purpose so `supabase db push` can never apply it early.
-- If it is applied before Will has a verified factor, /leads shows no rows and every
-- status/notes save fails, because Will's session can only ever reach aal1.
--
-- Effect: Will's leads SELECT and UPDATE policies (and the status history SELECT) also
-- require the session to have passed MFA (aal2). A stolen password alone reads nothing.
--
-- Break glass (lost both factors): Supabase dashboard > Authentication > Users > will@ >
-- delete the MFA factors, then sign in and enroll again. If you cannot do that quickly,
-- apply the ROLLBACK at the bottom.

alter policy "Will reads leads"
  on public.leads
  to authenticated
  using (
    (select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

alter policy "Will updates leads"
  on public.leads
  to authenticated
  using (
    (select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    (select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

alter policy "Will reads lead status history"
  on public.lead_status_history
  to authenticated
  using (
    (select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- ROLLBACK (back to uid-only):
--   alter policy "Will reads leads" on public.leads to authenticated
--     using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);
--   alter policy "Will updates leads" on public.leads to authenticated
--     using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid)
--     with check ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);
--   alter policy "Will reads lead status history" on public.lead_status_history to authenticated
--     using ((select auth.uid()) = 'adc80ff8-93f9-4353-8d60-96dd924ea525'::uuid);
