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
