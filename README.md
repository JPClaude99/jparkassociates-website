# J Park & Associates — scroll-cinematic website (WIP)

A cinematic marketing site for J Park & Associates, Certified Public Accountants
(La Crescenta / Los Angeles). The hero/order effect is a canvas image-sequence:
two Higgsfield clips (AI-upscaled to 2K) are sliced into 193 WebP frames each and
played on a canvas. Each cinematic panel plays its clip once on entry, then one
scroll jumps to the next section (it is not a scroll-position scrub). Lenis drives
the smooth scrolling for the rest of the page.

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
| `blog.html` | "The Ledger" — blog index (featured post, category filter, card grid, newsletter) |
| `blog.css` / `blog.js` | Blog styles (on top of `styles.css`) and the index renderer/filter |
| `blog/posts.js` | Post manifest — the single source of truth the index renders from |
| `blog/_template.html` | Article template with `{{PLACEHOLDERS}}` — the automation contract |
| `blog/<slug>.html` | Individual articles (pure static HTML, no JS) |
| `automation/PIPELINE.md` | Playbook for the weekly announcement-scan agent (drafts Ledger articles via PR) |
| `automation/EMAILS.md` | Playbook for the monthly client-email agent (incl. recurring deadline calendar) |
| `automation/sources.json` | The agency feeds both agents watch (IRS, CDTFA, FinCEN, FTB, EDD, DIR…) |
| `emails/segments.json` | Client segments (industry/location) — one Monthly Close email drafted per active segment |
| `emails/_template.html` | Branded email template (table-based, inline styles) with `{{PLACEHOLDERS}}` |
| `emails/drafts/YYYY-MM/` | Generated email drafts + `_SUMMARY.md` per month — review, then send manually |
| `frames/hero/` | 193 WebP frames @ 2560×1440 — gold ring orbit (desktop/tablet, ≥761px) |
| `frames/order/` | 193 WebP frames @ 2560×1440 — paperwork settling into a neat stack (desktop/tablet) |
| `frames/hero-mobile/` | 193 WebP frames @ 1080×1920 — portrait gold ring (phones ≤760px) |
| `frames/order-mobile/` | 193 WebP frames @ 1080×1920 — portrait paperwork settle (phones ≤760px) |
| `assets/brand/`, `assets/favicon/` | Copied from `Branding/JPark-Logo/` |

## Page structure (the conversion spine, per Website Strategy & Blueprint)

1. Cinematic hero — "Run your business. / We'll handle the numbers."
2. Pain-Point Navigator — three pains in the client's voice (signature interaction)
3. Cinematic interlude — Sunday-night paperwork putting itself away
4. Before → After
5. Spotlight industries — restaurants, optometrists, wholesalers, service station
   operators, lawyers, grocery stores (confirmed by Justin)
6. Proof — three anonymized client situations (Challenge → Fix → Result)
7. How working together works — 3 steps
8. Tax-season stress test — result shown on screen first, email strictly optional
9. Trust strip → final CTA → footer

## Confirmed details

- Phone: (818) 248-1580 (`tel:+18182481580`)
- Email: justinpark@jparkassociates.com
- Address: 2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214

## The blog ("The Ledger") and the article automation

The blog is designed to be fed by an announcement-tracking pipeline (IRS, CDTFA,
FinCEN, EDD/FTB, UltraTax CS release notes). Publishing a new article is three
mechanical steps, in this order:

1. Render `blog/_template.html` with the `{{PLACEHOLDERS}}` filled (see the
   comment block at the top of the template) and write it to `blog/<slug>.html`.
2. Prepend a matching entry to the `window.BLOG_POSTS` array in `blog/posts.js`
   (field reference in that file's header comment).
3. Add a `<url>` entry to `sitemap.xml`.

No build step, no other files to touch — the index, featured slot, and category
filters all derive from `posts.js`. Categories: `federal`, `california`,
`compliance`, `payroll`, `deadlines`, `industry`.

**The six seeded articles are samples written by Claude (June 2026).** They're
realistic and sourced, but Justin should review them (especially the BOI and
tip-deduction ones, where rules are in flux) before launch, and the pipeline
should refresh anything stale.

### The scheduled agents

Two cloud routines run against this repo (manage them via `/schedule` in
Claude Code). **Both only open PRs — nothing publishes or sends without Justin
merging/sending.**

- **Weekly announcement scan** (Mondays): follows `automation/PIPELINE.md` —
  scans `automation/sources.json`, drafts at most 2 articles, opens a
  `[Ledger]` PR. Most weeks it finds nothing and opens nothing.
- **Monthly client emails** (23rd): follows `automation/EMAILS.md` — drafts
  next month's "Monthly Close" email per active segment in
  `emails/segments.json`, opens a `[Monthly email]` PR. Justin reviews,
  fills real numbers flagged in `_SUMMARY.md`, and sends via his email tool
  (no ESP is wired up; `{{UNSUBSCRIBE_URL}}` is filled at send time).

Note: `emails/drafts/` is technically served by GitHub Pages like everything
else in the repo. Drafts contain no client data — only generic deadline
content — so this is cosmetic, but move them out of the repo if that changes.

## Before launch — replace these

- **Case studies** in `#proof` — written as typical engagement shapes (no client
  claims); swap in permission-cleared client results when available.
- ~~Stress-test email form~~ — wired to Web3Forms (key in `scroll-cinematic.js`).
- ~~Blog newsletter form~~ — wired to Web3Forms (key in `blog.js`); new
  subscribers arrive by email. Move the list to a real ESP when volume grows.
- **Sample blog articles** — review/replace the seeded posts (see the blog
  section above).
- **Analytics** — paste the GA4 Measurement ID into `analytics.js` (see below).

## Analytics & Search Console

The site ships with `analytics.js` on every page. It is **inert until a GA4
Measurement ID is pasted in** — no consent banner is needed while it's off.

1. **GA4**: create a property at [analytics.google.com](https://analytics.google.com)
   (Admin → Create property → add a Web data stream for `jparkassociates.com`),
   copy the Measurement ID (`G-XXXXXXXXXX`), and paste it into the `GA_ID`
   constant at the top of `analytics.js`. Deploy. The site's forms then report
   conversions automatically: `stress_test_complete` (with the 0–5 score) and
   `generate_lead` with `form` = `stress_test_email` / `contact` / `newsletter` —
   mark `generate_lead` as a key event in GA4 admin.
2. **Search Console**: at [search.google.com/search-console](https://search.google.com/search-console),
   add `jparkassociates.com` as a **Domain** property and verify via the DNS TXT
   record (done at the DNS host — nothing in this repo), or add a URL-prefix
   property and drop Google's `googleXXXX.html` verification file in the repo
   root. Then submit `https://jparkassociates.com/sitemap.xml` under Sitemaps.
   If GA4 is already active, URL-prefix verification also works with zero
   extra steps via the Google Analytics method.

## Re-slicing frames

Frames are AI-upscaled to 2K via Higgsfield's video upscaler (`aigc` preset) from
the original 1080p clips, then sliced from the resulting masters
(`hero_ai2k.mp4` / `order_ai2k.mp4` — kept locally, git-ignored). Hero:

```
ffmpeg -i hero_ai2k.mp4 -c:v libwebp -compression_level 6 -q:v 90 frames/hero/frame_%04d.webp
```

`order_ai2k.mp4` additionally needs a feathered corner blur over the bottom-right
desk mat to hide an AI-hallucinated "AURUM FINANCIAL" logo. Build the mask once,
then slice through it:

```
ffmpeg -f lavfi -i color=black:s=2560x1440 -vf "drawbox=x=1600:y=1100:w=960:h=340:color=white:t=fill,boxblur=55" -frames:v 1 mask.png
ffmpeg -i order_ai2k.mp4 -loop 1 -i mask.png -filter_complex \
  "[0:v]boxblur=26:2,eq=brightness=-0.12:saturation=0.45[fx];[1:v]format=gray[m];[fx][m]alphamerge[fxa];[0:v][fxa]overlay=0:0[out]" \
  -map "[out]" -frames:v 193 -c:v libwebp -compression_level 6 -q:v 90 frames/order/frame_%04d.webp
```

If the frame count changes, update `frameCount` in the `SCRUB_SECTIONS` config at
the bottom of `index.html`. (On Windows, slice to a temp dir then `robocopy` into
`frames/` — the working-tree file watcher can lock files mid-write and abort ffmpeg.)

### Mobile portrait frames

Phones (≤760px) use separate **portrait 1080×1920** sequences in `frames/hero-mobile/`
and `frames/order-mobile/`, sliced from the Higgsfield portrait reframes (gen IDs
`64d06a94` = hero, `00bb2e24` = order; 24fps, 193 frames — keep this count equal to the
landscape sequences so `frameCount` and the text choreography match). Same q85 WebP. Hero:

```
ffmpeg -i hero_portrait.mp4 -c:v libwebp -compression_level 6 -q:v 85 frames/hero-mobile/frame_%04d.webp
```

The portrait **order** reframe also re-exposes the hallucinated "AURUM FINANCIAL" desk-mat
logo — at a DIFFERENT position than the landscape clip (the camera dollies it from
center to lower-right across frames 0–160, fading to shadow by the end). It needs its
own portrait mask (box covers the logo's full travel, feathered):

```
ffmpeg -f lavfi -i color=black:s=1080x1920 -vf "drawbox=x=670:y=1015:w=350:h=215:color=white:t=fill,boxblur=30" -frames:v 1 mask_portrait.png
ffmpeg -i order_portrait.mp4 -loop 1 -i mask_portrait.png -filter_complex \
  "[0:v]boxblur=26:2,eq=brightness=-0.12:saturation=0.45[fx];[1:v]format=gray[m];[fx][m]alphamerge[fxa];[0:v][fxa]overlay=0:0[out]" \
  -map "[out]" -frames:v 193 -c:v libwebp -compression_level 6 -q:v 85 frames/order-mobile/frame_%04d.webp
```

⚠️ ANY re-slice of `frames/order-mobile/` MUST re-apply this mask or the fake logo
returns — same rule as the desktop order clip, different coordinates.

## Notes on the stack choice

The earlier research draft proposed Astro + Tailwind for a multi-page site. This
WIP is deliberately a zero-build static page: the scroll-cinematic technique needs
no framework, loads fast, and can be dropped onto any static host (Netlify/Vercel)
as-is. If/when the full multi-page sitemap (/services, /industries/…, /insights)
gets built, this page ports cleanly into an Astro layout as the homepage.
