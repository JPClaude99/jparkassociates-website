# The Monthly Close — sending (Brevo)

`automation/send.mjs` turns the rendered per-segment drafts into **scheduled
Brevo campaigns**, one per active segment. It replaces the old manual
copy-into-Gmail step.

**Dry run is the default. Nothing is created or sent unless you pass `--send`
and provide `BREVO_API_KEY`.**

## How it works

For the target month it reads `emails/segments.json`, and for each **active**
segment loads `emails/drafts/<YYYY-MM>/<segment-id>.html`, extracts the subject
from `<title>`, validates it, and plans a Brevo "classic" campaign targeting
that segment's Brevo list, scheduled for the send date.

Validation (fails the run if any error):
- draft file exists for every active segment
- a subject (`<title>`) is present
- no unrendered `{{PLACEHOLDER}}` remains (only `{{UNSUBSCRIBE_URL}}` is allowed,
  and it is rewritten to Brevo's managed `{{ unsubscribe }}` tag)

## Usage

```bash
node automation/send.mjs                  # dry run, next month (default)
node automation/send.mjs --month=2026-07  # dry run, explicit month
node automation/send.mjs --month=2026-07 --date=2026-06-29 --time=09:00
node automation/send.mjs --month=2026-07 --send   # LIVE — needs BREVO_API_KEY
```

Default schedule is the 1st of the target month at `sendTime` in `timezone`
(both from `brevo.config.json`). Override per run with `--date` / `--time`.

## Config

`automation/brevo.config.json` (committed, **non-secret**): sender, reply-to,
timezone, send time, and the segment → Brevo list-id map.

`BREVO_API_KEY` (secret): from the environment, never committed. In CI it lives
in repo **Settings → Secrets and variables → Actions**.

## Go-live checklist (Phase 2)

1. Create the Brevo account; authenticate `jparkassociates.com`
   (SPF/DKIM/DMARC) and set a real `sender`/`replyTo` on that domain.
2. Create one Brevo list per active segment; paste each numeric id into
   `lists` in `brevo.config.json`.
3. Import contacts and assign each to its segment list.
4. Add `BREVO_API_KEY` as a GitHub Actions secret.
5. Watch a green dry run for the month (`.github/workflows/monthly-email-send.yml`
   runs it on every PR that touches the drafts).
6. Enable the commented `schedule-live` job in that workflow.

## CI

`.github/workflows/monthly-email-send.yml` runs the dry run on every PR that
touches the drafts, and on manual dispatch (with an optional `month` input).
The live job is present but commented out and inert until Phase 2.
