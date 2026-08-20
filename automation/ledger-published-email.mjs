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

/** Every page, not just the first. A PR over 100 files would otherwise look
    like it published nothing at all, send nothing, and pass. */
async function ghPaged(pathname) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await gh(`${pathname}?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  console.log('::warning::Stopped paginating the PR file list at 2000 files.');
  return all;
}

/** Is this file one of ours — an article rendered from blog/_template.html?
    The template's body is `<main class="article-body">`, and nothing else under
    blog/ carries that class. Without the check, a hub or landing page added
    under blog/ looks like an orphaned article and fails the run for nothing. */
async function isArticle(slug) {
  try {
    const html = await fs.readFile(path.join(DIR, 'blog', `${slug}.html`), 'utf8');
    /* Tolerant of how the class ATTRIBUTE is written, exact about the class
       NAME. The template emits `class="article-body"`, but this file is
       hand-edited by the scan agent every run, and `class='article-body'` or
       `class = "article-body"` used to fail the test — which does not just skip
       the announcement, it drops the slug before the orphan alarm below can see
       it, so a live article goes unmentioned by a green run.
       \b is the wrong tool for the name: it treats a hyphen as a boundary, so
       `article-body-preview` matched. That broke the check in BOTH directions —
       a hub page carrying `class="article-body-wide"` was announced as an
       article, and, if it was not in the manifest, the orphan alarm threw and
       suppressed the notice for the real article merged alongside it. Split the
       attribute on whitespace and compare tokens, which is what the browser
       does. */
    /* The ATTRIBUTE NAME has to be exactly `class`, case-insensitively.
       \bclass matched data-class=, ng-class= and :class= — any of which on a
       hub page makes it an "article", and if that page is not in the manifest
       the orphan alarm throws and suppresses the notice for the real article
       merged beside it. And without the i flag, `Class=` — legal HTML, and this
       file is hand-edited every run — failed the test, which drops the slug
       before the alarm can see it and leaves a live article unmentioned by a
       green run. Both directions, one regex. */
    /* Comments, scripts and templates are not markup the browser applies. A hub
       page whose comment merely MENTIONS `<main class="article-body">` — the
       natural way to explain what it is not — was read as an article; if it was
       not in the manifest the orphan alarm threw and suppressed the notice for
       the real article merged beside it. Stripped before the attribute scan. */
    const live = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
    const m = live.match(/(?:^|[\s"'\/])class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi) || [];
    return m.some(a => {
      const v = a.replace(/^[^=]*=\s*/, '').replace(/^["']|["']$/g, '');
      return v.split(/\s+/).includes('article-body');
    });
  } catch {
    /* UNREADABLE IS NOT "NOT AN ARTICLE". Returning false dropped the slug
       before the orphan alarm below could see it, so an added blog/*.html that
       the checkout does not have — a dispatch re-send after the base branch
       moved on, or a merge race — was live, unannounced, and the run was green.
       Treated as an article instead: the manifest then decides. In it, it is
       announced; missing from it, the alarm fires and someone finds out. */
    console.log(`::warning::blog/${slug}.html is not in the checkout; the manifest decides whether it is an article.`);
    return true;
  }
}

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
  const files = await ghPaged(`/repos/${REPO}/pulls/${prNumber}/files`);

  /* NEWLY published only. 'modified' is a correction to an article that went
     live weeks ago; announcing "it's live" again is a duplicate notice about
     old news. A rename gives the article a new URL, so that one does count.

     'copied' counts too, and leaving it out was a silent miss: GitHub reports
     'copied' when git's copy detection matches a NEW file against an existing
     one, which is exactly the shape of a new article rendered from
     blog/_template.html or written from a sibling. Pages serves the file
     whichever word the API used, so the article was live, unannounced, and the
     orphan alarm below never fired either — the slug had already been dropped.

     'changed' is NOT in this set. It is a typechange on a path that already
     exists — a symlink becoming a regular file — so the article was live long
     before this pull request, and announcing it is the same duplicate that
     keeps 'modified' out. */
  const NEW = new Set(['added', 'renamed', 'copied']);
  const candidates = files
    .filter(f => NEW.has(f.status))
    .map(f => /^blog\/([^/]+)\.html$/.exec(f.filename))
    .filter(Boolean)
    .map(m => m[1])
    .filter(slug => slug !== '_template');

  const slugs = [];
  for (const slug of candidates) if (await isArticle(slug)) slugs.push(slug);

  // Walk the manifest, not the API's file list: posts.js is in publication
  // order and the blog index renders it that way, so the email agrees with the
  // site. The API returns changed files alphabetically, which does not.
  const wanted = new Set(slugs);
  const posts = await manifest();
  /* One entry per slug. blog/posts.js is hand-prepended by the scan agent, and
     a slug listed twice there had its article announced twice in the same
     notice — "3 Ledger articles are live" for two files. The first entry wins,
     which is the one the blog index shows first. */
  const seen = new Set();
  const published = posts.filter(p => wanted.has(p.slug) && !seen.has(p.slug) && seen.add(p.slug));

  // Clean no-op: a Ledger PR may legitimately touch only automation, or only
  // correct an article that is already live.
  if (!slugs.length) {
    console.log(`PR #${prNumber} added no new article files — nothing published, no email.`);
    return;
  }

  // EVERY added article must be in the manifest, not merely one of them.
  // Gating on `!published.length` missed the case that actually happens: the
  // scan drafts two articles and prepends only one posts.js entry, so the
  // second is live, absent from the index, absent from this email — green run.
  const listed = new Set(published.map(p => p.slug));
  const orphans = slugs.filter(slug => !listed.has(slug));
  /* THE ALARM DOES NOT COST THE NOTICE. Throwing here meant an orphan took the
     announcement of every article merged beside it — articles that are live,
     indexed, and now unmentioned — because the reviewer's own email never got
     built. The notice for what IS announceable is written first, and the run
     fails afterwards; GitHub mails the repo admin about a failed run, which is
     how anyone finds out an article shipped unreachable. */
  const orphanError = orphans.length
    ? `PR #${prNumber} added ${orphans.map(s => `blog/${s}.html`).join(', ')}, ` +
      `${orphans.length === 1 ? 'which is' : 'which are'} live on the site but missing from ` +
      `blog/posts.js — nothing links to ${orphans.length === 1 ? 'it' : 'them'}, and the blog ` +
      `index does not list ${orphans.length === 1 ? 'it' : 'them'}. Add the manifest entries, ` +
      'then re-send this notice with the "Ledger published" workflow_dispatch.'
    : '';
  if (orphanError && !published.length) throw new Error(orphanError);

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
        ${[esc(LABELS[p.category] || p.category), p.readMins ? `${esc(p.readMins)} min read` : '']
            .filter(Boolean).join(' &middot; ')}
      </p>
      <p class="t-title" style="margin:0 0 10px;font:700 18px/1.35 Georgia,'Times New Roman',serif;color:${C.NAVY_900};">${esc(p.title || p.slug)}</p>
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
    /* Never `${p.field}` straight into the text part: the HTML part runs every
       field through esc(), which turns a missing one into an empty string,
       while the plain-text part printed a literal "undefined" — including in
       the subject line, as "Published: undefined". The two alternatives of one
       message have to say the same thing, and neither may show a placeholder. */
    ...published.flatMap((p, i) => [
      `${i + 1}. ${p.title || p.slug}`,
      // A manifest entry missing readMins printed a literal "undefined min read"
      // in the plain-text part while the HTML part printed nothing — the two
      // alternatives of one message disagreeing.
      `   ${[LABELS[p.category] || p.category, p.readMins ? `${p.readMins} min read` : '']
             .filter(Boolean).join(' · ')}`,
      `   ${SITE}${p.slug}.html`,
      ...(p.excerpt ? [`   ${p.excerpt}`] : []),
      '',
    ]),
    `Sources and confidence notes: ${pr.html_url}`,
    '',
    'Read The Ledger: https://jparkassociates.com/blog.html',
    '',
    '—',
    'J Park & Associates · Certified Public Accountants',
    '2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214 · (818) 248-1580',
    // The HTML part carries the firm bio; without it here the two alternatives
    // of one message have different footers.
    'A personalized CPA office on Foothill Blvd. in La Crescenta, keeping the books,',
    'taxes, and payroll of Crescenta Valley and Los Angeles businesses in order for',
    'over 15 years.',
  ].join('\n');

  const subject = one
    ? `Published: ${published[0].title || published[0].slug}`
    : `Published: ${published.length} Ledger articles are live`;

  if (process.env.EMAIL_HTML_OUT) await fs.writeFile(process.env.EMAIL_HTML_OUT, html);
  if (process.env.EMAIL_TEXT_OUT) await fs.writeFile(process.env.EMAIL_TEXT_OUT, text);
  if (process.env.SUBJECT_OUT)    await fs.writeFile(process.env.SUBJECT_OUT, subject);
  console.log(`Prepared publish notice for ${published.length} article(s): ${published.map(p => p.slug).join(', ')}`);
  // Written, then the alarm. The workflow sends what was built and fails after.
  if (orphanError) throw new Error(orphanError);
}

main().catch(err => { console.error(err); process.exit(1); });
