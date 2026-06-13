# July 2026 drafts — summary

**Status: DRAFT — ready for Jason's review.**
Drafted by the monthly pipeline on 2026-06-13. All 7 active segments are included.

**Suggested send date: Monday, June 29, 2026** (before the July 1 wage change takes effect).

---

## Shared core (in every segment)

**Deadlines:**
- Wed, Jul 1 — Local minimum-wage increases (City of LA, LA County unincorporated, Pasadena)
- Wed, Jul 15 — Federal & CA payroll tax deposit for June payroll (monthly depositors)
- Fri, Jul 24 — CDTFA sales-tax prepayment (prepayment accounts)
- Fri, Jul 31 — Form 941 Q2 payroll return; CDTFA Q2 sales & use return; FUTA deposit if >$500

**Date verification:** Jul 1 = Wednesday ✓ · Jul 15 = Wednesday ✓ · Jul 24 = Friday ✓ · Jul 31 = Friday ✓. July 4 (Saturday) is observed Friday Jul 3 for federal purposes — no impact on any key deadline.

**What changed (shared):** Local minimum-wage increases. Rates sourced from UC Berkeley Labor Center inventory (see "Verify before sending" below).

---

## Segment differences

| Segment | Extra deadline | Spotlight | Notable |
|---|---|---|---|
| `general.html` | Form 5500 Jul 31 | Mid-year books check: profit vs. plan + CA SOI reminder | Links to mid-year checklist article |
| `restaurants.html` | — | Summer hires → tip reporting setup on day one | Links to tip-reporting article; federal tip deduction mention |
| `optometrists.html` | — | Equipment timing: Section 179 / bonus depreciation Q3 window | Notes no CDTFA rate changes for optical retail |
| `wholesalers.html` | — | Mid-year resale certificate hygiene | Notes no LA-area district rate changes confirmed; flags CDTFA Special Notices to check |
| `service-stations.html` | — | Fuel excise rate change: 4 things to check on Jul 1 | **Fuel excise rate UNCONFIRMED — see below** |
| `law-firms.html` | Form 5500 Jul 31 | Draws, K-1s, and PTET window; CA Q3 = $0 reminder | Links to mid-year checklist article |
| `grocery.html` | — | Department wage ladder / compression review before Jul 1 | CRV reminder (rates updated Jan 1, 2026) |

---

## Verify before sending

**1. Local minimum-wage rates (HIGH PRIORITY)**
Rates used in all drafts are from the UC Berkeley Labor Center inventory, fetched 2026-06-13:
- City of Los Angeles: **$18.42 / hour** (effective Jul 1, 2026)
- Unincorporated LA County: **$18.47 / hour** (effective Jul 1, 2026)
- Pasadena: **$18.57 / hour** (effective Jul 1, 2026)
- Glendale: no local ordinance; follows CA statewide ($16.90, no Jul 1 change)

Verify these against the official city/county ordinances before sending. Direct sources:
- City of LA: wagesla.lacity.org
- LA County: employee.lacounty.gov (HR department)
- Pasadena: cityofpasadena.net/finance/minimum-wage

**2. CA fuel excise tax rate — service-stations.html (HIGH PRIORITY)**
The CDTFA adjusts the motor vehicle fuel excise tax July 1 annually. The 2026 rate could not be confirmed from a fetched source during this run. The service-stations draft tells readers to "confirm the new rate from your CDTFA account or the CDTFA Special Notices page." Jason: insert the confirmed rate into the email if you have it, or keep the "confirm before sending" phrasing.

**3. CDTFA district rate changes for LA-area wholesalers**
The wholesalers draft notes "no new district sales-tax rate changes announced for LA County for July" and asks Jason to verify against the CDTFA Special Notices page before sending. The CDTFA Special Notices page (cdtfa.ca.gov) could not be fetched during this run.

**4. Blog links**
All internal links point to jparkassociates.com/blog/<slug>.html. Verify these resolve before sending:
- /blog/ca-payroll-2026-minimum-wage-sdi.html (general, optometrists)
- /blog/tip-reporting-restaurants-2026.html (restaurants)
- /blog/mid-year-tax-planning-checklist.html (general, law-firms)
- /blog/la-crescenta-glendale-business-tax-map.html (general)

**5. `{{UNSUBSCRIBE_URL}}`** — left as-is in all 7 drafts. Jason's send tool fills it.

---

## QA pass

- No unreplaced `{{` placeholders other than `{{UNSUBSCRIBE_URL}}` — confirmed.
- All dates verified against 2026 calendar (weekday names correct).
- No IRS disaster relief currently extending July 2026 deadlines for CA (verified via IRS newsroom, fetched 2026-06-13).
- CA SDI: 1.3%, no wage cap (no change mid-year — verified via EDD).
