#!/usr/bin/env node
/* ============================================================================
   THE LEDGER — draft review PDF builder
   ----------------------------------------------------------------------------
   Called by .github/workflows/ledger-draft-alert.yml. For every open, unmerged
   [Ledger] pull request it renders the drafted article(s) as they will read on
   the site, and follows each one with a REVIEWER NOTES panel drawn from that
   article's section of the PR body.

   It writes TWO things: the PDF packet, and the branded HTML body of the weekly
   review email — which carries a full copy of each draft, not a list of
   headlines, so the article can be read in the inbox. Both come from the same
   extraction pass, so the email and the packet cannot describe different
   articles.

   The notes panel is deliberately styled apart from the article: cream ground,
   sans-serif headings (articles use the Playfair serif), a navy rule and an
   explicit "not for publication" label. Same design language, unmistakably not
   article copy.

   PR-body contract (see automation/PIPELINE.md Step 7). Per-article notes are
   bound to a file by the backticked path the scan agent writes under each
   numbered heading:

       ## 1. <article title>
       `blog/<slug>.html` · category `deadlines` · 5 min
       **Source** ...

   Any `##` section without such a path (Confidence notes, Also noticed,
   Upcoming) is collected into a single RUN NOTES panel at the end. If nothing
   binds, the whole body lands there instead — the PDF degrades, never fails.

   Env:
     DRAFTS_JSON  path to a JSON array of PRs: {number,title,html_url,body,
                  head:{sha,ref},created_at}
     OUT_PATH        where to write the PDF
     EMAIL_HTML_OUT  optional; write the branded HTML email body here
     DOCX_PATH       optional; the Word review note, if the earlier step built
                     one. Only read, never written — its presence decides
                     whether the email names it as an enclosure.
     HTML_OUT        optional; also dump the intermediate HTML for debugging
     GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_API_URL
   ========================================================================== */

import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { marked } from 'marked';
import { C, esc, panel, callout, emailShell,
         draftArticleHtml, GMAIL_CLIP_BYTES } from './email-chrome.mjs';
import { parseNotes, ageLabel, generatedOn as todayLong } from './ledger-notes.mjs';

const API   = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO  = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT   = process.env.OUT_PATH || 'ledger-drafts.pdf';
const SITE  = 'https://jparkassociates.com/blog/';

marked.setOptions({ gfm: true, breaks: false });

/* ---------- GitHub ------------------------------------------------------- */

async function gh(pathname, accept = 'application/vnd.github+json') {
  const res = await fetch(`${API}${pathname}`, {
    headers: {
      accept,
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ledger-draft-alert',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${pathname} -> ${res.status} ${await res.text()}`);
  }
  return res;
}

async function prArticleFiles(number) {
  const files = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await (await gh(`/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`)).json();
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files
    .filter(f => f.status !== 'removed')
    .filter(f => /^blog\/[^/]+\.html$/.test(f.filename))
    .filter(f => !f.filename.endsWith('/_template.html'))
    .map(f => f.filename);
}

const fileAtRef = (path, ref) =>
  gh(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${ref}`, 'application/vnd.github.raw')
    .then(r => r.text());

/* ---------- PR body -> notes --------------------------------------------- */

/* parseNotes() moved to ./ledger-notes.mjs — the Word review note builder
   parses the same PR bodies and the two must never disagree about which notes
   belong to which article. */

/* ---------- article extraction ------------------------------------------- */

async function extractArticle(page, html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page.evaluate((base) => {
    const hero = document.querySelector('.article-hero');
    const body = document.querySelector('.article-body .container-narrow');
    if (!body) return null;

    for (const el of body.querySelectorAll('a[href]')) {
      try { el.setAttribute('href', new URL(el.getAttribute('href'), base).href); } catch { /* leave as-is */ }
    }
    for (const el of body.querySelectorAll('img[src]')) {
      try { el.setAttribute('src', new URL(el.getAttribute('src'), base).href); } catch { /* leave as-is */ }
    }

    const txt = (sel, root = hero) => {
      const el = root && root.querySelector(sel);
      return el ? el.textContent.trim() : '';
    };
    const meta = hero && hero.querySelector('.post-meta');
    const extra = meta
      ? [...meta.querySelectorAll('span')]
          .filter(s => !s.classList.contains('dot') && !s.classList.contains('src-tag'))
          .map(s => s.textContent.trim())
          .filter(Boolean)
      : [];

    /* ---- article body -> normalized blocks, for the email --------------
       The email carries a full copy of the draft, so the article body has to
       cross from site markup into mail-client markup. Doing it here, against
       a real DOM, means no regex ever parses HTML — and the block list that
       comes out carries only whitelisted inline tags, so nothing from the
       site's stylesheet or scripts can ride along into the inbox.
       Rendering of these blocks lives in email-chrome.mjs. ---------------- */
    const escHtml = t => String(t).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // Inline level: keep emphasis and links, unwrap everything else to text.
    const inline = (node) => {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { out += escHtml(n.nodeValue); continue; }
        if (n.nodeType !== 1) continue;
        switch (n.tagName) {
          case 'BR':     out += '<br />'; break;
          case 'A':      out += `<a class="t-link" href="${escHtml(n.getAttribute('href') || '')}" style="color:#1B2A4A;text-decoration:underline;">${inline(n)}</a>`; break;
          case 'STRONG':
          case 'B':      out += `<strong class="t-strong" style="color:#1B2A4A;font-weight:700;">${inline(n)}</strong>`; break;
          case 'EM':
          case 'I':      out += `<em>${inline(n)}</em>`; break;
          case 'CODE':   out += `<code style="font-family:Consolas,Menlo,monospace;font-size:13px;">${inline(n)}</code>`; break;
          case 'SUP':    out += `<sup>${inline(n)}</sup>`; break;
          case 'SUB':    out += `<sub>${inline(n)}</sub>`; break;
          case 'SCRIPT':
          case 'STYLE':  break;
          default:       out += inline(n);   // span, and anything unexpected
        }
      }
      return out;
    };

    const items = el => {
      const list = el && el.querySelector('ul, ol');
      return list ? [...list.children].filter(li => li.tagName === 'LI').map(inline) : [];
    };

    const blocksOf = (root) => {
      const out = [];
      for (const el of root.children) {
        const cls = el.classList;
        switch (el.tagName) {
          case 'P':
            out.push(cls.contains('disclaimer')
              ? { kind: 'disclaimer', html: inline(el) }
              : { kind: 'p', html: inline(el) });
            break;
          case 'H1':
          case 'H2': out.push({ kind: 'h2', text: el.textContent.trim() }); break;
          case 'H3':
          case 'H4': out.push({ kind: 'h3', text: el.textContent.trim() }); break;
          case 'UL':
          case 'OL':
            out.push({ kind: 'list', ordered: el.tagName === 'OL',
                       items: [...el.children].filter(li => li.tagName === 'LI').map(inline) });
            break;
          case 'BLOCKQUOTE':
            out.push({ kind: 'callout', label: '', blocks: blocksOf(el) });
            break;
          case 'FIGURE': case 'IMG': case 'SCRIPT': case 'STYLE': case 'HR':
            break;                                   // no images in the packet
          case 'DIV': case 'SECTION': case 'ASIDE': {
            if (cls.contains('callout')) {
              const label = el.querySelector('.label');
              const inner = el.cloneNode(true);
              const stray = inner.querySelector('.label');
              if (stray) stray.remove();
              out.push({ kind: 'callout', label: label ? label.textContent.trim() : '',
                         blocks: blocksOf(inner) });
            } else if (cls.contains('action-list')) {
              const h = el.querySelector('h2, h3, h4');
              out.push({ kind: 'action', heading: h ? h.textContent.trim() : '', items: items(el) });
            } else if (cls.contains('sources-box')) {
              const label = el.querySelector('.label');
              out.push({ kind: 'sources', label: label ? label.textContent.trim() : 'Sources',
                         items: items(el) });
            } else {
              out.push(...blocksOf(el));             // unknown wrapper: descend
            }
            break;
          }
          default: {
            if (el.textContent.trim()) out.push({ kind: 'p', html: inline(el) });
          }
        }
      }
      return out;
    };

    return {
      title:    txt('h1') || document.title.replace(/\s*\|.*$/, ''),
      category: txt('.cat'),
      source:   txt('.src-tag', meta || document),
      date:     txt('time', meta || document),
      dateIso:  (meta && meta.querySelector('time') && meta.querySelector('time').getAttribute('datetime')) || '',
      readTime: extra.join(' · '),
      bodyHtml: body.innerHTML,
      blocks:   blocksOf(body),
    };
  }, SITE);
}

/* ---------- rendering ---------------------------------------------------- */

const notesPanel = (kind, label, heading, innerHtml) => `
  <aside class="notes ${kind}">
    <div class="notes-head">
      <span class="notes-label">${esc(label)}</span>
      <h3>${esc(heading)}</h3>
    </div>
    <div class="notes-body">${innerHtml}</div>
  </aside>`;

/* ---------- branded HTML email body -------------------------------------- */

/* Chrome, palette and the dark-mode reasoning all live in email-chrome.mjs so
   the weekly review and the publish notice cannot drift apart. Read the header
   note there before changing a colour. */
/**
 * The weekly review email.
 *
 * It carries a full, readable copy of every drafted article — not a list of
 * headlines — so the article can be judged in the inbox. The PDF packet and the
 * Word review note ride along as attachments for anyone who would rather read
 * or annotate offline.
 *
 * @param {Array}  prs          PRs with .articles (may be empty on the first pass)
 * @param {string} generatedOn  long date line
 * @param {{pdf:boolean, docx:boolean}} att  which attachments made it
 * @param {number} fullCount    how many articles to print in full (rest listed)
 */
function buildEmailHtml(prs, generatedOn, att, fullCount = Infinity) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // The body is written once before the render work (which can fail) and again
  // after it succeeds. On that first pass there is no article data yet, so
  // nothing may claim a count it does not have — this is what produced the
  // "0 drafts, written and waiting." headline.
  const all = prs.flatMap(pr => pr.articles.map(a => ({ ...a, pr })));
  const counted = all.length > 0;

  const headline  = counted ? `${plural(all.length, 'draft')} ready for review.`
                            : 'Drafts ready for review.';
  const preheader = counted
    ? `${plural(all.length, 'Ledger article')} drafted and waiting — the full text is below.`
    : 'Ledger drafts are written and waiting — merging publishes them.';
  const intro = counted
    ? `${all.length === 1 ? 'One article is' : `${all.length} articles are`} drafted and ready for your review.
       ${all.length === 1 ? 'It is' : 'They are'} reproduced in full below, exactly as ${all.length === 1 ? 'it' : 'they'} will read on
       jparkassociates.com. Merging the pull request is what publishes ${all.length === 1 ? 'it' : 'them'}.`
    : `${plural(prs.length, 'pull request')} drafted but not yet live on jparkassociates.com.
       Merging is what publishes the articles inside.`;

  // What actually made it onto the message. Never promise an attachment that
  // failed to build — the reviewer would go looking for a file that isn't there.
  const enclosures = [
    att.pdf  && ['ledger-drafts.pdf',
                 'each draft laid out as it will read on the site, with a reviewer-notes panel after it.'],
    att.docx && ['Ledger-review-notes.docx',
                 'the reviewer notes on their own — sources, reasoning and anything the scan hedged on — in Word, ready to mark up.'],
  ].filter(Boolean);

  const aside = enclosures.length
    ? callout('Attached', enclosures.map(([name, what]) => `
        <p class="t-body" style="margin:0 0 8px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
          <strong class="t-strong" style="color:${C.NAVY_900};">${esc(name)}</strong> &mdash; ${what}
        </p>`).join('') + `
        <p class="t-muted" style="margin:6px 0 0;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:${C.GREY};">
          Read either one anywhere; no GitHub needed.
        </p>`)
    : callout('', `
        <p class="t-body" style="margin:0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
          Neither the PDF packet nor the Word review note could be built this run &mdash; see the Actions log.
          The full article text below is unaffected; review the pull request directly for the notes.
        </p>`, C.GREY);

  // Source line for each PR, then its articles in full.
  const prHeader = pr => panel(`
      <p class="t-gold" style="margin:0 0 6px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${C.GOLD_TEXT};">
        PR #${esc(pr.number)} &middot; open ${esc(pr.age)} &middot; ${esc(pr.head && pr.head.ref || '')}
      </p>
      <p class="t-title" style="margin:0 0 12px;font:700 17px/1.35 Georgia,'Times New Roman',serif;color:${C.NAVY_900};">${esc(pr.title)}</p>
      <a href="${esc(pr.html_url)}" class="t-link" style="font:600 13px/1.4 Arial,Helvetica,sans-serif;color:${C.NAVY_900};text-decoration:underline;">Review and merge on GitHub &rarr;</a>
    `);

  let printed = 0;
  const overflow = [];
  const body = `
    <p class="t-body" style="margin:0 0 18px;font:400 15px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">${intro}</p>
    ${aside}
    ${prs.map(pr => prHeader(pr) + pr.articles.map((a, i) => {
      if (printed >= fullCount) { overflow.push(a); return ''; }
      printed++;
      return draftArticleHtml(a, { index: i + 1, total: pr.articles.length, prNumber: pr.number });
    }).join('')).join('')}
    ${overflow.length ? callout('Not shown here', `
      <p class="t-body" style="margin:0 0 8px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${plural(overflow.length, 'further draft')} would have pushed this message past the size at which
        Gmail truncates it. ${overflow.length === 1 ? 'It is' : 'They are'} in the attached PDF in full:
      </p>
      <ul class="t-body" style="margin:0;padding-left:20px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${overflow.map(a => `<li style="margin:0 0 5px;">${esc(a.title)}</li>`).join('')}
      </ul>`, C.GREY) : ''}`;

  return emailShell({
    title: 'Ledger drafts ready for review',
    preheader,
    eyebrow: 'The Ledger · weekly draft review',
    headline,
    dateLine: generatedOn,
    bodyHtml: body,
    cta: {
      href: prs[0].html_url,
      label: 'Open the pull request',
      lead: 'Happy with it?',
      caption: 'Merging deploys to jparkassociates.com automatically.',
    },
    footNote: `Internal automation &mdash; sent Monday mornings while a Ledger draft is awaiting review.<br />
      <a href="https://github.com/${esc(REPO)}/blob/main/.github/workflows/ledger-draft-alert.yml" class="t-link" style="color:${C.GREY};">ledger-draft-alert.yml</a>`,
  });
}

/**
 * Render the email, shrinking it until Gmail will not clip it.
 *
 * Gmail hides everything past ~102 KB behind a "View entire message" link. A
 * clipped review email is a review email that does not get read, so when the
 * drafts are long the later ones drop to a one-line entry and stay whole in the
 * attached PDF. A single article that blows the budget on its own is still sent
 * complete — clipping one long draft beats sending half of it.
 */
function fitEmailHtml(prs, generatedOn, att) {
  const total = prs.reduce((n, pr) => n + pr.articles.length, 0);
  for (let full = total; full >= 1; full--) {
    const html = buildEmailHtml(prs, generatedOn, att, full);
    if (Buffer.byteLength(html) <= GMAIL_CLIP_BYTES || full === 1) {
      if (full < total) {
        console.log(`::warning::Email body too large for ${total} full drafts; printed ${full} in full, ` +
                    `the rest are listed and remain complete in the PDF.`);
      }
      if (Buffer.byteLength(html) > GMAIL_CLIP_BYTES) {
        console.log(`::warning::Email body is ${Math.round(Buffer.byteLength(html) / 1024)} KB even with a single ` +
                    'draft in full; Gmail may clip it. Sent whole rather than truncated.');
      }
      return html;
    }
  }
  return buildEmailHtml(prs, generatedOn, att, 0);
}

function buildHtml(prs, generatedOn) {
  const totalArticles = prs.reduce((n, pr) => n + pr.articles.length, 0);

  const cover = `
  <section class="cover">
    <span class="cover-eyebrow">J Park &amp; Associates</span>
    <h1>The Ledger</h1>
    <p class="cover-sub">Draft articles awaiting your review</p>
    <p class="cover-date">${esc(generatedOn)}</p>
    <div class="cover-index">
      <span class="notes-label">In this packet</span>
      <ol>
        ${prs.map(pr => `
          <li>
            <strong>${esc(pr.title)}</strong>
            <span class="cover-pr">PR #${pr.number} &middot; branch <code>${esc(pr.head.ref)}</code> &middot; open ${esc(pr.age)}</span>
            <ul>${pr.articles.map(a => `<li>${esc(a.title)}</li>`).join('')}</ul>
            <span class="cover-pr"><a href="${esc(pr.html_url)}">${esc(pr.html_url)}</a></span>
          </li>`).join('')}
      </ol>
    </div>
    <p class="cover-foot">
      ${totalArticles} article${totalArticles === 1 ? '' : 's'} across
      ${prs.length} pull request${prs.length === 1 ? '' : 's'}.
      Merging a pull request is what publishes its articles to jparkassociates.com.
      Reviewer notes follow each draft on a cream ground &mdash; those are for you, not for print.
    </p>
  </section>`;

  const drafts = prs.map(pr => pr.articles.map((a, i) => `
    <article class="draft">
      <header class="draft-hero">
        <span class="draft-origin">PR #${esc(pr.number)} &middot; draft ${i + 1} of ${pr.articles.length} &middot; <code>${esc(a.path)}</code></span>
        ${a.category ? `<span class="cat">${esc(a.category)}</span>` : ''}
        <h1>${esc(a.title)}</h1>
        <div class="draft-meta">
          ${[a.source, a.date, a.readTime].filter(Boolean).map(esc).join(' &middot; ')}
        </div>
      </header>
      <div class="draft-body">${a.bodyHtml}</div>
      ${a.notesMd
        ? notesPanel('notes-article', 'Reviewer notes — not for publication', a.title, marked.parse(a.notesMd))
        : notesPanel('notes-article notes-empty', 'Reviewer notes — not for publication', a.title,
            '<p>No per-article notes were found in the pull request body for this draft. ' +
            'Check the pull request directly before merging.</p>')}
    </article>`).join('')).join('');

  const general = prs.flatMap(pr =>
    pr.general.length
      ? [notesPanel('notes-run', 'Run notes — not for publication', `PR #${pr.number}`,
          pr.general.map(s => `<h4>${esc(s.title)}</h4>${marked.parse(s.md)}`).join(''))]
      : []).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>The Ledger — draft review</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,900;1,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --navy-900:#1B2A4A; --navy-950:#111c33; --navy-700:#2E4A7A;
    --gold-500:#C9A84C; --gold-300:#e0c87e;
    --cream-50:#F5F0E8; --slate-600:#3A4660; --grey-500:#5C6577; --white:#fff;
    --serif:"Playfair Display",Georgia,serif;
    --sans:"Inter","Liberation Sans",Arial,sans-serif;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:var(--sans); font-size:10.5pt; line-height:1.55; color:var(--slate-600); background:var(--white); }
  h1,h2,h3 { font-family:var(--serif); color:var(--navy-900); font-weight:700; }
  a { color:var(--navy-700); text-decoration:underline; text-decoration-color:var(--gold-500); text-underline-offset:2px; }
  code { font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace; font-size:0.86em; }

  /* ---------- cover ---------- */
  .cover { background:var(--navy-950); color:var(--cream-50); padding:26mm 18mm; min-height:100vh; }
  .cover-eyebrow { font-size:8pt; font-weight:600; letter-spacing:.26em; text-transform:uppercase; color:var(--gold-500); }
  .cover h1 { font-family:var(--serif); font-size:40pt; color:var(--cream-50); margin:6mm 0 2mm; line-height:1.05; }
  .cover-sub { font-size:13pt; color:rgba(245,240,232,.78); }
  .cover-date { font-size:9.5pt; color:rgba(245,240,232,.55); margin-top:1mm; }
  .cover-index { margin-top:14mm; border-top:1px solid rgba(245,240,232,.22); padding-top:6mm; }
  .cover-index .notes-label { color:var(--gold-500); }
  .cover-index ol { margin:4mm 0 0 5mm; color:var(--cream-50); }
  .cover-index > ol > li { margin-bottom:5mm; }
  .cover-index ul { margin:1.5mm 0 0 5mm; color:rgba(245,240,232,.8); font-size:9.5pt; }
  .cover-index strong { color:var(--cream-50); font-weight:600; }
  .cover-index a { color:var(--gold-300); }
  .cover-pr { display:block; font-size:8.5pt; color:rgba(245,240,232,.55); margin-top:.8mm; }
  .cover-pr code { color:rgba(245,240,232,.7); }
  .cover-foot { margin-top:12mm; font-size:9pt; color:rgba(245,240,232,.6); max-width:118mm; }

  /* ---------- article ---------- */
  .draft { break-before:page; }
  .draft-hero { background:var(--navy-950); color:var(--cream-50); padding:14mm 14mm 12mm; }
  .draft-origin { display:block; font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:rgba(245,240,232,.5); margin-bottom:4mm; }
  .draft-origin code { text-transform:none; letter-spacing:0; color:rgba(245,240,232,.66); }
  .draft-hero .cat { display:inline-block; font-size:8pt; font-weight:600; letter-spacing:.24em; text-transform:uppercase; color:var(--gold-500); margin-bottom:3mm; }
  .draft-hero h1 { font-size:23pt; line-height:1.18; color:var(--cream-50); }
  .draft-meta { margin-top:4mm; font-size:9pt; color:rgba(245,240,232,.62); }

  .draft-body { padding:10mm 14mm 4mm; max-width:170mm; }
  .draft-body p { margin-bottom:1.3em; }
  .draft-body h2 { font-size:14pt; margin:1.6em 0 .6em; break-after:avoid; }
  .draft-body h3 { font-size:11.5pt; margin:1.4em 0 .5em; break-after:avoid; }
  .draft-body ul, .draft-body ol { margin:0 0 1.3em 1.2em; }
  .draft-body li { margin-bottom:.42em; }
  .draft-body strong { color:var(--navy-900); font-weight:600; }

  .draft-body .callout {
    background:var(--white); border:1pt solid rgba(27,42,74,.12); border-left:3pt solid var(--gold-500);
    border-radius:3mm; padding:6mm; margin:6mm 0; break-inside:avoid;
  }
  .draft-body .callout .label,
  .draft-body .sources-box .label {
    display:block; font-size:7.5pt; font-weight:600; letter-spacing:.24em; text-transform:uppercase; margin-bottom:2.5mm;
  }
  .draft-body .callout .label { color:var(--gold-500); }
  .draft-body .callout p:last-child { margin-bottom:0; }

  .draft-body .action-list { background:var(--navy-900); border-radius:3mm; padding:7mm; margin:6mm 0; break-inside:avoid; }
  .draft-body .action-list h2, .draft-body .action-list h3 { color:var(--gold-300); margin:0 0 3mm; font-size:11.5pt; }
  .draft-body .action-list ul { list-style:none; margin:0; }
  .draft-body .action-list li { position:relative; padding-left:6mm; color:rgba(245,240,232,.9); margin-bottom:2mm; }
  .draft-body .action-list li::before { content:"\\2713"; position:absolute; left:0; top:0; font-family:var(--serif); font-weight:700; color:var(--gold-500); }
  .draft-body .action-list a { color:var(--gold-300); }

  .draft-body .sources-box { border-top:.75pt solid rgba(27,42,74,.16); margin-top:8mm; padding-top:4mm; }
  .draft-body .sources-box .label { color:var(--grey-500); }
  .draft-body .sources-box ul { list-style:none; margin:0; }
  .draft-body .sources-box li { margin-bottom:1.5mm; font-size:9pt; word-break:break-word; }
  .draft-body .disclaimer { margin-top:5mm; font-size:8.5pt; font-style:italic; color:var(--grey-500); }

  /* ---------- reviewer notes: same language, unmistakably not the article ---------- */
  .notes {
    background:var(--cream-50);
    border-top:2.5pt solid var(--navy-700);
    border-left:4pt solid var(--navy-700);
    margin:9mm 14mm 6mm;
    padding:6mm 7mm;
    font-size:9.5pt;
    color:var(--slate-600);
  }
  .notes-head { break-after:avoid; margin-bottom:3.5mm; }
  .notes-label {
    display:block; font-family:var(--sans); font-size:7.5pt; font-weight:700;
    letter-spacing:.22em; text-transform:uppercase; color:var(--navy-700); margin-bottom:1.5mm;
  }
  /* Sans headings throughout the panel — the clearest signal it is not article copy. */
  .notes h3 { font-family:var(--sans); font-size:10.5pt; font-weight:600; color:var(--navy-900); line-height:1.35; }
  .notes h4 { font-family:var(--sans); font-size:9.5pt; font-weight:700; color:var(--navy-900);
              letter-spacing:.04em; margin:5mm 0 2mm; break-after:avoid; }
  .notes-body > :first-child { margin-top:0; }
  .notes p { margin-bottom:.85em; }
  .notes ul, .notes ol { margin:0 0 .9em 1.1em; }
  .notes li { margin-bottom:.3em; }
  .notes strong { color:var(--navy-900); font-weight:600; }
  .notes a { color:var(--navy-700); word-break:break-word; }
  .notes code { background:rgba(27,42,74,.07); padding:.4mm 1.2mm; border-radius:1mm; }
  .notes hr { border:0; border-top:.75pt solid rgba(27,42,74,.18); margin:4mm 0; }
  .notes table { border-collapse:collapse; width:100%; font-size:8.5pt; margin:0 0 1em; }
  .notes th, .notes td { border:.5pt solid rgba(27,42,74,.22); padding:1.6mm 2mm; text-align:left; vertical-align:top; }
  .notes th { background:rgba(27,42,74,.07); font-weight:600; color:var(--navy-900); }
  .notes-empty { color:var(--grey-500); font-style:italic; }
  .notes-run { break-before:page; border-left-color:var(--gold-500); border-top-color:var(--gold-500); }
  .notes-run .notes-label { color:var(--navy-900); }
</style>
</head>
<body>
${cover}
${drafts}
${general}
</body>
</html>`;
}

/* ---------- main --------------------------------------------------------- */

async function main() {
  const prs = JSON.parse(await fs.readFile(process.env.DRAFTS_JSON, 'utf8'));
  if (!prs.length) {
    console.log('No draft PRs supplied — nothing to render.');
    return;
  }

  const generatedOn = todayLong();
  const withAge = list => list.map(pr => ({ ...pr, age: ageLabel(pr.created_at) }));

  // Write a branded email body up front, before any of the work that can fail.
  // If this process dies later, the alert still goes out looking like us — it
  // just says the packet is missing. The body is rewritten with the full
  // article list once the PDF is actually on disk.
  // The Word review note is built by a separate, browser-free step that runs
  // first, so by now it is either on disk or it failed. Ask the disk rather
  // than assuming: the email must never name an attachment that isn't there.
  const docxOnDisk = async () => {
    if (!process.env.DOCX_PATH) return false;
    try { return (await fs.stat(process.env.DOCX_PATH)).size > 0; } catch { return false; }
  };
  const writeEmail = async (list, hasPdf) => {
    if (!process.env.EMAIL_HTML_OUT) return;
    const att = { pdf: hasPdf, docx: await docxOnDisk() };
    await fs.writeFile(process.env.EMAIL_HTML_OUT, fitEmailHtml(list, generatedOn, att));
  };
  await writeEmail(withAge(prs).map(pr => ({ ...pr, articles: [] })), false);

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const rendered = [];

  try {
    for (const pr of prs) {
      const { byFile, order, general } = parseNotes(pr.body);
      const paths = await prArticleFiles(pr.number);
      const articles = [];

      for (const path of paths) {
        let extracted = null;
        try {
          extracted = await extractArticle(page, await fileAtRef(path, pr.head.sha));
        } catch (err) {
          console.log(`::warning::Could not render ${path} from PR #${pr.number}: ${err.message}`);
          continue;
        }
        if (!extracted) {
          console.log(`::warning::${path} in PR #${pr.number} has no .article-body — skipped.`);
          continue;
        }
        articles.push({ ...extracted, path, notesMd: byFile.get(path) || '' });
      }

      if (!articles.length) {
        console.log(`::warning::PR #${pr.number} contributed no renderable articles.`);
        // Keep its notes so the packet still carries something reviewable.
        if (general.length) rendered.push({ ...pr, articles: [], general, age: ageLabel(pr.created_at) });
        continue;
      }

      // Follow the PR body's numbering; anything unnumbered sorts last, by name.
      const rank = p => (order.has(p) ? order.get(p) : Number.MAX_SAFE_INTEGER);
      articles.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));

      // Notes that never bound to a file still belong in the packet.
      const unbound = [...byFile.entries()].filter(([p]) => !paths.includes(p));
      for (const [p, md] of unbound) general.push({ title: p, md });

      rendered.push({ ...pr, articles, general, age: ageLabel(pr.created_at) });
      console.log(`PR #${pr.number}: ${articles.length} article(s) rendered.`);
    }

    if (!rendered.length) throw new Error('No Ledger articles could be rendered from any open draft PR.');

    const html = buildHtml(rendered, generatedOn);
    if (process.env.HTML_OUT) await fs.writeFile(process.env.HTML_OUT, html);
    // 'load', not 'networkidle0'. The webfont request to fonts.googleapis.com
    // keeps the connection pool busy long enough on a GitHub runner that
    // networkidle0 times out and takes the whole packet with it. Wait for the
    // document, then give the fonts a bounded moment to settle — a packet in
    // fallback faces beats no packet at all.
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(() => Promise.race([
      document.fonts.ready,
      new Promise(resolve => setTimeout(resolve, 5000)),
    ])).catch(() => {});
    const foot = 'font-family:Inter,Arial,sans-serif;font-size:7.5pt;color:#8A93A6;width:100%;padding:0 14mm;';
    await page.pdf({
      path: OUT,
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        `<div style="${foot}display:flex;justify-content:space-between;">` +
        `<span>The Ledger &middot; draft review &middot; ${generatedOn}</span>` +
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
        '</div>',
      margin: { top: '0', bottom: '14mm', left: '0', right: '0' },
    });

    const { size } = await fs.stat(OUT);
    console.log(`Wrote ${OUT} (${Math.round(size / 1024)} KB)`);

    await writeEmail(rendered, true);
    if (process.env.EMAIL_HTML_OUT) console.log(`Wrote ${process.env.EMAIL_HTML_OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
