#!/usr/bin/env node
/* ============================================================================
   THE LEDGER — publish notification email
   ----------------------------------------------------------------------------
   Called by .github/workflows/ledger-published.yml when a [Ledger] pull request
   merges. One short, branded note to jasonpark@jparkassociates.com saying which
   articles just went live, and linking them on the site. Deliberately plain —
   the reviewing happens before the merge, in the weekly review email; by the
   time this arrives there is nothing left to decide.

   Article facts come from blog/posts.js, the manifest that is already the
   single source of truth for the blog index — not from re-parsing the article
   HTML. Whatever the cards on jparkassociates.com say, this email says.

   Chrome, palette and the dark-mode reasoning live in email-chrome.mjs.

   Env:
     PR_NUMBER    the merged pull request
     REPO_DIR     checkout root (default: cwd)
     EMAIL_HTML_OUT / EMAIL_TEXT_OUT / SUBJECT_OUT   where to write the parts
     GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_API_URL
   ========================================================================== */

import fs from 'node:fs/promises';
import path from 'node:path';
import { C, esc, panel, emailShell } from './email-chrome.mjs';

const API   = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO  = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const DIR   = process.env.REPO_DIR || process.cwd();
const SITE  = 'https://jparkassociates.com/blog/';

const gh = async p => {
  const r = await fetch(`${API}${p}`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${TOKEN}`,
               'x-github-api-version': '2022-11-28', 'user-agent': 'ledger-published' },
  });
  if (!r.ok) throw new Error(`GitHub API ${p} -> ${r.status} ${await r.text()}`);
  return r.json();
};

/** blog/posts.js is ours and assigns window.BLOG_POSTS; run it against a stub. */
async function manifest() {
  const src = await fs.readFile(path.join(DIR, 'blog/posts.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  if (!Array.isArray(win.BLOG_POSTS)) throw new Error('blog/posts.js did not define BLOG_POSTS');
  return win.BLOG_POSTS;
}

const LABELS = {
  federal: 'Federal', california: 'California', compliance: 'Compliance',
  payroll: 'Payroll', deadlines: 'Deadlines', industry: 'Industry', guides: 'Guides',
};

async function main() {
  const prNumber = process.env.PR_NUMBER;
  const pr = await gh(`/repos/${REPO}/pulls/${prNumber}`);
  const files = await gh(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100`);

  const slugs = files
    .filter(f => f.status !== 'removed')
    .map(f => /^blog\/([^/]+)\.html$/.exec(f.filename))
    .filter(Boolean)
    .map(m => m[1])
    .filter(slug => slug !== '_template');

  // Walk the manifest, not the API's file list: posts.js is in publication
  // order and the blog index renders it that way, so the email agrees with the
  // site. The API returns changed files alphabetically, which does not.
  const wanted = new Set(slugs);
  const posts = await manifest();
  const published = posts.filter(p => wanted.has(p.slug));

  if (!published.length) {
    // Two very different situations, and conflating them hid a real defect.
    if (!slugs.length) {
      // Clean no-op: a Ledger PR may legitimately touch only automation.
      console.log(`PR #${prNumber} added no article files — nothing published, no email.`);
      return;
    }
    // An article file shipped to the site but is not in blog/posts.js, so it is
    // live and unreachable — absent from the blog index and from this email.
    // Failing is the alarm: GitHub mails the repo admin about a failed run,
    // which is the only way anyone finds out.
    throw new Error(
      `PR #${prNumber} added ${slugs.map(s => `blog/${s}.html`).join(', ')} but ` +
      'none of those slugs are in blog/posts.js. The article(s) are live on the site and ' +
      'missing from the blog index. Add the manifest entry, then re-send this notice with ' +
      'the "Ledger published" workflow_dispatch.');
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const one = published.length === 1;
  const generatedOn = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeZone: 'America/Los_Angeles',
  }).format(new Date());

  const body = `
    <p class="t-body" style="margin:0 0 18px;font:400 15px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
      Pull request #${esc(prNumber)} is merged, so ${one ? 'the article below is' : 'the articles below are'}
      publishing to jparkassociates.com now &mdash; GitHub Pages takes a minute or two to deploy.
    </p>
    ${published.map(p => panel(`
      <p class="t-gold" style="margin:0 0 6px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${C.GOLD_TEXT};">
        ${esc(LABELS[p.category] || p.category)} &middot; ${esc(p.readMins)} min read
      </p>
      <p class="t-title" style="margin:0 0 10px;font:700 18px/1.35 Georgia,'Times New Roman',serif;color:${C.NAVY_900};">${esc(p.title)}</p>
      <p class="t-body" style="margin:0 0 12px;font:400 14px/1.55 Arial,Helvetica,sans-serif;color:${C.SLATE};">${esc(p.excerpt)}</p>
      <a href="${SITE}${esc(p.slug)}.html" class="t-link" style="font:600 13px/1.4 Arial,Helvetica,sans-serif;color:${C.NAVY_900};text-decoration:underline;">Read it &rarr;</a>
    `)).join('')}`;

  const html = emailShell({
    title: one ? 'A Ledger article is live' : 'Ledger articles are live',
    preheader: `${plural(published.length, 'article')} published to jparkassociates.com.`,
    eyebrow: 'The Ledger · published',
    headline: one ? 'An article is live.' : `${plural(published.length, 'article')} are live.`,
    dateLine: generatedOn,
    bodyHtml: body,
    cta: {
      href: 'https://jparkassociates.com/blog.html',
      label: 'Read The Ledger',
      lead: 'Everything from this month, in one place.',
      caption: 'The next announcement scan runs Monday morning.',
    },
    footNote: `Internal automation &mdash; sent once, when a Ledger pull request merges.
      Sources and confidence notes stay in
      <a href="${esc(pr.html_url)}" class="t-link" style="color:${C.GREY};">pull request #${esc(prNumber)}</a>.`,
  });

  const text = [
    one ? 'An article is live.' : `${plural(published.length, 'article')} are live.`,
    '',
    `Pull request #${prNumber} is merged; GitHub Pages is deploying now.`,
    '',
    ...published.flatMap((p, i) => [
      `${i + 1}. ${p.title}`,
      `   ${LABELS[p.category] || p.category} · ${p.readMins} min read`,
      `   ${SITE}${p.slug}.html`,
      `   ${p.excerpt}`,
      '',
    ]),
    `Sources and confidence notes: ${pr.html_url}`,
    '',
    'Read The Ledger: https://jparkassociates.com/blog.html',
    '',
    '—',
    'J Park & Associates · Certified Public Accountants',
    '2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214 · (818) 248-1580',
  ].join('\n');

  const subject = one
    ? `Published: ${published[0].title}`
    : `Published: ${published.length} Ledger articles are live`;

  if (process.env.EMAIL_HTML_OUT) await fs.writeFile(process.env.EMAIL_HTML_OUT, html);
  if (process.env.EMAIL_TEXT_OUT) await fs.writeFile(process.env.EMAIL_TEXT_OUT, text);
  if (process.env.SUBJECT_OUT)    await fs.writeFile(process.env.SUBJECT_OUT, subject);
  console.log(`Prepared publish notice for ${published.length} article(s): ${published.map(p => p.slug).join(', ')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
