#!/usr/bin/env node
/* ============================================================================
   THE LEDGER — late correction banner
   ----------------------------------------------------------------------------
   The review email is built minutes before it is sent: npm install, a Chromium
   render, a PDF. A draft can merge or close inside that window, and by the time
   anyone notices, the HTML body, the PDF and the Word note have all been
   written and all say the same now-stale thing — "drafted and ready for your
   review", "not live yet".

   Three ways to handle that, and only one of them is any good:

     • Send it anyway. The reader is told an article is awaiting review when
       ledger-published.yml has just announced it live.
     • Suppress the email. The drafts that DID survive lose their slot, and on
       the Monday floor run there is no later trigger to recover them — a whole
       week of no review, from one well-timed merge.
     • Say so, at the top, in the reader's own view. That is this file.

   A note in the text/plain alternative is not enough: Gmail renders the HTML
   part, so a correction that lives only in the plain-text body is a correction
   essentially nobody sees. The builder leaves an invisible <!--ledger:notice-->
   marker at the top of the body card and this replaces it with a branded
   callout. Nothing to replace, nothing changes — an HTML comment renders as
   nothing at all.

   Env:
     EMAIL_HTML  the file to amend, in place
     NOTICE      the sentence to show; empty or unset is a no-op
   ========================================================================== */

import fs from 'node:fs/promises';
import { C, esc, callout } from './email-chrome.mjs';

export const NOTICE_MARKER = '<!--ledger:notice-->';

export function injectNotice(html, notice) {
  if (!notice || !notice.trim()) return html;
  const banner = callout('Since this email was prepared', `
        <p class="t-body" style="margin:0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
          ${esc(notice.trim())}
        </p>`, C.GOLD_RULE);
  let out = html.includes(NOTICE_MARKER)
    ? html.replace(NOTICE_MARKER, () => banner)
    // No marker means an older or degraded body. Put it directly after the
    // opening body tag rather than dropping the correction on the floor.
    : html.replace(/(<body[^>]*>)/i, (m) => `${m}\n${banner}`);

  /* The inbox row is the part the reader sees FIRST, and it is the part a
     correction inside the body cannot reach. The preheader is what Gmail shows
     next to the subject, so it gets the same news — otherwise the preview still
     reads "2 Ledger articles drafted and waiting" about a draft that is live. */
  out = out.replace(/(<span id="ledger-preheader">)(.*?)(<\/span>)/s,
                    (_, open, _old, close) => `${open}${esc(notice.trim())}${close}`);
  return out;
}

async function main() {
  const path = process.env.EMAIL_HTML;
  const notice = process.env.NOTICE || '';
  // Empty rather than unset is the real case: the builder failed, so the
  // workflow's `html=` output is blank. A stack trace helps nobody — the
  // correction still rides in the plain-text part.
  if (!path) {
    console.log('::warning::No HTML body was built; the correction rides in the plain-text part only.');
    return;
  }
  if (!notice.trim()) { console.log('No late correction to add.'); return; }

  let html;
  try {
    html = await fs.readFile(path, 'utf8');
  } catch {
    console.log(`::warning::${path} is not on disk; the correction rides in the plain-text part only.`);
    return;
  }
  await fs.writeFile(path, injectNotice(html, notice));
  console.log(`Added a correction banner to ${path}: ${notice.trim()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
