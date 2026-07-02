/* ============================================================
   THE LEDGER — post manifest
   This file is the single source of truth for the blog index.
   The automation pipeline (announcement tracker) appends new
   entries to the TOP of this array and drops a matching
   blog/<slug>.html file generated from blog/_template.html.

   Fields:
     slug      — filename without .html, kebab-case
     title     — plain text (no HTML)
     excerpt   — 1–2 sentences, plain text
     date      — ISO yyyy-mm-dd (publication date)
     category  — one of: federal | california | compliance |
                 payroll | deadlines | industry | guides
     source    — issuing authority shown on the card
                 (e.g. "IRS", "CDTFA", "FinCEN", "EDD",
                  "J Park & Associates")
     srcShort  — short form rendered inside the card artwork
     readMins  — integer, estimated reading time
   ============================================================ */
window.BLOG_POSTS = [
  {
    slug: "california-tobacco-retailer-license-fee-2026",
    title: "California tobacco retailer license fee jumps to $450 on July 1, 2026",
    excerpt: "If your store sells cigarettes or vapes, the CDTFA retailer license fee rose from $265 to $450 per location on July 1 — not prorated. Plus the distributor products tax dropped to 51.08% the same day.",
    date: "2026-06-29",
    category: "california",
    source: "CDTFA",
    srcShort: "CDTFA",
    readMins: 5
  },
  {
    slug: "la-county-minimum-wage-july-2026",
    title: "Minimum wage rises July 1, 2026 — what La Crescenta and Glendale employers pay now",
    excerpt: "Local minimum wages reset July 1: unincorporated L.A. County (La Crescenta, Montrose) hits $18.47, the City of L.A. $18.42, Pasadena $18.57 — while Glendale follows the state $16.90. What you owe depends on where the work happens.",
    date: "2026-06-22",
    category: "payroll",
    source: "Local Wage Law",
    srcShort: "Wages",
    readMins: 5
  },
  {
    slug: "california-fuel-excise-tax-july-2026",
    title: "California fuel excise taxes rise July 1, 2026 — what service-station operators need to do",
    excerpt: "Every July 1, the CDTFA adjusts California excise tax rates by CPI. This year: gasoline rises from 61.2 to 63.4 cents per gallon, diesel from 46.6 to 48.2 cents. What it means for your prepayments.",
    date: "2026-06-12",
    category: "california",
    source: "CDTFA",
    srcShort: "CDTFA",
    readMins: 4
  },
  {
    slug: "irs-ftb-notice-guide-la-crescenta",
    title: "Got an IRS or FTB letter? What each notice means — and what to do first",
    excerpt: "CP14, CP2000, the collection ladder, FTB demands — a La Crescenta CPA's plain-English decoder for tax notices, plus the response playbook that keeps a letter from becoming a problem.",
    date: "2026-06-09",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "payroll-services-la-crescenta-glendale",
    title: "Payroll for La Crescenta & Glendale small businesses: what \"handled\" actually means",
    excerpt: "Payroll is a compliance machine with weekly deadlines and street-by-street wage rules in the Crescenta Valley. What a managed payroll service must include — and the failure modes that cost real money.",
    date: "2026-06-04",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "bookkeeping-crescenta-valley-diy-or-cpa",
    title: "Bookkeeping for Crescenta Valley businesses: DIY, bookkeeper, or CPA?",
    excerpt: "Every owner starts as their own bookkeeper. The honest guide to the three tiers of bookkeeping, the five signs you've outgrown DIY, and what a monthly service should actually deliver.",
    date: "2026-05-28",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "starting-a-business-crescenta-valley-first-90-days",
    title: "Starting a business in the Crescenta Valley: the first 90 days, financially",
    excerpt: "Entity, EIN, bank account, licenses, seller's permit, payroll registration, books — the financial setup sequence for La Crescenta, Montrose, and Glendale, in the order that prevents rework.",
    date: "2026-05-22",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 7
  },
  {
    slug: "tax-preparation-la-crescenta-checklist",
    title: "Tax preparation in La Crescenta: the complete what-to-bring checklist",
    excerpt: "What your CPA actually needs for a complete, deduction-tight return — the personal list, the business list, and the LA-County-specific documents owners forget. Works for October 15 extensions too.",
    date: "2026-05-12",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "how-to-choose-small-business-cpa-los-angeles",
    title: "How to choose a small-business CPA in Los Angeles: 10 questions that separate the good ones",
    excerpt: "Most owners pick a CPA on proximity and price, then quietly regret it every April. Ten questions that surface whether a firm will actually run your books, taxes, and deadlines — asked before you sign.",
    date: "2026-06-12",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 7
  },
  {
    slug: "s-corp-vs-llc-california-taxes",
    title: "S corp vs. LLC in California: what each one actually costs you in tax",
    excerpt: "An LLC is a legal wrapper; an S corp is a tax election — and in California each carries its own price tag. The self-employment-tax math, the $800s and the 1.5%, and when the switch pays for itself.",
    date: "2026-06-11",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 7
  },
  {
    slug: "la-crescenta-glendale-business-tax-map",
    title: "Running a business in La Crescenta or Glendale? Your local tax & license map",
    excerpt: "In the foothills, the agency that regulates you can change street by street — unincorporated LA County vs. the City of Glendale. Who collects what, which licenses apply, and the local traps to check.",
    date: "2026-06-10",
    category: "guides",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "q2-estimated-taxes-june-15",
    title: "Q2 estimated taxes are due June 15 — here's how to get the number right",
    excerpt: "The second federal estimated-tax payment of 2026 lands on June 15, and California's weighting makes this one the biggest of the year. What to pay, how the safe harbors work, and why guessing costs you.",
    date: "2026-06-08",
    category: "deadlines",
    source: "IRS",
    srcShort: "IRS",
    readMins: 5
  },
  {
    slug: "mid-year-tax-planning-checklist",
    title: "The mid-year tax review: 90 minutes in June that prevent an April surprise",
    excerpt: "Half the year's numbers are real now, not projections. A mid-year review is the single highest-leverage planning session on the calendar — here's exactly what we look at.",
    date: "2026-06-01",
    category: "federal",
    source: "J Park & Associates",
    srcShort: "JP&A",
    readMins: 6
  },
  {
    slug: "boi-reporting-2026-california-llcs",
    title: "BOI reporting in 2026: where FinCEN's rules actually stand for California LLCs",
    excerpt: "Beneficial-ownership reporting has changed direction more than once. Here's the current state of the rule, who still has to file, and why you shouldn't pay a 'BOI filing service' before reading this.",
    date: "2026-05-19",
    category: "compliance",
    source: "FinCEN",
    srcShort: "FinCEN",
    readMins: 5
  },
  {
    slug: "restaurant-sales-tax-dine-in-vs-to-go",
    title: "Dine-in vs. to-go: getting restaurant sales tax right with the CDTFA",
    excerpt: "Hot food, cold food, eaten here, packed to go — California taxes each combination differently, and the 80/80 rule decides whether your cold to-go sales are taxable at all.",
    date: "2026-05-05",
    category: "california",
    source: "CDTFA",
    srcShort: "CDTFA",
    readMins: 6
  },
  {
    slug: "tip-reporting-restaurants-2026",
    title: "Tip reporting without the headache: what the IRS expects from restaurants in 2026",
    excerpt: "Employee tip reports, payroll withholding, Form 8027, the FICA tip credit — and how the federal tip deduction changes what your staff will ask you at year-end.",
    date: "2026-04-21",
    category: "industry",
    source: "IRS",
    srcShort: "IRS",
    readMins: 6
  },
  {
    slug: "ca-payroll-2026-minimum-wage-sdi",
    title: "California payroll in 2026: minimum wage, SDI, and what changed in January",
    excerpt: "The statewide minimum wage rose again on January 1, local rates move mid-year, and SDI withholding still has no wage ceiling. A plain-English rundown for employers.",
    date: "2026-01-13",
    category: "payroll",
    source: "EDD",
    srcShort: "EDD",
    readMins: 5
  }
];
