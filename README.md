# J Park & Associates — scroll-cinematic website (WIP)

A 3D-scroll marketing site for J Park & Associates, Certified Public Accountants
(La Crescenta / Los Angeles). The "3D" effect is a canvas image-sequence scrub:
two Higgsfield-generated 1080p cinematic clips are sliced into ~181 JPG frames each,
preloaded, and scrubbed by scroll position, with Lenis smooth scrolling on top.

## Run it

Double-click **`Launch Demo.bat`** (serves at http://localhost:8344), or:

```
python -m http.server 8344
```

A static server is required — the frame sequences won't load from `file://`.

## What's here

| Path | What it is |
|---|---|
| `index.html` | The whole site — copy, sections, and the `SCRUB_SECTIONS` frame config at the bottom |
| `styles.css` | Brand design system (navy/gold/cream, Playfair Display + Inter) |
| `scroll-cinematic.js` | Scrub engine, Lenis, reveals, pain-point navigator, stress test |
| `frames/hero/` | 181 frames — gold ring orbit (the logo's gold ring, made cinematic) |
| `frames/order/` | 181 frames — paperwork vortex settling into a neat stack (chaos → order) |
| `video/` | Source 1080p MP4s + keyframes (not loaded by the site; kept for re-slicing) |
| `assets/brand/`, `assets/favicon/` | Copied from `Branding/JPark-Logo/` |

## Page structure (the conversion spine, per Website Strategy & Blueprint)

1. Cinematic hero — "Run your business. / We'll handle the numbers."
2. Pain-Point Navigator — three pains in the client's voice (signature interaction)
3. Cinematic interlude — Sunday-night paperwork putting itself away
4. Before → After
5. Spotlight industries — restaurants, optometrists, wholesalers, service station
   operators, lawyers, grocery stores (confirmed by Jason)
6. Proof — three anonymized client situations (Challenge → Fix → Result)
7. How working together works — 3 steps
8. Tax-season stress test — result shown on screen first, email strictly optional
9. Trust strip → final CTA → footer

## Confirmed details

- Phone: (818) 248-1580 (`tel:+18182481580`)
- Email: jasonpark@jparkassociates.com
- Address: 2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214

## Before launch — replace these

- **Office hours** (not yet on the site).
- **Case studies** in `#proof` — currently anonymized/representative; replace with
  permission-cleared client results (the footnote says so on-page).
- **Stress-test email form** — UI + validation only; the submit handler in
  `scroll-cinematic.js` (`initStressTest`) is a stub. Connect Netlify Forms,
  Formspree, or an ESP.
- `og:image` meta tag (a frame from `frames/hero/` works well).

## Re-slicing frames

```
ffmpeg -i video/hero.mp4 -vf "fps=22.5,scale=1600:-2" -qscale:v 4 frames/hero/frame_%04d.jpg
```

(`order.mp4` additionally gets a feathered corner blur to hide a hallucinated
logo on the desk mat — see the build notes.) If the frame count changes, update
`frameCount` in the `SCRUB_SECTIONS` config at the bottom of `index.html`.

## Notes on the stack choice

The earlier research draft proposed Astro + Tailwind for a multi-page site. This
WIP is deliberately a zero-build static page: the scroll-cinematic technique needs
no framework, loads fast, and can be dropped onto any static host (Netlify/Vercel)
as-is. If/when the full multi-page sitemap (/services, /industries/…, /insights)
gets built, this page ports cleanly into an Astro layout as the homepage.
