-- /leads v2, step 5 of 6: demo rows never call lead-alert. Applied (in production history). Requires step 1.
--
-- Bookings (source 'booking', inserted by cal-webhook) still alert Will on purpose.
-- The lead-alert function also sweeps unalerted rows, so it now filters is_demo=false
-- itself (redeploy lead-alert before step 6), and the seed stamps alerted_at as well.

drop trigger if exists leads_notify_new_lead on public.leads;
create trigger leads_notify_new_lead
after insert on public.leads
for each row
when (new.is_demo = false)
execute function private.notify_new_lead();

-- ROLLBACK (the 20261007000000 definition):
--   drop trigger if exists leads_notify_new_lead on public.leads;
--   create trigger leads_notify_new_lead after insert on public.leads
--     for each row execute function private.notify_new_lead();
