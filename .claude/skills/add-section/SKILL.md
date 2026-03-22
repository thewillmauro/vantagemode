---
name: add-section
description: Add a new section to the Vantage Mode site
---

# Add a New Section

When adding a new section to index.html, follow these steps:

1. **CSS**: Add styles in the `<style>` block, using existing CSS custom properties (`var(--gold)`, `var(--black)`, etc.)
2. **HTML**: Insert the `<section>` element in the correct position within the page flow
3. **JS**: If interactive, add behavior in the `<script>` block at the bottom
4. **Nav**: Update nav links if the section should be navigable

## Template

```html
<!-- SECTION_NAME -->
<section class="section-name" id="section-name">
  <p class="section-eyebrow reveal">EYEBROW TEXT</p>
  <h2 class="section-title reveal">Section Title</h2>
  <div class="section-content reveal reveal-delay-2">
    <!-- Content here -->
  </div>
</section>
```

## Checklist
- [ ] Uses `.reveal` class for scroll animations
- [ ] Responsive at mobile breakpoints
- [ ] Uses design system colors and fonts
- [ ] Consistent spacing with adjacent sections
- [ ] Added to nav if appropriate
