-- /leads v2, step 6 of 6: seven demo personas so the dashboard has something to show.
-- Applied (in production history). Apply LAST: after steps 1 to 5 AND after the updated lead-alert and
-- nurture functions are deployed (both skip is_demo rows).
--
-- Every row is is_demo = true. The dashboard badges them "Demo", leaves them out of every
-- count, and hides them once a real lead exists (a toggle shows them again).
-- alerted_at is stamped so lead-alert never emails them, even before its redeploy.
-- Times are relative to when this runs. Emails use the reserved .example.com domain.
-- Idempotent: each persona is inserted only if no demo row with its email exists.
-- The booking row's message matches what supabase/functions/cal-webhook writes, with the
-- call set to the next Monday, 2:00 PM ET.

with call as (
  select date_trunc('week', now() at time zone 'America/New_York') + interval '7 days 14 hours' as t
),
p (name, email, brand, service, budget, timeline, message, source, status, notes, booking_uid, age, touched) as (
  values
  ('Tomas Lindqvist', 'tomas@quillstack.example.com', 'Quillstack', 'GTM Scorecard', null, null,
   $m$GTM Readiness Scorecard: 33/100 (Running on effort)
Data 25 · AI Agents 42 · RevOps 33
Weakest: Data
Top gaps: Buying signals are invisible; Leads arrive without context; Your target list goes stale
Report link: https://www.vantagemode.com/scorecard?r=220110111211111

Answers:
C1 How many people sell today? → 4 to 10
C2 How do most customers find you? → Both
C3 Which CRM do you use? → HubSpot
D1 When a new lead comes in, what do you know about them automatically? → Someone looks up the company by hand
D2 How current is your target account list? → Built once, rarely touched
D3 Do you track signs that an account is ready to buy, like hiring, funding, product usage, or site visits? → No
D4 How much do you trust your CRM data? → Lots of duplicates and old contacts
A1 How do reps research an account before reaching out? → By hand, 20 minutes or more each
A2 How are first outbound emails written? → Template plus first name
A3 What happens to what customers say on sales, support, and product calls? → Recorded but rarely used
A4 How does AI show up in your sales process? → Reps use chat tools on their own
R1 How fast does a new inbound lead hear from you? → Same day
R2 Do you know your pipeline numbers each week? → Only when someone asks
R3 How does a lead reach the right rep? → Someone assigns it by hand
R4 How much of a rep's week goes to actual selling? → Under a third$m$,
   'scorecard', 'new', 'Strong fit on paper, 33/100 and weakest on Data. Reply within the hour.', null,
   interval '2 hours', null::interval),

  ('Robertdox', 'robertdox@toprank.example.com', 'Top Rank Solutions', 'Not Sure Yet', null, 'ASAP (within 2 weeks)',
   $m$Hello vantagemode.com owner, I noticed your website is not ranking on first page of Google for important keywords. We provide guaranteed 1st page ranking and 300+ high DA backlinks at affordable price. Reply for price list. Regards$m$,
   'contact_form', 'spam', 'Bot. SEO pitch, caught for review.', null,
   interval '4 hours', interval '3 hours'),

  ('Renata Vasquez', 'renata@tallyforge.example.com', 'Tallyforge', 'Free Pipeline Teardown', null, null,
   '[Cal.com] Free Pipeline Teardown, ' || (select to_char(t, 'Dy Mon FMDD, FMHH12:MI AM') from call) || ' ET (30 min)' || chr(10) ||
   $m$What's breaking in your pipeline today? → We hired two SDRs in August and they book maybe 4 meetings a month each. They spend half the day building lists by hand in Sales Navigator, and nobody trusts the lead source field in HubSpot. The board wants 3x pipeline by Q2.$m$,
   'booking', 'booked', 'Teardown Monday. Two new SDRs, list building by hand. Pipeline Build candidate.', 'demo-booking-tallyforge',
   interval '1 day', interval '1 day'),

  ('', 'dmitri@relaypoint.example.com', null, 'SDR Calculator Breakdown', null, null,
   '[SDR calculator] 8 SDRs × $110K × 55% outbound × 70% automated = $338,800 a year (6,160 hours, 3.1 SDRs)',
   'sdr_calculator', 'contacted', 'Replied asking if this works on Salesforce. Sent two call times.', null,
   interval '5 days', interval '4 days'),

  ('Bea Thornton', 'bea@pocketledger.example.com', 'Pocketledger', 'KPI Scoreboard Template', null, null,
   'Downloaded the GTM KPI Scoreboard template.',
   'kpi_template', 'new', 'Too early. Solo founder, no reps until after a seed round. Nurture only.', null,
   interval '6 days', null),

  ('Gideon Marsh', 'gideon@hearthwick.example.com', 'Hearthwick Candle Co.', 'Single-Piece Build', 'Under $5K', 'ASAP',
   $m$Need someone to set up Klaviyo flows and fix our Shopify abandoned-cart emails before Black Friday. Small budget but we move fast.$m$,
   'project_wizard', 'lost', 'Not software, wants Klaviyo flows not GTM. Referred out.', null,
   interval '12 days', interval '11 days'),

  ('Owen Castellanos', 'owen@fernway.example.com', 'Fernway', 'Pipeline Teardown', '', '1-2 Weeks',
   $m$We just hired our first two AEs and founder-led sales doesn't hand off. Every deal lives in my inbox and a Notion table. I need a real pipeline before they ramp.$m$,
   'teardown', 'won', 'Teardown led to a signed GTM Audit, kickoff done. Pipeline Build is the next step.', null,
   interval '24 days', interval '10 days')
)
insert into public.leads
  (name, email, brand, service, budget, timeline, message, source, status, notes, booking_uid,
   is_demo, created_at, status_updated_at, alerted_at)
select name, email, brand, service, budget, timeline, message, source, status, notes, booking_uid,
       true, now() - age, case when touched is null then null else now() - touched end, now()
from p
where not exists (select 1 from public.leads l where l.is_demo and l.email = p.email);

-- ROLLBACK (removes only the demo rows; real leads have is_demo = false):
--   delete from public.leads where is_demo = true;
