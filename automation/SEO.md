# SEO conventions for jparkassociates.com content

Reference for anyone (human or agent) writing pages or articles. The article
pipeline (PIPELINE.md) should apply this when drafting.

## Keyword strategy — three tiers

1. **Local-commercial (the money tier, winnable):** "CPA La Crescenta",
   "accountant La Crescenta", "small business CPA Glendale", "tax accountant
   Montrose/Tujunga/Sunland". Low competition, high intent. Served by the
   homepage + the local guide article. Rankings here are driven as much by the
   Google Business Profile as by the site.
2. **Metro-commercial (competitive, long game):** "small business CPA Los
   Angeles", "restaurant accountant Los Angeles", "CPA for law firms LA".
   Served by owner's guides and industry articles. Expect months, not weeks.
3. **Informational (traffic + authority):** "S corp vs LLC California",
   "CDTFA 80/80 rule", "California estimated tax 30/40/0/30", "Form 571-L".
   Served by The Ledger. These build the topical authority that lifts tier 1–2.

## Current campaign focus: "CPA La Crescenta" (set 2026-06-12)

Until further notice, new content should preferentially serve these phrases,
in priority order. One phrase per article; bold = has a dedicated page.

| Priority | Phrase | Serving page |
|---|---|---|
| 1 | **CPA La Crescenta** / La Crescenta CPA | homepage (+ GBP) |
| 2 | **small business accountant La Crescenta** | homepage + choose-a-CPA guide |
| 3 | **tax preparation La Crescenta** | tax-prep checklist article |
| 4 | **bookkeeping services La Crescenta / Crescenta Valley** | bookkeeping article |
| 5 | **payroll services La Crescenta / Glendale** | payroll article |
| 6 | **starting a business in Glendale / La Crescenta** | first-90-days article |
| 7 | **IRS notice help / tax letter CPA** (+ local modifier) | notices article |
| 8 | CPA Montrose / accountant Montrose CA | mention in local content; future page |
| 9 | CPA La Cañada Flintridge / accountant Tujunga–Sunland | mention in local content; future pages |
| 10 | restaurant accountant Los Angeles (bridge to metro tier) | tip/sales-tax articles |

Adjacent-neighborhood names (Montrose, La Cañada Flintridge, Tujunga,
Sunland, Verdugo City, Glendale, Foothill Blvd corridor) should appear
naturally in local articles — they're how Google associates the firm with
the whole Crescenta Valley, not just one ZIP.

## Per-article rules

- **One primary query per article**, stated as a human would type it. Put it
  (or a close variant) in: the `<title>`, the `<h1>`, the meta description,
  the slug, and the first ~100 words. Naturally — never stuffed.
- Titles ≤ ~65 chars where possible; meta descriptions 140–160 chars, written
  as the search snippet you'd want clicked.
- **Internal links:** every new article links to at least one existing
  article and is linked from at least one place. Cross-link guides ↔ topical
  articles (e.g., entity guide ↔ mid-year review).
- California/LA specificity is the moat — generic national content loses to
  Investopedia; "what this means at your address in LA County" doesn't.
- Cite primary sources (irs.gov, ftb.ca.gov, cdtfa.ca.gov…) — it's what makes
  this content credible to readers and to search quality raters.

## Site mechanics (already in place — keep them true)

- `sitemap.xml` — every new page gets a `<url>` entry (pipeline step 5.3).
- `robots.txt` — blocks `/emails/`, `/automation/`, `/video/`.
- Every page: `<link rel="canonical">`, `og:url`, `og:image`
  (`assets/og-image.jpg`), `twitter:card`. The article template emits these.
- JSON-LD: `AccountingService` on the homepage, `Article` per post, `Blog` on
  the index.

## Off-site (Jason's side — the site can't do these)

- **Google Business Profile** is the #1 lever for "CPA near me" queries:
  claim/verify, exact NAP (2529 Foothill Blvd. Ste 101, La Crescenta, CA
  91214 / (818) 248-1580), category "Certified Public Accountant", link the
  site, post the blog articles there, and steadily collect reviews.
- Consistent NAP citations: Yelp, Apple Maps, Bing Places, CalCPA directory.
- Submit `sitemap.xml` in Google Search Console + Bing Webmaster Tools;
  monitor queries quarterly and write articles for what's almost ranking.
- Local links: chamber of commerce, CV Weekly, local business associations.
