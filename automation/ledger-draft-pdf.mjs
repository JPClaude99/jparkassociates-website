#!/usr/bin/env node
/* ============================================================================
   THE LEDGER — draft review PDF builder
   ----------------------------------------------------------------------------
   Called by .github/workflows/ledger-draft-alert.yml. For every open, unmerged
   [Ledger] pull request it renders the drafted article(s) as they will read on
   the site, and follows each one with a REVIEWER NOTES panel drawn from that
   article's section of the PR body.

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
     OUT_PATH     where to write the PDF
     HTML_OUT     optional; also dump the intermediate HTML for debugging
     GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_API_URL
   ========================================================================== */

import fs from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { marked } from 'marked';

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

/**
 * Split a PR body into { byFile: Map<path, md>, order: Map<path, index>,
 * general: [{title, md}] }. `order` preserves the scan agent's numbering so the
 * packet reads 1, 2 rather than alphabetically by filename.
 */
function parseNotes(body) {
  const byFile  = new Map();
  const order   = new Map();
  const general = [];
  if (!body || !body.trim()) return { byFile, order, general };

  // Split on level-2 headings, keeping each heading with its section.
  const sections = body.split(/\n(?=##\s)/g);
  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+?)\s*$/m);
    const heading = headingMatch ? headingMatch[1].trim() : '';
    const rest    = headingMatch ? section.slice(headingMatch[0].length) : section;

    // A per-article section names its file in backticks near the top.
    const pathMatch = rest.match(/`(blog\/[A-Za-z0-9._-]+\.html)`/);
    if (pathMatch && /^\d+\./.test(heading)) {
      byFile.set(pathMatch[1], rest.trim());
      order.set(pathMatch[1], order.size);
    } else if (rest.trim() || heading) {
      // Drop the horizontal rules the scan agent uses between article blocks.
      const md = rest.replace(/^\s*---\s*$/gm, '').trim();
      if (md) general.push({ title: heading || 'Run summary', md });
    }
  }
  return { byFile, order, general };
}

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

    return {
      title:    txt('h1') || document.title.replace(/\s*\|.*$/, ''),
      category: txt('.cat'),
      source:   txt('.src-tag', meta || document),
      date:     txt('time', meta || document),
      dateIso:  (meta && meta.querySelector('time') && meta.querySelector('time').getAttribute('datetime')) || '',
      readTime: extra.join(' · '),
      bodyHtml: body.innerHTML,
    };
  }, SITE);
}

/* ---------- rendering ---------------------------------------------------- */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const notesPanel = (kind, label, heading, innerHtml) => `
  <aside class="notes ${kind}">
    <div class="notes-head">
      <span class="notes-label">${esc(label)}</span>
      <h3>${esc(heading)}</h3>
    </div>
    <div class="notes-body">${innerHtml}</div>
  </aside>`;

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

const ageLabel = (iso) => {
  const hours = Math.round((Date.now() - Date.parse(iso)) / 36e5);
  return hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
};

async function main() {
  const prs = JSON.parse(await fs.readFile(process.env.DRAFTS_JSON, 'utf8'));
  if (!prs.length) {
    console.log('No draft PRs supplied — nothing to render.');
    return;
  }

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

    const generatedOn = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full', timeZone: 'America/Los_Angeles',
    }).format(new Date());

    const html = buildHtml(rendered, generatedOn);
    if (process.env.HTML_OUT) await fs.writeFile(process.env.HTML_OUT, html);
    await page.setContent(html, { waitUntil: 'networkidle0' });
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
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
