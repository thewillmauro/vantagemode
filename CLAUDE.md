# Vantage Mode

GTM Engineering Consultancy, founded by William Mauro. Copy uses "we" for the company voice (the founder quote stays "I") and avoids em dashes.

## Architecture

- **Single-file site**: Everything lives in `index.html` (HTML, CSS, JS). Images live in `images/` (never inline base64), plus `og.png`, `robots.txt`, `sitemap.xml` at the root
- **No build system**: Static site, no bundler, no framework
- **Hosted**: Deployed as static HTML. Pushing a `claude/**` branch auto-merges to `main` (see `.github/workflows`), so use another branch name for unreviewed work

## Design System

- **Theme**: Dark background with gold accent
- **Colors**: `--black: #080808`, `--gold: #c9a84c`, `--gold-bright: #f0c96b`, `--white: #f5f0e8`, `--muted: #a39b8c` (text), `--line: #6b6458` (rules), `--gold-soft: #b59443` (small gold text)
- **Accent colors**: `--red-accent: #e63946`, `--teal-accent: #00b4c5`, `--pink-accent: #e040a0`, `--blue-accent: #0070f3`
- **Fonts**: Bebas Neue (display), DM Sans (body), Playfair Display italic (accent)
- **Custom cursor**: Gold dot + ring, hidden on mobile via `@media (pointer: coarse)`
- **Film grain overlay**: SVG noise texture on `body::before`
- **Themes**: dark by default, light via `html[data-theme="light"]` overriding the same tokens (plus `--ink-rgb`, `--bg-rgb`, `--on-gold`, `--on-gold-rgb`, `--ok`, `--bad`, `--info`). Gold has three jobs: `--gold` for fills and borders, `--gold-ink` for small text, `--gold-display` for large headings in light mode. Use those tokens, never raw white/black rgba, so both themes keep working. The nav toggle saves the choice in localStorage (`vm-theme`); a one-line script in `<head>` applies it before paint, the only script outside the main block

## Site Sections (in order)

1. **Nav**: Fixed top nav (Approach, Services, Playbook, Metrics, Toolkit, About), theme toggle, hamburger menu, "Start a Project" CTA
2. **Hero**: GTM positioning for early-stage software companies growing their sales team, 3 pillars (Data / AI Agents / RevOps)
3. **Approach** (`#approach`): 6-step GTM system flow + 4 principles
4. **See It Run** (`#pipeline`): sample pipeline demo, labeled fictional
5. **Services**: GTM services with counter, including launch content and video
6. **Engagements** (`#pricing`): GTM Audit / Pipeline Build / Fractional GTM Engineer, plus two smaller options below the cards (Single-Piece Build, System Upkeep). No prices on the site. The SDR calculator's $2,500 a month is the upkeep fee only; clients pay for tools on their own accounts, and we never bill tools. Sits right after Services so offers come early
7. **Playbook** (`#playbook`): Brand-neutral visual of the two-motion GTM strategy and the interactive SDR savings calculator with transparent formulas; revenue lever, flywheel, phased rollout and guardrails sit in a fold. No client or product names, and no unsourced performance claims: calculator defaults are labeled assumptions
8. **Scoreboard** (`#metrics`), **Client journey** (`#journey`): KPI tree and phases; detail sits in folds
9. **Toolkit** (`#stack`): Logos grouped by function, shuffled within each group on load; first two groups shown, rest in a fold
10. **Founder**: William Mauro bio with photo
11. **Team** (`#team`): an org of Will plus nine AI agents: six leads (Maya Chen, Marcus Reed, Priya Nair, Elena Ruiz, Jordan Blake, Daniel Okafor) and three specialists who report to a lead (Hannah Brooks to Marcus, Leila Nasser to Priya, Kenji Watanabe to Daniel), always labeled as AI, with a line saying their names and portraits are invented. Portraits are AI-generated (Higgsfield soul_2), 288px JPGs in `images/team/`; cards are tagged "Agent". Below the cards: a 4-step "How we decide" list, a guardrail strip, and a teardown CTA (`data-cta="team"`). Guardrail copy must stay literally true: `claude/**` auto-merge exists, so say "needs Will's yes", never "only Will ships". Bios mirror the agent definitions in `~/.claude/agents/` and the charter in `~/.claude/team/charter.md`: change both together
12. **FAQ**, **Ticker**, **CTA + contact form**, **Footer**

**Folds**: a section with class `folds` hides its `.fold` blocks until its `.fold-toggle` button is pressed. Put deep-dive detail in a fold rather than making the page longer.

## Scorecard (`/scorecard`)

- Standalone lead-magnet page in `scorecard/index.html` (its own CSS/JS, same tokens and `vm-theme` key). Indexable, unlike the redirect share pages
- 3 unscored context questions + 12 scored (4 each for Data / AI Agents / RevOps, 0 to 3 points). Pillar = points / 12 x 100, overall = average. Bands: 0-39 Running on effort, 40-69 Partly systemized, 70+ Systemized
- Score and pillar bars are free; the email gate unlocks the top 3 gaps (lowest answers, ties to the weaker pillar), metrics to watch, services, and a 90-day plan for the weakest pillar. The report shows even if the lead save fails, with a mailto fallback
- Saves to `leads` with `source: 'scorecard'`, `service: 'GTM Scorecard'`, company in `brand`, scores and every answer in `message`
- Homepage entry points: hero note link, band after Scoreboard (`#scorecard`), footer link (all `.scorecard-link`). `/#teardown` opens the booking page (or the teardown wizard if `BOOKING_URL` is empty) on arrival
- Events: scorecard_started, scorecard_completed, scorecard_email_submitted, cta_scorecard
- `/scorecard?r=<15 digits>` (one digit per answer, question order) opens the full report directly. The lead message includes this link, and the follow-up emails use it

## KPI template (`/kpi-scoreboard`)

- Email-gated download of `downloads/gtm-kpi-scoreboard.xlsx` (source `kpi_template`). The download runs even if the lead save fails
- The workbook is generated by `scripts/build_kpi_template.py` (openpyxl). KPI text mirrors the Scoreboard section: change both together, then rerun the script
- Linked from the Scoreboard hint line, the footer, and the scorecard report

## Leads dashboard (`/leads`)

- Private page for Will to read the `leads` table: `leads/index.html`, `leads/app.js`, `leads/leads.css`, `leads/theme.js` (no inline script or style; the page CSP forbids both). Same tokens and `vm-theme` key. Not linked anywhere, `noindex`, `Disallow: /leads/` in robots.txt, no sitemap entry, no analytics
- Sign-in is Supabase Auth email and password; the session lives in sessionStorage; sign-out is global. supabase-js is pinned to an exact version with SRI, and that URL is the only external script the CSP allows. Bumping it means updating the version, the `integrity` hash, and the CSP together
- Security model: RLS is the real control. Only Will's auth user can select (`supabase/migrations/20261015120000_leads_owner_read.sql`); anon can only insert. The "No access" screen for other accounts is UX, not security. Signups must stay disabled in Supabase Auth
- Lead fields are untrusted text from public forms. Render them only via `textContent` / `createTextNode`, never `innerHTML` or template-string HTML. Only `mailto:` links and `https://www.vantagemode.com/scorecard?r=` report links become links
- Internal-test, bot-flag, "new", and scorecard-parsing rules are Kenji's definitions, implemented as pure functions at the top of `app.js`. Headers (`X-Frame-Options`, `Referrer-Policy`, `X-Robots-Tag`) live in `vercel.json`

## Follow-up emails (`supabase/functions/nurture`)

- Five emails over 14 days (days 0, 2, 5, 9, 14) to `scorecard` and `kpi_template` leads; copy and timing live in `lib.ts`, tests in `lib.test.ts` (`node supabase/functions/nurture/lib.test.ts`)
- One sequence per email address; stops on unsubscribe or when the same email later submits a teardown, wizard, contact, or SOW form
- Records sends in `nurture_sends`, unsubscribes in `nurture_unsubscribes`. Unsubscribe links go to `/unsubscribe/`, which POSTs a signed token to the function
- Sends nothing until its secrets are set; see the header of `index.ts`. `NURTURE_TEST_TO` reroutes every email to one inbox for testing

## Interactive Elements

- **Leads**: all forms call `saveLead()`, which inserts into the Supabase `leads` table and shows an email fallback if the insert fails. Never show a success message without checking the insert result
- **Teardown offer**: `BOOKING_URL` is set to the Cal.com event (https://cal.com/william-mauro-ke6r6y/free-pipeline-teardown), so `.open-teardown` buttons open it in a new tab, and `/#teardown` (scorecard button, nurture emails) redirects to it in the same tab. Bookings live in Cal.com, not the `leads` table. Clear `BOOKING_URL` to fall back to the wizard preselected to "Pipeline Teardown"
- **Analytics**: Vercel Web Analytics (`/_vercel/insights/script.js`). Custom events via `track(name, data)`: cta_teardown, cta_start_project, wizard_step, calculator_used, lead_submitted, lead_save_failed

- **Project Wizard**: Multi-step modal form triggered by `.open-wizard` class
- **Scroll animations**: `.reveal` class with IntersectionObserver
- **Service tabs**: Click-to-switch service cards
- **Mobile menu**: Hamburger toggle with full-screen overlay

## Conventions

- All CSS is in a single `<style>` block at the top
- All JS is in a single `<script>` block at the bottom
- Use CSS custom properties (`:root` vars) for all colors
- Animations use CSS `@keyframes` and `transition`
- Mobile responsive via `@media` queries
- Contact email: will@vantagemode.com

## MCP Integrations

- **Figma**: Pull designs directly from Figma files into code
- **Supabase**: Database, edge functions, migrations for backend features
