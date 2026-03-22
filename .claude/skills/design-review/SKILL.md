---
name: design-review
description: Review a Figma design and implement it in the Vantage Mode site
---

# Design-to-Code Review

Use this workflow when implementing a Figma design into the site.

## Steps

1. **Get the design**: Use `get_design_context` with the Figma URL to pull code + screenshot
2. **Map to design system**: Convert any raw hex colors to CSS variables (`--gold`, `--black`, etc.)
3. **Adapt fonts**: Use `var(--font-display)` for headings, `var(--font-body)` for text, `var(--font-italic)` for accent
4. **Add to index.html**: CSS in `<style>`, HTML in correct position, JS in `<script>` if needed
5. **Add animations**: Use `.reveal` class for scroll-triggered entrance animations
6. **Test responsive**: Ensure it works at mobile breakpoints

## Color Mapping Reference

| Figma Color | CSS Variable |
|---|---|
| #080808 | `var(--black)` |
| #0d0d0d | `var(--deep)` |
| #141414 | `var(--surface)` |
| #1c1c1c | `var(--surface2)` |
| #c9a84c | `var(--gold)` |
| #f0c96b | `var(--gold-bright)` |
| #f5f0e8 | `var(--white)` |
| #6b6458 | `var(--muted)` |
