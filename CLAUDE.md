# Vantage Mode

Video, Software & Automation Consultancy — founded by William Mauro.

## Architecture

- **Single-file site**: Everything lives in `index.html` (~4270 lines of HTML, CSS, JS)
- **No build system**: Static site, no bundler, no framework
- **Hosted**: Deployed as static HTML

## Design System

- **Theme**: Dark background with gold accent
- **Colors**: `--black: #080808`, `--gold: #c9a84c`, `--gold-bright: #f0c96b`, `--white: #f5f0e8`, `--muted: #6b6458`
- **Accent colors**: `--red-accent: #e63946`, `--teal-accent: #00b4c5`, `--pink-accent: #e040a0`, `--blue-accent: #0070f3`
- **Fonts**: Bebas Neue (display), DM Sans (body), Playfair Display italic (accent)
- **Custom cursor**: Gold dot + ring, hidden on mobile via `@media (pointer: coarse)`
- **Film grain overlay**: SVG noise texture on `body::before`

## Site Sections (in order)

1. **Nav** — Fixed top nav with logo, links, hamburger menu, "Start a Project" CTA
2. **Hero** — Full-viewport with grid background, glow effect, letterbox bars, 3 pillars (Video/Software/Automation)
3. **Clients** — Logo ticker
4. **Platforms** — Icon grid of platforms served
5. **Services** — Tabbed service cards with counter (01-04)
6. **Portfolio** — Hidden section (`display:none`)
7. **Process** — Visual process diagram
8. **Products** — Cards for StreamLive, Adboard
9. **StreamLive** — Deep-dive section on live broadcasting platform
10. **Adboard** — Deep-dive section on local screen advertising
11. **Automation** — Business automation services
12. **Pricing** — Custom proposal approach (no packages)
13. **Founder** — William Mauro bio with photo
14. **Footer** — Contact info, links

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
