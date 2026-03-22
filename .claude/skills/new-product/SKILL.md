---
name: new-product
description: Add a new product to the Products section and create its deep-dive section
---

# Add a New Product

Follow the pattern of StreamLive and Adboard when adding a new product.

## Steps

1. **Add product card** in the `.products-grid` inside the Products section:
```html
<div class="product-card reveal">
  <div class="product-badge">Product Category</div>
  <div class="product-name">PRODUCT NAME</div>
  <p class="product-desc">Short description of the product.</p>
  <a href="#product-id" class="product-cta">Learn More →</a>
</div>
```

2. **Create deep-dive section** below the Products section, following the StreamLive/Adboard pattern with:
   - Badge with category
   - Large display title
   - Description paragraph
   - Feature grid or key stats
   - CTA button

3. **Update nav** if the product should appear in navigation

## Checklist
- [ ] Product card added to grid
- [ ] Deep-dive section created with anchor ID
- [ ] Uses `.reveal` animations
- [ ] Mobile responsive
- [ ] Consistent with StreamLive/Adboard styling
