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
11. **FAQ**, **Ticker**, **CTA + contact form**, **Footer**

**Folds**: a section with class `folds` hides its `.fold` blocks until its `.fold-toggle` button is pressed. Put deep-dive detail in a fold rather than making the page longer.

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
