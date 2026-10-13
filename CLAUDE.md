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

## Site Sections (in order)

1. **Nav**: Fixed top nav (Approach, Services, Playbook, Metrics, Toolkit, About), hamburger menu, "Start a Project" CTA
2. **Hero**: GTM positioning for early-stage software companies growing their sales team, 3 pillars (Data / AI Agents / RevOps)
2b. **Credibility strip** (`.cred`): photo, one line about Will, three background points, link to `#founder`. Facts must match the founder bio
3. **Approach** (`#approach`): 6-step GTM system flow + 4 principles
4. **Live Pipeline demo** (`#pipeline`): "What your reps open every morning." Kanban board of 11 fictional accounts across 5 stages (ghost-loads on scroll via IntersectionObserver with a scroll-position fallback, live activity feed). Clicking an account opens a dossier panel that ghost-loads section by section (including Conversation Notes from fictional calls in `CALLS`, shown before the email draft; call content is never quoted in outbound emails); a "Recommended Build" section (from the Enriched stage on) picks the best 3-4 of our services for that company with toolkit tools and one-line reasons, plus "Not now" services and a suggested engagement, all from rules in `recommend()` over the account's stack, motion, hiring, free-plan users, funding, and calls. Tool chip logos are read from the toolkit DOM, so a tool must exist in the toolkit to show its logo; depth depends on the account's stage. All data is fictional (`.example` domains) and labeled as sample data. Scores are computed from the rules in `scoreRules()`, so the card score and the breakdown always match
5. **Services**: Seven GTM services with counter (01-07), including Conversation Intelligence (call notes from sales, CS, and product turned into CRM data) and launch content and video
6. **Playbook** (`#playbook`): Brand-neutral visual of the two-motion GTM strategy (inbound/product-led + targeted outbound feeding one source of truth, the bridge, revenue equation, compounding flywheel, interactive SDR savings calculator with transparent formulas, phased rollout, guardrails). No client or product names, and no unsourced performance claims: calculator defaults are labeled assumptions
7. **Scoreboard** (`#metrics`): KPI tree (revenue growth → Pipeline, Conversion, Deal Size, Retention, plus Efficiency and System Health), 21 expandable KPIs with definition, formula, and the services that move them; weekly/monthly/quarterly review cadence; experiment loop. Definitions only, no benchmarks or claimed results
8. **Engagements** (`#pricing`): GTM Audit / Pipeline Build / Fractional GTM Engineer, plus two smaller options below the cards (Single-Piece Build, System Upkeep). No prices on the site. Clients pay for tools on their own accounts, and we never bill tools. The SDR calculator shows the gross value of SDR time freed (no system cost subtracted), so it never implies a price
9. **Toolkit** (`#stack`): 59 logos in 10 groups (Prospecting & Outreach, CRMs, Call Notes, Calling & Dialers, Product Analytics & Data, Automation & Scheduling, AI Models & Tools, Build & Ship, Operations, Content & Ads), shuffled within each group on load. Intro says these are platforms we build with plus ones we work in for clients. Logos without a simple-icons entry are one-color masks in `images/logos/`, built from each company's own icon
10. **Founder**: William Mauro bio with photo
11. **FAQ**, **Ticker**, **CTA + contact form**, **Footer**

## Share Links

- `/playbook`, `/sdr-calculator`, `/pipeline-demo` are small static pages (each folder's `index.html`) with their own title and Open Graph tags for LinkedIn previews. They forward to the matching homepage anchor (`#playbook`, `#sdr-math`, `#pipeline`) and keep UTM params. They are `noindex` on purpose; real search-ranking pages would need full content

## Interactive Elements

- **Leads**: all forms call `saveLead()`, which inserts into the Supabase `leads` table and shows an email fallback if the insert fails. Never show a success message without checking the insert result
- **Teardown offer**: `.open-teardown` buttons open the wizard preselected to "Pipeline Teardown". Set `BOOKING_URL` in the script to send them to a booking page instead
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
