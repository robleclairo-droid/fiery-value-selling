# Planner shop (standalone static site)

Open `index.html` to preview. No build step.

## Go live in 3 steps
1. **Checkout + file delivery.** Create a free account at Payhip, Gumroad or Lemon Squeezy. Upload
   `../products/2027-planner/2027-Minimalist-Planner.pdf` as a digital product and set the price. The provider takes payment and
   emails the download automatically.
2. **Connect it.** Paste the product's checkout link into `config.js` (`buyUrl`) and set your shop name. Buttons switch from "Coming soon" to "Buy now".
3. **Host it.** Put the contents of this `shop/` folder in its own repo (GitHub Pages) or drag the folder onto Netlify Drop / Cloudflare Pages.

## Important
- Do **not** put the paid PDF in this folder or any public repo. Only the free sample (`free/`) is public.
- If the repo containing `products/2027-planner/` is public, anyone can download the full PDF. Make it private or move `products/` out before launching.
- Taxes and payouts are set up in your payment provider's dashboard.
