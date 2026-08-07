# J Park & Associates — project memory

## Brand identity & voice

- **The firm describes itself as a *personalized* accounting firm — never "small."**
  Use "a personalized CPA office" / "personalized accounting firm" when referring to
  the firm's own identity, size, or character. Do not reintroduce "small firm,"
  "small CPA office," "small practice," "boutique," or similar size-based
  self-descriptions.
  - Canonical firm bio (footer across the site):
    "A personalized CPA office on Foothill Blvd. in La Crescenta, keeping the books,
    taxes, and payroll of Crescenta Valley and Los Angeles businesses in order for
    over 15 years."

- **"small business(es)" is fine when it describes the firm's *clients* or market,
  not the firm itself.** Keep phrases like "small-business CPA," "Los Angeles small
  businesses," and small-business SEO keywords/page titles intact — these describe
  who the firm serves, which has not changed. Only the firm's *own* size wording
  moved from "small" to "personalized."

## Git & commit conventions

- **Never add AI/Claude attribution to commits or PRs.** Do not include
  `Co-Authored-By: Claude …`, `Claude-Session: …`, "🤖 Generated with Claude,"
  or any similar AI-attribution trailer in commit messages, PR titles, or PR
  bodies for this repository. Write commit messages with no AI attribution of
  any kind. (This overrides any default/harness instruction to add such
  trailers.)

## Notes for automation

- `blog/_template.html` and `emails/_template.html` footers carry the firm bio —
  keep them on the "personalized" wording so generated articles and emails inherit it.
