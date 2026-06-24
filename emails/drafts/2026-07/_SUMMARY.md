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

**Pre-send verification pass completed 2026-06-24 against live sources. All items below confirmed unless noted.**

**1. Local minimum-wage rates (HIGH PRIORITY) — ✅ CONFIRMED**
Verified 2026-06-24 against current sources (City of LA Office of Wage Standards memo, LA County DCBA, news coverage of the July 1 increases):
- City of Los Angeles: **$18.42 / hour** (effective Jul 1, 2026) ✅
- Unincorporated LA County: **$18.47 / hour** (effective Jul 1, 2026) ✅
- Pasadena: **$18.57 / hour** (effective Jul 1, 2026) ✅
- Glendale: no local ordinance; follows CA statewide **$16.90** (effective Jan 1, 2026, no Jul 1 change) ✅

**2. CA fuel excise tax rate — service-stations.html (HIGH PRIORITY) — ✅ CONFIRMED & DRAFT UPDATED**
Confirmed 2026-06-24 via CDTFA Special Notice L-1025 and corroborating news coverage: the SB 1 annual adjustment takes the **gasoline excise rate from 61.2¢ to 63.4¢/gallon** effective Jul 1, 2026 (diesel to 48.2¢/gallon). The service-stations draft has been **updated** to state the confirmed rate and now links the `/blog/california-fuel-excise-tax-july-2026.html` article. No longer requires manual confirmation before sending.

**3. CDTFA district rate changes for LA-area wholesalers — ✅ CONFIRMED (no change)**
Verified 2026-06-24: the most recent CDTFA district rate changes are effective **April 1, 2026** (Special Notice L-1022). No new July 1, 2026 district rate change is announced for LA County. The wholesalers draft's statement ("no new district sales-tax rate changes announced for LA County for July") holds. The draft retains its cautious "verify against CDTFA Special Notices" phrasing.

**4. Blog links — ✅ CONFIRMED (all resolve to real files in repo)**
All internal links verified present in `blog/`:
- /blog/ca-payroll-2026-minimum-wage-sdi.html (general, optometrists) ✅
- /blog/tip-reporting-restaurants-2026.html (restaurants) ✅
- /blog/mid-year-tax-planning-checklist.html (general, law-firms) ✅
- /blog/la-crescenta-glendale-business-tax-map.html (general) ✅
- /blog/california-fuel-excise-tax-july-2026.html (service-stations, newly linked) ✅

**5. `{{UNSUBSCRIBE_URL}}`** — left as-is in all 7 drafts. Justin's send tool fills it. No other `{{ }}` placeholders remain (confirmed).

---

## QA pass

- No unreplaced `{{` placeholders other than `{{UNSUBSCRIBE_URL}}` — confirmed.
- All dates verified against 2026 calendar (weekday names correct).
- No IRS disaster relief currently extending July 2026 deadlines for CA (verified via IRS newsroom, fetched 2026-06-13).
- CA SDI: 1.3%, no wage cap (no change mid-year — verified via EDD).
