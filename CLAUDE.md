# Vantage Mode

GTM Engineering Consultancy, founded by William Mauro. Copy is first person ("I") and avoids em dashes.

## Architecture

- **Single-file site**: Everything lives in `index.html` (~4270 lines of HTML, CSS, JS)
- **No build system**: Static site, no bundler, no framework
- **Hosted**: Deployed as static HTML. Pushing a `claude/**` branch auto-merges to `main` (see `.github/workflows`), so use another branch name for unreviewed work

## Design System

- **Theme**: Dark background with gold accent
- **Colors**: `--black: #080808`, `--gold: #c9a84c`, `--gold-bright: #f0c96b`, `--white: #f5f0e8`, `--muted: #6b6458`
- **Accent colors**: `--red-accent: #e63946`, `--teal-accent: #00b4c5`, `--pink-accent: #e040a0`, `--blue-accent: #0070f3`
- **Fonts**: Bebas Neue (display), DM Sans (body), Playfair Display italic (accent)
- **Custom cursor**: Gold dot + ring, hidden on mobile via `@media (pointer: coarse)`
- **Film grain overlay**: SVG noise texture on `body::before`

## Site Sections (in order)

1. **Nav**: Fixed top nav (Approach, Services, Playbook, Toolkit, About), hamburger menu, "Start a Project" CTA
2. **Hero**: GTM positioning, 3 pillars (Data / AI Agents / RevOps)
3. **Approach** (`#approach`): 6-step GTM system flow + 4 principles
4. **Services**: Six GTM services with counter (01-06), including launch content and video
5. **Playbook** (`#playbook`): Brand-neutral visual of the two-motion GTM strategy (inbound/product-led + targeted outbound feeding one source of truth, the bridge, phased rollout, guardrails). No client or product names
6. **Engagements** (`#pricing`): GTM Audit / Pipeline Build / Fractional GTM Engineer, no prices
7. **Toolkit** (`#stack`): Logos grouped by function, shuffled within each group on load
8. **Founder**: William Mauro bio with photo
9. **FAQ**, **Ticker**, **CTA + contact form**, **Footer**

## Interactive Elements

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
