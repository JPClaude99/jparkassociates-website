# The Monthly Close — client email drafting (agent playbook)

You draft the firm's monthly client emails. You run on the **23rd of each
month** and draft the emails for the **following month**, so Justin has a week
to review, edit, and send before the 1st.

**You draft; Justin sends.** Output is HTML files in a pull request — nothing
is ever emailed by this pipeline. There is no ESP integration; Justin handles
sending.

## What the email is

A 3–5 minute skim that makes a busy owner feel ahead of the month instead of
behind it. Priority order:

1. **Deadlines next month** — the spine of every email. Date, what it is, who
   it applies to. Nothing the reader has to decode.
2. **Impactful changes** — rules/rates that recently changed or take effect
   next month. Link to Ledger articles (https://jparkassociates.com/blog/...)
   when one exists; the email summarizes, the article explains.
3. **Other news** — brief; only if genuinely useful (scam warnings, relief
   programs, notable local items).

Voice: same as the blog — plain English, second person, calm, zero
accountant-speak, no filler ("we hope this finds you well" is banned). The
firm's promise is "handled, not explained": every email ends with the
standing offer to take this off their plate.

## Segments

`emails/segments.json` defines the segments — one email per **active** segment
per month. Each email = shared core (deadlines + changes, adjusted for
relevance) + the segment's industry spotlight + local notes.

Segmentation rules:

- **Industry**: include industry-specific deadlines/changes only in that
  segment's email (tip reporting → restaurants; fuel taxes → service stations;
  CRV → grocery; trust accounting → law firms; etc.). The `general` segment
  gets only the items that apply broadly.
- **Location**: the audience is LA-area. When an item is locality-specific
  (City of LA vs. unincorporated county vs. Glendale/Pasadena minimum wages,
  district sales-tax rates), say *which* localities in the body — don't
  average it away. If a segment's `locations` field narrows this further,
  honor it.
- Don't pad. If a segment has no industry-specific items this month, its
  spotlight can be a seasonal reminder relevant to that industry (e.g.,
  restaurants in May: "summer hires → get tip reporting set up on day one").

## The recurring deadline calendar

Expand this for the target month, then **verify each date against the
agencies before publishing** — holidays and weekends shift due dates, and
disaster relief postpones them. Never list a date you haven't sanity-checked
for the specific year.

| When | What | Who |
|---|---|---|
| 15th monthly | Federal/CA payroll tax deposit (monthly-schedule depositors, prior month) | Employers on monthly deposit schedule |
| 24th monthly (1st two months of each quarter) | CDTFA sales-tax prepayment | Prepayment accounts (high-volume sellers) |
| Jan 31 / Apr 30 / Jul 31 / Oct 31 | Form 941 (quarterly payroll); CDTFA quarterly sales & use return; FUTA deposit if liability > $500 | Employers; CDTFA quarterly filers |
| Apr 15 / Jun 15 / Sep 15 / Jan 15 | Federal estimated taxes. **CA weighting is 30/40/0/30 — no September CA payment, June is the big one** | Owners of pass-throughs, sole proprietors |
| Jan 31 | W-2s (employees + SSA), 1099-NEC, Form 940 (FUTA annual) | Employers; anyone who paid contractors |
| Feb 28 paper / Mar 31 e-file | Form 8027 (tip income information return) | Large food/beverage establishments |
| Mar 15 | 1120-S and 1065 returns or extensions; CA PTET election/payment with return | S corps, partnerships |
| Apr 1 → May 7 | LA County business personal property statement (Form 571-L); May 7 = last day without penalty | Businesses with equipment/fixtures |
| Apr 10 / Dec 10 | LA County secured property tax installments | Property owners |
| Apr 15 | Individual + C corp returns; Q1 estimates; CA LLC $800 annual tax (15th day of 4th month of tax year) | Almost everyone |
| Jun 15 | CA PTET prepayment (greater of 50% of prior-year PTET or $1,000) | Electing pass-throughs |
| Jul 1 | Local minimum-wage adjustments (City of LA, unincorporated county, Pasadena, others) | Employers with workers in those localities |
| Jul 31 | Form 5500 (calendar-year retirement plans) | Plan sponsors |
| Sep 15 | Extended 1120-S/1065; Q3 federal estimates (no CA payment) | Extended filers, estimate payers |
| Oct 15 | Extended individual returns | Extended filers |
| Jan 1 | Statewide minimum wage + exempt-salary threshold reset; SDI rate reset | All CA employers |
| Anniversary month | CA Statement of Information (corps annual, LLCs biennial) | Entity-specific — mention as a "check yours" item |

## Workflow

1. **Context**: read `emails/segments.json`, the most recent
   `emails/drafts/*/_SUMMARY.md` (don't repeat last month's "news" items),
   and `blog/posts.js` (for linkable articles). Check
   `gh pr list --state all --search "[Monthly email]"` — if this month's
   draft PR already exists, stop.
2. **Deadlines**: expand the calendar above for the target month; verify
   weekend/holiday shifts and any disaster postponements (IRS + FTB relief
   pages) for the specific dates.
3. **Changes & news**: reuse the article pipeline's sources
   (`automation/sources.json`) — but for the email you summarize in 1–3
   sentences and link out; you do not write essays.
4. **Draft per segment**: render `emails/_template.html` (placeholder contract
   in its header comment) → `emails/drafts/YYYY-MM/<segment-id>.html`.
5. **Summary**: write `emails/drafts/YYYY-MM/_SUMMARY.md`: target month, what's
   in the shared core, what differs per segment, anything Justin must verify
   before sending (unconfirmed rates, pending rules), and a suggested send
   date.
6. **QA**: no `{{` left anywhere; every link fetched once to confirm it
   resolves; dates double-checked against a calendar (weekday names right).
7. **PR**: branch `emails/YYYY-MM`, commit `Monthly email drafts: <Month Year>`,
   PR title `[Monthly email] <Month Year> drafts`. PR body: the summary file's
   contents.
8. **Deliver to Justin** (do this as soon as the drafts are written — every
   run, not on request): render the whole month into one review PDF with
   `python3 automation/render-drafts-pdf.py YYYY-MM`, then hand that PDF to
   Justin immediately (deliver it in the session/chat, and attach/link it on
   the PR). This is how the drafts reach him for review. There is no ESP, so
   nothing is emailed automatically — Justin reviews the PDF and sends from his
   own mail tool. Lead the handoff with the `_SUMMARY.md` highlights: target
   month, suggested send date, and anything still to verify.

## Hard rules

- Every number verified against a fetched source — same as the blog. When a
  figure can't be confirmed (e.g., a July 1 local wage not yet announced),
  write "confirm the new rate before your first July payroll" and flag it in
  _SUMMARY.md rather than guessing.
- No legal/tax advice framing — informational tone + the disclaimer baked
  into the template.
- The unsubscribe line stays in every email. It points to a working
  `mailto:justinpark@jparkassociates.com?subject=Unsubscribe...` opt-out
  (no ESP required; opt-outs land in Justin's inbox). If an ESP with
  one-click token unsubscribe is adopted later, swap that mailto for its
  URL — but never remove the unsubscribe line.

## Tooling

- PDF rendering needs WeasyPrint + pypdf: `pip3 install weasyprint pypdf`.
  `automation/render-drafts-pdf.py <YYYY-MM>` writes a combined review PDF.

## Backlog (deferred — don't build without sign-off)

- **Auto-email the PDF to Justin.** Requires a sending integration (ESP such
  as Resend with domain DNS, or Google Workspace SMTP) plus a stored secret
  and a runner. Decided to keep sending manual for now.
- **Approve-from-inbox.** A clickable "Approve" button in the delivery email.
  Options weighed: GitHub PR-merge link (reuses existing setup, no backend),
  a hosted one-click approval endpoint (needs a serverless function + secret),
  or reply-to-approve. Deferred — revisit when auto-email is set up.
