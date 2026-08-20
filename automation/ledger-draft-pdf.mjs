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
import { Marked } from 'marked';
import { C, esc, panel, callout, emailShell,
         draftArticleHtml, htmlBudget } from './email-chrome.mjs';
import { parseNotes, ageLabel, generatedOn as todayLong } from './ledger-notes.mjs';

const API   = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO  = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT   = process.env.OUT_PATH || 'ledger-drafts.pdf';
const SITE  = 'https://jparkassociates.com/blog/';

/* PR bodies are written by an agent and reviewed by nobody before this runs,
   and `marked` passes raw HTML straight through. A single <style> line in a
   reviewer note set `body{display:none}` on the packet document and rendered a
   9 KB PDF with nothing on any page but the footer; a <script> would execute
   inside the render.

   Neutralise HTML at the RENDERER, not by pre-escaping the markdown. Escaping
   every `<` first looks equivalent and is not: it leaves the closing `>` of an
   autolink behind, so `<https://irs.gov/p535.pdf>` became a link to
   `p535.pdf%3E` — a cited source that 404s — and it double-escaped inside code
   fences, printing `&lt;style&gt;` where the note meant to show `<style>`.
   Overriding the `html` token instead leaves every other construct alone:
   autolinks resolve, fences print verbatim, tables, emphasis and underscores
   are untouched. */
const md = new Marked({ gfm: true, breaks: false });
md.use({ renderer: { html: token => esc(token.text ?? token.raw) } });

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
  // The palette crosses into the page rather than being re-typed as literals
  // there: a hex hard-coded inside page.evaluate cannot be found by a search
  // for C.NAVY_900, and drifts from the token in silence.
  return page.evaluate((base, P) => {
    const hero = document.querySelector('.article-hero');
    const body = document.querySelector('.article-body .container-narrow');
    if (!body) return null;

    /* The PACKET renders this HTML directly, so it is exactly as dangerous as a
       reviewer note — and it was going in unfiltered while notes were being
       escaped. One <style>body{display:none}</style> in a drafted article
       produced a 9 KB PDF with nothing on any page but the footer: no cover, no
       articles, no reviewer notes, and a `[ -s "$pdf" ]` check that passed, so
       it was attached and described as "each draft laid out as it will read on
       the site". The email was unaffected, which is the worst version — the two
       artifacts disagreeing completely with nothing to flag it.
       Articles are generated from blog/_template.html and never legitimately
       carry any of these. */
    for (const el of body.querySelectorAll(
      'style, script, link, meta, base, iframe, object, embed, title, ' +
      // Images go too, not just their attributes. Neither artifact renders one
      // — the email never has, and the packet's own header says so — but the
      // packet render used to WAIT for them, so a single <img> pointing at a
      // host that accepts the connection and never answers timed the render
      // out, produced no PDF, and shipped the article-free first-pass body.
      // Deterministic, so it repeated every Monday. No <img>, nothing to wait
      // for. <figcaption> is unaffected and still kept.
      'img, picture, source, video, audio, canvas, svg, map, area, ' +
      // Hidden by the UA stylesheet, so the packet shows nothing while the
      // email would print their contents in full.
      'datalist, template')) {
      el.remove();
    }
    // <details> renders collapsed, so its body is absent from innerText and the
    // packet check read the draft as nearly empty. Open it instead.
    // <details> and <dialog> render only when open; leaving them shut meant
    // the packet showed nothing where the email printed the contents. <slot>
    // is display:contents and visible in both, so it is not removed at all.
    for (const el of body.querySelectorAll('details, dialog')) el.setAttribute('open', '');
    /* Attributes, not just elements. A single inline style can cover the whole
       packet — `position:fixed;width:100%;height:100%;background:#fff` renders
       every page blank — and `display:none`, or the `hidden` attribute that
       means the same thing, makes the packet and the email disagree about what
       the article even says. Event handlers are inert with
       scripting disabled, but they are stripped so the packet's HTML cannot
       carry one into any future renderer. data-ledger-* is ours: an article
       that spoofs it could delete its own content from the email. */
    /* An ALLOWLIST, because the denylist kept losing. It was extended for
       `style`, then for `hidden`, and `<font color="#FFFFFF">` still rendered
       every word of an article in white on white — a packet that looked blank
       to a human, measured 392 characters to innerText, and was recorded as
       delivered with no warning. `bgcolor` is the same trick. Rather than keep
       guessing which attribute paints next, keep only the ones this pipeline
       actually reads and drop everything else. */
    const KEEP_ATTR = new Set(['href', 'colspan', 'rowspan', 'class', 'datetime',
                               'lang', 'dir', 'scope', 'rel', 'open',
                               // List numbering: these change what a step is
                               // called, not what colour it is. `value` is not
                               // here — it is per <li>, the email cannot carry
                               // it, so both artifacts renumber rather than
                               // disagree.
                               'start', 'type', 'reversed']);
    /* `class` needs an allowlist of its own. Keeping it wholesale handed the
       article the packet's own stylesheet: `<p class="cover-date">` paints
       cream at 55% opacity, which on the white draft ground measures 1.07:1 —
       an entire page blank to a human, counted as delivered, email unaffected.
       Exactly the <font color="#FFFFFF"> outcome, through a different door.
       `<aside class="notes notes-article">` was worse: article copy rendered
       identically to the reviewer-notes panel, defeating the one signal that
       says "not for publication". Only the classes the walker itself reads
       survive; the packet's chrome is not the article's to borrow. */
    const KEEP_CLASS = new Set(['callout', 'action-list', 'sources-box', 'label', 'disclaimer']);
    for (const el of body.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        if (!KEEP_ATTR.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
      }
      if (el.classList.length) {
        const keep = [...el.classList].filter(c => KEEP_CLASS.has(c));
        if (keep.length) el.setAttribute('class', keep.join(' '));
        else el.removeAttribute('class');
      }
    }

    for (const el of body.querySelectorAll('a[href]')) {
      try { el.setAttribute('href', new URL(el.getAttribute('href'), base).href); } catch { /* leave as-is */ }
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
       cross from site markup into mail-client markup. Doing it here, against a
       real DOM, means no regex ever parses HTML.

       THE RULE THIS WALKER EXISTS TO KEEP: the PDF renders the article's raw
       HTML, the email renders these blocks, and the two must describe the same
       article — nothing lost, nothing duplicated, nothing reordered. Anything
       unrecognised is KEPT, never skipped. ------------------------------- */
    const escHtml = t => String(t).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE',
                           'DL', 'PRE', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ASIDE', 'FIGURE',
                           'HR', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'FORM',
                           // The ITEMS too, not just their containers. Left out,
                           // flatten() appended them verbatim and a list inside a
                           // table cell came out "CELLA first itemCELLB second
                           // item" — two bullets welded into one nonsense word.
                           'LI', 'DT', 'DD',
                           // And the table's own anatomy. A <table> nested in a
                           // <dd> or in another cell reaches flatten(), not
                           // tableBlock(), and without these it came out
                           // "PaydayDeposit byWed-FriFollowing Wednesday" —
                           // the exact welding the walker exists to prevent.
                           'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION']);
    // Blocks that become their own email block wherever they are found. Kept
    // apart from BLOCK because a <div> is a wrapper to walk through, while a
    // <table> is a thing to render.
    const HEAVY = new Set(['TABLE', 'PRE', 'BLOCKQUOTE', 'DL', 'FIGURE']);
    const text = el => (el ? el.textContent.trim() : '');

    /* STRICTLY inline. Every block-level child is skipped, not descended into.
       Descending was the original defect in two directions at once: it glued a
       3x3 rate table into "1120-SSep 15Sep 15", and — once a fallback was added
       to recover the block text — it emitted that text twice. */
    /* ONE node, rendered as itself. inline() below renders a node's CHILDREN,
       which is what a caller wants for a <p>; flatten() wants the node itself,
       and passing an <a> to inline() emitted its text and threw the tag away —
       every citation in every sources box, every link and bold inside every
       list item and table cell, reduced to plain text while the PDF kept them.
       Word-for-word identical, so a text-only parity check never saw it. */
    const inlineNode = (n, onNavy, skipDir = false) => {
      if (n.nodeType === 3) return escHtml(n.nodeValue);
      if (n.nodeType !== 1 || BLOCK.has(n.tagName)) return '';
      /* `dir` is in KEEP_ATTR, so the packet reverses the run and the email,
         which rebuilds every tag without attributes, did not: the same cell
         printed "941 (Q3), amended" in one artifact and "amended ,)Q3( 941" in
         the other. <bdo> handles itself below; everything else is wrapped. */
      if (!skipDir && n.tagName !== 'BDO' && n.hasAttribute && n.hasAttribute('dir')) {
        const d = String(n.getAttribute('dir')).toLowerCase();
        if (d === 'rtl' || d === 'ltr' || d === 'auto') {
          return `<span dir="${d}">${inlineNode(n, onNavy, true)}</span>`;
        }
      }
      const link   = onNavy ? P.GOLD_PILL : P.NAVY_900;
      const strong = onNavy ? P.CREAM     : P.NAVY_900;
      const mono   = onNavy ? P.CREAM     : P.SLATE;
      switch (n.tagName) {
        case 'BR':     return '<br />';
        case 'A':      return `<a class="t-link" href="${escHtml(n.getAttribute('href') || '')}" style="color:${link};text-decoration:underline;">${inline(n, onNavy)}</a>`;
        case 'STRONG':
        case 'B':      return `<strong class="t-strong" style="color:${strong};font-weight:700;">${inline(n, onNavy)}</strong>`;
        case 'EM':
        case 'I':      return `<em>${inline(n, onNavy)}</em>`;
        // Classed, like every other coloured run: `mono` is the body colour on
        // the light ground and the strong colour on navy, and without the class
        // the ground flipped to dark under it and the colour did not.
        case 'CODE':   return `<code class="${onNavy ? 't-strong' : 't-body'}" style="font-family:Consolas,Menlo,monospace;font-size:13px;color:${mono};">${inline(n, onNavy)}</code>`;
        case 'SUP':    return `<sup>${inline(n, onNavy)}</sup>`;
        case 'SUB':    return `<sub>${inline(n, onNavy)}</sub>`;
        /* Emphasis that CHANGES THE FACT, and that the default branch used to
           flatten to plain text: "the rate is <del>800</del> <ins>500</ins>"
           arrived as "the rate is 800 500" — a superseded figure reading as a
           current one, and a sentence quoting two prices. The packet draws all
           of these from the UA stylesheet, so it always showed them. Styled as
           well as tagged: Outlook honours neither <s> nor <ins> reliably. */
        case 'DEL':
        case 'S':
        case 'STRIKE': return `<s style="text-decoration:line-through;">${inline(n, onNavy)}</s>`;
        case 'INS':
        case 'U':      return `<u style="text-decoration:underline;">${inline(n, onNavy)}</u>`;
        /* A REAL <mark>, so the stylesheet can reach its children. Painting an
           opaque gold ground and leaving the children's own colour classes
           alone made the text vanish: a link inside a highlight on the navy
           panel is gold-on-gold at 1.00:1 — an empty rectangle where a form
           name and its IRS link should be — and in dark mode .t-strong and
           .t-link flip to cream over the same gold at 1.19:1. Rendered with
           onNavy false so the children take their light-ground colours, and
           the dark-mode block in email-chrome.mjs pins everything inside a
           mark to navy. */
        case 'MARK':   return `<mark style="background-color:${P.GOLD_PILL};color:${P.NAVY_900};padding:0 2px;">${inline(n, false)}</mark>`;
        /* Nested quotes ALTERNATE, which is what the browser draws in the
           packet: the outer pair is curly double, the inner pair curly single.
           Hard-coded double at every depth gave the email
           "the deadline is "hard" not soft" against the packet's
           "the deadline is 'hard' not soft". */
        case 'Q': {
          const inner = n.parentElement && n.parentElement.closest('q');
          return inner ? `&lsquo;${inline(n, onNavy)}&rsquo;`
                       : `&ldquo;${inline(n, onNavy)}&rdquo;`;
        }
        // `dir` is in KEEP_ATTR, so the packet reverses the run and the email,
        // which rebuilds tags without attributes, did not: the same sentence
        // printed the date 2026-09-15 in one artifact and 51-90-6202 in the other.
        case 'BDO':    return `<bdo dir="${escHtml(n.getAttribute('dir') || 'ltr')}">${inline(n, onNavy)}</bdo>`;
        // <bdi> isolates its contents from the surrounding direction; the
        // default branch dropped the element and with it the isolation.
        case 'BDI':    return `<bdi>${inline(n, onNavy)}</bdi>`;
        case 'SCRIPT':
        case 'STYLE':  return '';
        default:       return inline(n, onNavy);   // span, and anything unexpected
      }
    };

    /* An <a> may legally wrap block content — a card link. Descending into it
       recovered the text and dropped the href, which is only half a fix: the
       reviewer saw the words and lost the citation. Re-wrap instead. */
    const anchorWrap = (a, inner, onNavy) => {
      const href = escHtml(a.getAttribute('href') || '');
      // An <a> around a <table> survives parsing with its own links inside it;
      // wrapping again emits nested anchors, which are invalid and ambiguous in
      // a mail client. Nothing to link is also nothing to emit.
      if (!href || !inner.trim() || /<a\s/i.test(inner)) return inner;
      const link = onNavy ? P.GOLD_PILL : P.NAVY_900;
      return `<a class="t-link" href="${href}" style="color:${link};text-decoration:underline;">${inner}</a>`;
    };

    /** A node's children, inline only. Block children are skipped, not walked. */
    const inline = (node, onNavy) => {
      let out = '';
      for (const n of node.childNodes) out += inlineNode(n, onNavy);
      return out;
    };

    /* Inline, but descending THROUGH block wrappers with a separator, for the
       two places that must end up as a single run of text: a table cell and a
       list item. Keeps links and emphasis, which a textContent fallback loses. */
    const flatten = (node, onNavy) => {
      let out = '';
      /* Separators belong AROUND BLOCKS and nowhere else. Routing every text
         node through a separator helper looked like the tidy fix for
         "<li>LEAD<div>MID</div>TAIL</li>" coming out "MIDTAIL", and it broke
         ordinary prose on nine of the twenty-one shipped articles: it inserted
         a space after an inline element ("letter decoder .)"), and its
         whitespace-only early-return deleted the space between two of them
         ("the CDTFA <em>before</em>" became "CDTFAbefore").

         So: text nodes and inline elements are appended VERBATIM — their own
         whitespace is the article's whitespace — and a block child gets a
         separator before it, and marks that the text after it needs one too. */
      let afterBlock = false;
      const gap = t => out && !/\s$/.test(out) && t && !/^\s/.test(t);
      /* A nested table never reaches tableBlock(), which is where the row
         groups get put into render order, so flattening it in source order put
         a <tfoot> total above the rows it sums and a trailing <caption> after
         them. Same order here as there. */
      const kids = node.tagName === 'TABLE'
        ? [...node.querySelectorAll(':scope > caption'),
           ...node.querySelectorAll(':scope > thead'),
           ...node.querySelectorAll(':scope > tr, :scope > tbody'),
           ...node.querySelectorAll(':scope > tfoot')]
        : node.childNodes;
      for (const n of kids) {
        if (n.nodeType === 3) {
          const t = escHtml(n.nodeValue);
          if (afterBlock && gap(t)) out += ' ';
          afterBlock = false;
          out += t;
          continue;
        }
        if (n.nodeType !== 1) continue;
        const isA = n.tagName === 'A' && n.querySelector && n.querySelector(BLOCK_SEL);
        const isBlock = isA || BLOCK.has(n.tagName) || (n.querySelector && n.querySelector(BLOCK_SEL));
        if (isBlock) {
          const emph = EMPH_WRAP[n.tagName];
          const inner = isA ? anchorWrap(n, flatten(n, onNavy), onNavy)
                     : emph ? emph(flatten(n, onNavy))
                     : flatten(n, onNavy);
          if (inner.trim()) {
            if (gap(inner)) out += ' ';
            out += inner;
            afterBlock = true;
          }
        } else {
          out += inlineNode(n, onNavy);
          afterBlock = false;
        }
      }
      return out;
    };

    /** Descendants of `root` matching `sel` that no NEARER container owns. */
    const ownedBy = (root, sel, stops) => [...root.querySelectorAll(sel)].filter(el => {
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        if (stops(p)) return false;
      }
      return true;
    });

    /** Clone `el` with exactly `nodes` removed — by identity, not by position. */
    const withoutNodes = (el, nodes) => {
      const MARK = 'data-ledger-drop';   // safe: data-ledger-* is stripped above
      nodes.forEach(n => n.setAttribute(MARK, '1'));
      const clone = el.cloneNode(true);
      // Replaced with a space, not removed. Deleting the node left the text on
      // either side of it adjacent, so "<li>LEAD<table/>TAIL</li>" flattened to
      // the single word "LEADTAIL".
      // A space only where the text on either side does not already have one.
      // Removing outright glued "LEAD<table/>TAIL" into one word; replacing
      // unconditionally split "va<pre/>lue" into two.
      clone.querySelectorAll(`[${MARK}]`).forEach(n => {
        // Comments and whitespace-only nodes are not text. Letting a comment
        // count made the separator depend on whether it happened to end in a
        // space — and this repo's house comment style does.
        const real = (n2, dir) => {
          for (let c = n2; c; c = c[dir]) {
            if (c.nodeType === 8) continue;                       // comment
            if (c.nodeType === 3 && !c.nodeValue.trim()) continue; // blank text
            return c;
          }
          return null;
        };
        const before = real(n.previousSibling, 'previousSibling');
        const after = real(n.nextSibling, 'nextSibling');
        const endsWs = before && /\s$/.test(before.textContent || '');
        const startsWs = after && /^\s/.test(after.textContent || '');
        const needs = before && after && !endsWs && !startsWs;
        n.replaceWith(n.ownerDocument.createTextNode(needs ? ' ' : ''));
      });
      nodes.forEach(n => n.removeAttribute(MARK));
      return clone;
    };

    const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, ul, ol, table, dl, pre, blockquote, div, section, aside, figure, li, dt, dd, tr, td, th, caption';

    /* A heading may hold a link or inline code, so the email renders its markup
       rather than its escaped text — but inline() skips block children, so a
       heading with a <div> inside it would silently lose that part. Offer the
       markup only when it accounts for ALL the text; otherwise the plain text
       is the honest answer. */
    const probe = document.createElement('div');
    const norm = t => String(t).replace(/\s+/g, ' ').trim();
    const headBlock = (kind, el, onNavy) => {
      const plain = text(el);
      let html = inline(el, onNavy);
      probe.innerHTML = html;
      if (norm(probe.textContent) !== norm(plain)) {
        /* A heading holding a block child — <h2>See <div><a…>THE RULE</a></div>
           before filing</h2>. inline() skips blocks, so the markup accounted for
           only part of the text and the whole heading fell back to escaped plain
           text, taking the citation with it: the packet kept the link and the
           email had no href to click at all. flatten() descends. */
        html = flatten(el, onNavy);
        probe.innerHTML = html;
      }
      return { kind, text: plain,
               html: norm(probe.textContent) === norm(plain) ? withDir(el, html) : '' };
    };
    /* Marker helpers, matching email-chrome.mjs's listMarker — the panel decides
       each item's marker here so the renderer never has to count, which is what
       let two adjacent lists share one sequence. */
    const CHECK = '\u2713';
    const ROMAN9 = [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],
                    [40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
    const romanOf = n => { let o = ''; for (const [v, t] of ROMAN9) while (n >= v) { o += t; n -= v; } return o; };
    const alphaOf = n => { let o = ''; while (n > 0) { const r = (n - 1) % 26; o = String.fromCharCode(97 + r) + o; n = (n - r - 1) / 26; } return o; };
    const listMark = (n, type) => {
      if (!Number.isFinite(n) || n < 1) return String(n);
      switch (type) {
        case 'a': return alphaOf(n);
        case 'A': return alphaOf(n).toUpperCase();
        case 'i': return romanOf(n);
        case 'I': return romanOf(n).toUpperCase();
        default:  return String(n);
      }
    };
    // The first numeric marker in a segment, for the <ol start> the sources box
    // renders. Non-decimal types keep their own per-item markers instead.
    const firstNum = items => {
      const m = items.find(i => !i.depth && !i.cont && i.marker && /^\d+\.$/.test(i.marker));
      return m ? parseInt(m.marker, 10) : undefined;
    };

    /* `dir` on a BLOCK — a cell, a paragraph — the way KEEP_ATTR gives it to the
       packet. inlineNode carries it for inline elements; without this the same
       cell printed "941 (Q3), amended" in the email and "amended ,)Q3( 941" in
       the PDF, which on a date is two different dates. */
    const dirOf = el => {
      const d = el && el.getAttribute ? String(el.getAttribute('dir') || '').toLowerCase() : '';
      return d === 'rtl' || d === 'ltr' || d === 'auto' ? d : '';
    };
    const withDir = (el, html) => {
      const d = dirOf(el);
      return d ? `<span dir="${d}">${html}</span>` : html;
    };

    const EMPH_WRAP = {
      DEL:    h => `<s style="text-decoration:line-through;">${h}</s>`,
      S:      h => `<s style="text-decoration:line-through;">${h}</s>`,
      STRIKE: h => `<s style="text-decoration:line-through;">${h}</s>`,
      INS:    h => `<u style="text-decoration:underline;">${h}</u>`,
      U:      h => `<u style="text-decoration:underline;">${h}</u>`,
      MARK:   h => `<mark style="background-color:${P.GOLD_PILL};color:${P.NAVY_900};padding:0 2px;">${h}</mark>`,
    };

    /* One block, wrapped. A paragraph carries its markup in `html`; a list
       carries it per item, and wrapping only `html` left a highlighted <ul>
       looking like an ordinary one. */
    const wrapBlock = (b, wrap) => {
      if (typeof b.html === 'string' && b.html) return { ...b, html: wrap(b.html) };
      if (Array.isArray(b.items)) {
        return { ...b, items: b.items.map(i => (i && typeof i.html === 'string' && i.html
          ? { ...i, html: wrap(i.html) } : i)) };
      }
      return b;
    };

    const CONTAINER_CLASS = ['callout', 'action-list', 'sources-box'];
    /* A container's OWN label, never one belonging to a box nested inside it.
       A plain querySelector('.label') took the first one anywhere below, so an
       unlabelled callout wrapping a labelled one was headed with the INNER
       box's label — an assertion about text it does not describe — and the
       inner box lost its own. For a sources box it was worse: the parts walk
       descended into the nested element because it "contained the label", and
       the nested panel was dismantled into a bare paragraph. */
    const ownLabel = el => ownedBy(el, '.label',
      p => CONTAINER_CLASS.some(c => p.classList.contains(c)))[0] || null;
    const OWNED_SEL = 'ul, ol, table, pre, blockquote, dl, figure, .callout, .action-list, .sources-box';
    const isContainer = el => el.tagName === 'LI' || HEAVY.has(el.tagName) ||
      CONTAINER_CLASS.some(c => el.classList.contains(c));

    const cellsOf = tr => [...tr.children]
      .filter(c => c.tagName === 'TH' || c.tagName === 'TD')
      .map(c => ({
        html: withDir(c, flatten(c, false)),
        // Per cell. A `<th scope="row">` in an otherwise ordinary row is a row
        // LABEL: bold, like the browser draws it, but not a column heading.
        header: c.tagName === 'TH',
        // Carried through, or a merged header cell shifts every value in the
        // row one column left and puts a California date under "Form".
        colspan: Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1),
        /* CLAMPED to the cell's own row group. The browser stops a rowspan at
           the end of its <tbody>; the email's table has no row groups left, so
           a rowspan that reached from the last body row into the <tfoot> pushed
           every footer value one column right — a total printed under the wrong
           heading. */
        rowspan: (() => {
          const want = Math.max(1, parseInt(c.getAttribute('rowspan') || '1', 10) || 1);
          const group = c.closest('thead, tbody, tfoot') || c.closest('table');
          if (!group) return want;
          const rows = [...group.querySelectorAll(':scope > tr')];
          const at = rows.indexOf(c.closest('tr'));
          return at < 0 ? want : Math.max(1, Math.min(want, rows.length - at));
        })(),
      }));

    const tableBlock = (el) => {
      // Scoped: an unscoped querySelectorAll('tr') hoisted the rows of a nested
      // table out of their cell and made them siblings of the outer table.
      /* thead, then bodies, then tfoot — the order the table RENDERS in, which
         is not the order it is written in. <tfoot> before <tbody> is HTML 4's
         required order and still comes out of plenty of generators; taken in
         document order the email printed "TOTAL 1,250" above the 1,000 and the
         250 it sums. */
      const trs = [
        ...el.querySelectorAll(':scope > thead > tr'),
        ...el.querySelectorAll(':scope > tr, :scope > tbody > tr'),
        ...el.querySelectorAll(':scope > tfoot > tr'),
      ];
      const rows = trs.map(tr => ({
        // A row that HOLDS a <th> is not a row OF <th>s. Styling the whole row
        // as a header made every cell of a `<th scope="row">Form 941</th>` row
        // bold navy on cream, so the table had no visible body at all.
        header: [...tr.children].every(c => c.tagName !== 'TD'),
        cells: cellsOf(tr),
      })).filter(r => r.cells.length);
      const capEl = el.querySelector(':scope > caption');
      const cap = text(capEl);
      const out = [];
      if (cap) out.push(headBlock('h3', capEl, false));
      if (rows.length) { out.push({ kind: 'table', rows }); return out; }
      // No rows is not no content — but the caption is already out, so the
      // fallback must not print it a second time.
      const rest = capEl ? withoutNodes(el, [capEl]) : el;
      if (text(rest)) out.push({ kind: 'p', html: flatten(rest, false) });
      return out;
    };

    const dlBlock = (el, onNavy) => {
      const list = [];
      let term = '';
      const bold = t => `<strong class="t-strong" style="color:${onNavy ? P.CREAM : P.NAVY_900};font-weight:700;">${t}</strong>`;
      /* Direct children ONLY was wrong: HTML5 lets each name-value group sit in
         its own <div>, which is how anyone grids or flexes a definition list.
         Every <div> child fell through both branches, the list came out empty,
         and the whole thing — terms, definitions and the citations inside them
         — was dropped from the email with no warning while the packet printed
         it in full. Document order across the groups, and never a nested <dl>'s
         own terms. */
      const groups = ownedBy(el, 'dt, dd', p => p !== el && p.tagName === 'DL');
      /* A definition may hold real BLOCKS — a rate table, a code sample, a
         nested list. flatten() renders those inline, so a two-column table in a
         <dd> arrived as "PaydayDeposit byWed-FriFollowing Wednesday" and a
         three-line <pre> as one line of Arial with three amounts run together.
         Those definitions are emitted as their own blocks, after the term,
         instead of being crushed into the item. */
      const out = [];
      const flushList = () => { if (list.length) { out.push({ kind: 'list', ordered: false, items: [...list] }); list.length = 0; } };
      const heavy = c => HEAVY.has(c.tagName) || c.querySelector('table, pre, ul, ol, dl, blockquote, figure');
      for (const c of groups) {
        if (c.tagName === 'DT') {
          if (term) list.push({ html: bold(term), depth: 0 });   // term with no definition
          term = withDir(c, flatten(c, onNavy));
        } else if (c.tagName === 'DD') {
          if (heavy(c)) {
            if (term) list.push({ html: bold(term), depth: 0 });
            flushList();
            out.push(...blocksOf(c, onNavy));
          } else {
            list.push({ html: term ? `${bold(term)} &mdash; ${withDir(c, flatten(c, onNavy))}`
                                     : withDir(c, flatten(c, onNavy)), depth: 0 });
          }
          term = '';
        }
      }
      if (term) list.push({ html: bold(term), depth: 0 });        // trailing orphan term
      flushList();
      return out;
    };

    /* A list becomes a SEQUENCE of blocks, not a list plus a pile of leftovers.
       Emitting an item's table after the whole list printed step 1's figures
       below step 2. Each heavy block breaks the list where it actually sits. */
    const listBlocks = (list, onNavy, depth = 0) => {
      const out = [];
      let run = [];
      const ordered = list.tagName === 'OL';
      const reversed = list.hasAttribute('reversed');
      const type = list.getAttribute('type') || undefined;
      // The packet honours `start` and the email did not, so the same list
      // printed 5,6,7 in one artifact and 1,2,3 in the other. parseInt, which
      // is what HTML does: Number('5px') is NaN where the packet reads 5, and
      // Number('0x10') is 16 where the packet reads 0.
      const startAttr = (() => {
        const n = parseInt(list.getAttribute('start'), 10);
        return Number.isFinite(n) ? n : undefined;
      })();
      /* A list broken by a block resumes where it left off. Every chunk used to
         carry the SAME start, so an interrupted five-step checklist printed
         1,2 then 1,2,3 — two step ones. Sub-items are not counted: they are not
         numbered in the packet either. `reversed` is left alone; splitting a
         countdown is not something an article has ever done, and guessing its
         base wrong is worse than leaving the attribute to the client. */
      let emitted = 0;
      const flush = () => {
        if (run.length) {
          out.push({
            kind: 'list',
            ordered,
            start: ordered && !reversed && emitted ? (startAttr ?? 1) + emitted : startAttr,
            type,
            reversed: reversed || undefined,
            items: run,
          });
          emitted += run.filter(i => !i.depth && !i.cont).length;
        }
        run = [];
      };
      for (const li of list.children) {
        if (li.tagName !== 'LI') continue;
        /* In document order, and never the same node twice: a <table> inside a
           <blockquote> inside this item belongs to the blockquote, and a nested
           <ul> inside that blockquote likewise. The container classes are in
           the list because a `.callout` inside an <li> owns its own contents —
           stripping the lists and tables it holds while re-emitting only what
           the <li> itself owned dropped a whole rate table on the floor. */
        const owned = ownedBy(li, OWNED_SEL, p => p !== li && isContainer(p));

        const emitOwned = (node) => {
          if (node.tagName === 'UL' || node.tagName === 'OL') {
            for (const b of listBlocks(node, onNavy, depth + 1)) {
              if (b.kind === 'list') run.push(...b.items);
              else { flush(); out.push(b); }
            }
          } else {
            flush();
            out.push(...blocksOfNode(node, onNavy));
          }
        };

        // An <li> whose only content is a table used to emit a blank bullet.
        if (!owned.length) {
          const html = withDir(li, flatten(li, onNavy).trim());
          if (html) run.push({ html, depth });
          continue;
        }

        /* SPLIT THE ITEM AT THE BLOCK. Printing all of the item's text and then
           the block put the sentence that follows a table above it:
           "<li>lead<pre>code</pre>tail</li>" read "lead tail" and then the
           code, so "tail" — which is usually a remark ABOUT the block — arrived
           before the thing it refers to. The packet, which keeps the block
           inside the bullet, read lead / code / tail. Now both do. */
        const ownedSet = new Set(owned);
        /* Everything after the item's first fragment is a CONTINUATION of the
           same step: no number, no bullet, no checkmark. Without that the
           email numbered "1. lead / 2. tail / 3. next" where the packet — which
           keeps the block inside the bullet — numbered "1. lead…tail / 2. next",
           and a reviewer reading the two side by side found step 3 was step 2. */
        let started = false;
        const pushItem = (html) => {
          if (!html) return;
          run.push(started ? { html, depth, cont: true } : { html, depth });
          started = true;
        };
        let buf = [];
        const flushBuf = () => {
          if (!buf.length) return;
          // A detached box so the buffered run can be flattened as a unit;
          // flatten() takes a node, and these are loose siblings.
          const box = li.ownerDocument.createElement('div');
          for (const n of buf) box.appendChild(n.cloneNode(true));
          buf = [];
          pushItem(flatten(box, onNavy).trim());
        };
        for (const child of li.childNodes) {
          if (child.nodeType !== 1) { buf.push(child); continue; }
          if (ownedSet.has(child)) { flushBuf(); emitOwned(child); continue; }
          const inner = owned.filter(o => child.contains(o));
          if (!inner.length) { buf.push(child); continue; }
          // A wrapper around one: its own text, then what it holds. Still in
          // the wrapper's place in the item, which is the part that matters.
          flushBuf();
          pushItem(flatten(withoutNodes(child, inner), onNavy).trim());
          for (const o of inner) emitOwned(o);
        }
        flushBuf();
      }
      flush();
      return out;
    };

    /** One element -> its email blocks. Split out so a list item, a table cell
        and the body can all reach the same handling. */
    const blocksOfNodeRaw = (el, onNavy) => {
      const cls = el.classList;
      switch (el.tagName) {
        case 'P':
          return text(el)
            ? [cls.contains('disclaimer')
                ? { kind: 'disclaimer', html: inline(el, onNavy) }
                : { kind: 'p', html: withDir(el, inline(el, onNavy)) }]
            : [];
        case 'H1': case 'H2': return [headBlock('h2', el, onNavy)];
        case 'H3': case 'H4':
        case 'H5': case 'H6': return [headBlock('h3', el, onNavy)];
        case 'UL': case 'OL':  return listBlocks(el, onNavy);
        case 'TABLE':          return tableBlock(el);
        case 'DL':             return dlBlock(el, onNavy);
        // textContent alone dropped every <a> and <strong> a code block held —
        // a cited URL the reviewer could read but not follow. flatten() keeps
        // the markup; the text is still carried for the plain-text part.
        case 'PRE':            return text(el)
          ? [{ kind: 'pre', text: el.textContent.replace(/\s+$/, ''),
               html: flatten(el, onNavy).replace(/\s+$/, '') }]
          : [];
        case 'HR':             return [];
        case 'BLOCKQUOTE': {
          const inner = blocksOf(el, onNavy);
          if (inner.length) return [{ kind: 'callout', label: '', blocks: inner }];
          // No inner blocks does not mean no content — a bare-text quote used
          // to render as an empty cream box.
          return text(el) ? [{ kind: 'callout', label: '', blocks: [{ kind: 'p', html: withDir(el, inline(el, onNavy)) }] }] : [];
        }
        case 'FIGURE': {
          /* A figure is not only its caption. Emitting the caption alone threw
             away a rate table or a list wrapped in <figure> with a source line
             under it — ordinary article markup — while the packet kept it. The
             image is already gone, removed with the other media. */
          const out = [];
          for (const child of el.childNodes) {
            if (child.nodeType === 3) {
              const t = child.nodeValue.trim();
              if (t) out.push({ kind: 'p', html: escHtml(t) });
              continue;
            }
            if (child.nodeType !== 1) continue;
            // In place, and only this figure's own caption: a descendant search
            // found a NESTED figure's, and appending at the end reordered both.
            if (child.tagName === 'FIGCAPTION') {
              if (text(child)) out.push({ kind: 'disclaimer', html: inline(child, onNavy) });
            } else if (BLOCK.has(child.tagName)) {
              out.push(...blocksOfNode(child, onNavy));
            } else if (text(child)) {
              out.push({ kind: 'p', html: inlineNode(child, onNavy) });
            }
          }
          return out;
        }
        default: {
          if (cls.contains('callout')) {
            // The label node itself, wherever it sits — and the SAME node is
            // what gets removed. Reading `:scope > .label` while removing
            // `.label` at any depth deleted a nested label without using it.
            const label = ownLabel(el);
            const blocks = blocksOf(label ? withoutNodes(el, [label]) : el, onNavy);
            return blocks.length ? [{ kind: 'callout', label: text(label), blocks }] : [];
          }
          if (cls.contains('action-list') || cls.contains('sources-box')) {
            const isAction = cls.contains('action-list');
            /* Lists belonging to a NESTED callout or sources box are that box's,
               not this panel's. Adopting them printed a source URL as an action
               step with a checkmark and left the nested box as an empty bar. */
            const lists = ownedBy(el, 'ul, ol',
                                  p => isContainer(p) || p.classList.contains('label'));
            const listSet = new Set(lists);
            const label = isAction ? null : ownLabel(el);

            /* An ORDERED stream of the panel's parts, descending through
               wrappers. Treating a wrapper as one unit put prose that
               introduced the steps below them, because the wrapper "contained a
               list" before its own first paragraph had been looked at. */
            const parts = [];
            const walk = (node) => {
              for (const n of node.childNodes) {
                if (n.nodeType === 3) {
                  const t = n.nodeValue.trim();
                  if (t) parts.push({ text: t });
                  continue;
                }
                if (n.nodeType !== 1) continue;
                if (listSet.has(n)) { parts.push({ list: n }); continue; }
                if (label && n === label) { parts.push({ label: true }); continue; }
                if (lists.some(l => n.contains(l)) || (label && n.contains(label))) { walk(n); continue; }
                parts.push({ el: n });
              }
            };
            walk(el);

            /* Three phases: before the checklist, the checklist itself, after
               it. Prose between two lists ENDS the panel — the second list then
               renders as an ordinary list in document order, rather than being
               merged into the panel above the paragraph that introduced it. */
            const before = [], after = [], items = [];
            /* The checklist as an ORDERED SEQUENCE of panel chunks and the heavy
               blocks that interrupt them, rather than one panel plus a pile of
               blocks below it. */
            const panelSeq = [];
            let panelHasOrdered = false, panelHasUnordered = false;
            let phase = 0;
            let heading = '';
            const pair = (nav, lite) => ({ nav, lite });
            /* WHERE the label sat, not just that it existed. The hoist below
               used to put it at the front unconditionally, so a box written
               "<p>prose</p><span class=label>Sources</span><ul>" printed the
               label ABOVE the prose in the email and below it in the packet.
               null means "not in the prose that precedes the citations" — the
               panel keeps it, which is where it already reads correctly. */
            let labelPos = null;
            let labelAfter = false;
            for (const part of parts) {
              if (part.label) {
                // Before the citations it joins the prose at its own index;
                // AFTER them it was skipped entirely and the panel printed it
                // on top, so a box written "<ul>…</ul><span class=label>" read
                // label-first in the email and label-last in the packet.
                if (phase === 0) labelPos = before.length; else labelAfter = true;
                continue;
              }
              if (part.list) {
                // Both grounds of the same list. listBlocks() decides structure
                // from the markup alone, so the two sequences line up index for
                // index; `|| b` is there so a future change that breaks that
                // mis-colours a block rather than dropping it.
                const navSeq = phase <= 1 ? listBlocks(part.list, isAction, 0) : [];
                const asItems = navSeq.flatMap(b => (b.kind === 'list' ? b.items : []));
                // The panel renders a fixed checkmark column and a fixed <ul>,
                // so an <ol start="3"> inside one printed 3. 4. 5. in the packet
                // and no numbers at all in the email — "fix step 4" then meant
                // nothing in one of the two artifacts.
                /* EACH SOURCE LIST NUMBERS ITSELF. A panel-wide flag merged a
                   <ul> and an <ol> written one after the other into a single
                   numbered checklist, so the packet showed "checkmark Pull /
                   checkmark Check / 1. File / 2. Pay" and the email showed
                   "1. Pull / 2. Check / 3. File / 4. Pay" — "fix step 1" named
                   a different step in each artifact. The marker is decided here,
                   per list, and the renderer just prints it. */
                for (const b of navSeq) {
                  if (b.kind !== 'list') continue;
                  const tops = b.items.filter(i => !i.depth && !i.cont);
                  if (!b.ordered) { tops.forEach(i => { i.marker = CHECK; }); continue; }
                  panelHasOrdered = true;
                  // A reversed list with no start counts DOWN from its own
                  // length, which is what the browser draws in the packet.
                  let n = Number.isFinite(b.start) ? b.start
                        : b.reversed ? (tops.length || 1) : 1;
                  for (const i of tops) { i.marker = `${listMark(n, b.type)}.`; n += b.reversed ? -1 : 1; }
                }
                if (navSeq.some(b => b.kind === 'list' && !b.ordered)) panelHasUnordered = true;
                // An EMPTY <ul> is not the checklist. Letting it advance the
                // phase demoted the real list below it to plain bullets and
                // left an empty navy bar where the panel should have been.
                if (phase <= 1 && asItems.length) {
                  phase = 1;
                  items.push(...asItems);
                  /* Heavy blocks inside those steps cannot sit on the navy
                     ground, so they leave the panel — but AT THE STEP THEY
                     BELONG TO, not below the whole checklist. A rate table in
                     step 1 used to print under step 4, which is the one place
                     a reader will not look for it. The panel resumes after the
                     block; two navy bars around the interruption is the price,
                     and it is cheaper than the table being in the wrong place. */
                  const liteSeq = listBlocks(part.list, false, 0);
                  navSeq.forEach((b, i) => {
                    if (b.kind === 'list') panelSeq.push({ items: b.items });
                    else panelSeq.push({ block: liteSeq[i] || b });
                  });
                } else {
                  for (const b of listBlocks(part.list, false, 0)) after.push(pair(b, b));
                }
                continue;
              }
              if (phase === 1) phase = 2;
              const sink = phase === 0 ? before : after;
              if (part.text) {
                const b = { kind: 'p', html: escHtml(part.text) };
                sink.push(pair(b, b));
                continue;
              }
              // Only before the checklist. A heading that follows the steps was
              // being hoisted above them.
              // Nothing before it, either: a heading that FOLLOWED the prose
              // was still being printed above it.
              if (isAction && !heading && phase === 0 && !before.length &&
                  /^H[1-6]$/.test(part.el.tagName)) {
                heading = text(part.el);
                continue;
              }
              // Both grounds, always — the cache makes it cheap, and choosing
              // by destination is the only way a block cannot end up coloured
              // for the ground it is not on.
              const lite = blocksOfNode(part.el, false);
              const nav = isAction ? blocksOfNode(part.el, true) : lite;
              lite.forEach((b, i) => sink.push(pair(nav[i] || b, b)));
            }

            /* Only the action panel has a `lead` slot; folding a sources box's
               prose into one dropped it, because that panel renders label and
               citations and nothing else.

               And the panel can only absorb a PREFIX. Pulling every paragraph
               into it and emitting the rest above printed a blockquote before
               the heading and the prose that preceded it. So: if anything in
               `before` cannot live in the panel, nothing does — the heading and
               all of it are emitted in document order, and the panel is just
               its items. */
            const canLead = b => isAction &&
              ['p', 'disclaimer', 'h2', 'h3'].includes(b.kind);
            /* And only when the panel OPENS with steps. A checklist whose very
               first step is a table starts with the table, so lead prose folded
               into "the panel" would print below it; emitted as ordinary blocks
               it stays where the article put it. */
            const allLead = before.every(x => canLead(x.lite)) &&
                            !(panelSeq[0] && panelSeq[0].block);
            const lead = [], leadOut = [];
            if (allLead) {
              for (const { nav } of before) {
                if (nav.kind === 'p' || nav.kind === 'disclaimer') lead.push(nav.html);
                else lead.push(`<strong>${nav.html || escHtml(nav.text)}</strong>`);
              }
            } else {
              if (isAction && heading) leadOut.push({ kind: 'h3', text: heading, html: '' });
              heading = '';
              for (const { lite } of before) leadOut.push(lite);
            }
            /* No items, no panel. An action list whose only <ul> belonged to a
               nested container rendered as an empty navy bar carrying just its
               heading, and a sources box with prose and no citations printed an
               empty <ul> with its label below the prose that introduced it. */
            /* No items, no panel — an action list whose only <ul> belonged to a
               nested container rendered as an empty navy bar carrying just its
               heading, and a sources box with prose and no citations printed an
               empty <ul> below the prose that introduced it. The fallback uses
               the LIGHT copies: `lead` is coloured for navy, so emitting it as
               ordinary paragraphs put cream and gold on white. */
            /* The panel renders the label above the citations, which puts it
               BELOW any prose that introduces them. When there is prose in
               front, the label is emitted with that prose instead — at the
               index the article put it, so the two artifacts read the same —
               and the panel is left unlabelled.

               `leadOut` is exactly `before` mapped to its light copies here
               (a sources box can never lead a panel, so `allLead` is false
               whenever `before` is non-empty), which is what makes an index
               into one an index into the other. */
            // Only if the article wrote one. Defaulting unconditionally put a
            // "Sources" heading above a sources box that never had a label,
            // and an empty one put a blank <h3> above its prose.
            let srcLabel = label ? (text(label) || 'Sources') : '';
            if (!isAction && srcLabel && labelAfter) {
              const b = { kind: 'h3', text: srcLabel, html: '' };
              after.unshift({ nav: b, lite: b });
              srcLabel = '';
            } else if (!isAction && leadOut.length && srcLabel) {
              leadOut.splice(Math.min(labelPos ?? 0, leadOut.length), 0,
                             { kind: 'h3', text: srcLabel, html: '' });
              srcLabel = '';
            }
            /* Heading, lead and label belong to the FIRST chunk only — repeating
               them over a split panel would read as two separate checklists. */
            let first = true;
            const panel = items.length
              ? panelSeq.flatMap((seg) => {
                  if (seg.block) return [seg.block];
                  if (!seg.items.length) return [];
                  const head = first;
                  first = false;
                  /* The sources box renders a real <ol>/<ul> rather than a
                     marker column, so it can only be one or the other: ordered
                     only when EVERY list in the panel was, or the unordered
                     citations would come out numbered. Items carry their own
                     markers either way, which is what the action panel uses. */
                  const srcOrdered = panelHasOrdered && !panelHasUnordered;
                  return [isAction
                    ? { kind: 'action', heading: head ? heading : '', lead: head ? lead : [],
                        items: seg.items }
                    : { kind: 'sources', label: head ? srcLabel : '', items: seg.items,
                        ordered: srcOrdered,
                        start: srcOrdered ? firstNum(seg.items) : undefined }];
                })
              : [
                  ...(isAction && heading ? [{ kind: 'h3', text: heading, html: '' }] : []),
                  // srcLabel, not text(label): when the hoist above already
                  // placed it in leadOut, re-emitting here printed it twice.
                  ...(!isAction && srcLabel ? [{ kind: 'h3', text: srcLabel, html: '' }] : []),
                  ...(allLead ? before.map(x => x.lite) : []),
                ];
            return [...leadOut, ...panel, ...after.map(x => x.lite)];
          }
          /* BLOCK-LEVEL EMPHASIS. <del>, <ins>, <mark>, <u>, <s> may legally wrap
             whole paragraphs; the descent below throws the wrapper away and
             keeps only its children, so the PDF struck out "The rate is 800 per
             quarter." and the email printed it as ordinary prose — a superseded
             figure reading as a current one, which is exactly what the inline
             <del> case exists to prevent. The wrapper is re-applied to each
             block the descent produces. */
          if (EMPH_WRAP[el.tagName] && el.querySelector(BLOCK_SEL)) {
            const wrap = EMPH_WRAP[el.tagName];
            return blocksOf(el, onNavy).map(b => wrapBlock(b, wrap));
          }
          // querySelector, not a direct-children check: <div><a><p>…</p></a></div>
          // is valid HTML5 and used to emit an empty <a> where a paragraph was.
          if (el.querySelector(BLOCK_SEL)) return blocksOf(el, onNavy);
          return text(el) ? [{ kind: 'p', html: withDir(el, inline(el, onNavy)) }] : [];
        }
      }
    };

    /* Both grounds are computed for every part of a panel, and each recursed in
       full — 1.9x per nesting level measured, so a deeply nested panel ran past
       the job's timeout and sent no email at all. A per-(element, ground) cache
       makes it linear, which is what lets the navy version be computed
       unconditionally: the heuristic that used to avoid the cost skipped it for
       any part whose blocks were not all simple prose, and a paragraph inside
       such a part then rendered navy-on-navy in the panel. */
    const nodeCache = new WeakMap();
    const blocksOfNode = (el, onNavy) => {
      let slot = nodeCache.get(el);
      if (!slot) { slot = {}; nodeCache.set(el, slot); }
      const k = onNavy ? 'navy' : 'light';
      if (!(k in slot)) slot[k] = blocksOfNodeRaw(el, onNavy);
      return slot[k];
    };

    const blocksOf = (root, onNavy = false) => {
      const out = [];
      let buf = '';
      // Text sitting directly in a wrapper is content. Walking `children` and
      // ignoring child TEXT NODES lost "<div>a sentence</div>" outright.
      const flush = () => {
        if (buf.trim()) out.push({ kind: 'p', html: buf.trim() });
        buf = '';
      };
      for (const node of root.childNodes) {
        if (node.nodeType === 3) { buf += escHtml(node.nodeValue); continue; }
        if (node.nodeType !== 1) continue;
        if (!BLOCK.has(node.tagName)) {
          // <noscript>, <details>, a custom element — not block-level, but it
          // can still WRAP blocks, and inlineNode() returns '' for those. The
          // packet rendered them; the email dropped them silently. <noscript>
          // in particular is live markup now that page scripting is disabled.
          if (node.tagName === 'A' && node.querySelector && node.querySelector(BLOCK_SEL)) {
            flush();
            const wrapped = anchorWrap(node, flatten(node, onNavy), onNavy);
            if (wrapped.trim()) out.push({ kind: 'p', html: wrapped });
          } else if (node.querySelector && node.querySelector(BLOCK_SEL)) {
            flush();
            /* This is where a block-wrapping <del>/<ins>/<mark>/<u>/<s> is
               descended into — blocksOfNode is never reached for a non-BLOCK
               wrapper — so the wrapper has to be re-applied here or the PDF
               strikes out a superseded rate and the email prints it as current
               prose. */
            const wrap = EMPH_WRAP[node.tagName];
            const inner = blocksOf(node, onNavy);
            out.push(...(wrap ? inner.map(b => wrapBlock(b, wrap)) : inner));
          } else {
            buf += inlineNode(node, onNavy);
          }
          continue;
        }
        flush();
        out.push(...blocksOfNode(node, onNavy));
      }
      flush();
      return out;
    };

    // Taken BEFORE the walk, on purpose: the walk marks live nodes with a
    // temporary attribute while cloning, and reading innerHTML afterwards
    // would carry those marks into the packet.
    const bodyHtml = body.innerHTML;

    return {
      title:    txt('h1') || document.title.replace(/\s*\|.*$/, ''),
      category: txt('.cat'),
      source:   txt('.src-tag', meta || document),
      date:     txt('time', meta || document),
      dateIso:  (meta && meta.querySelector('time') && meta.querySelector('time').getAttribute('datetime')) || '',
      readTime: extra.join(' · '),
      bodyHtml,
      blocks:   blocksOf(body),
    };
  }, SITE, { NAVY_900: C.NAVY_900, GOLD_PILL: C.GOLD_PILL, CREAM: C.CREAM, SLATE: C.SLATE });
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
function buildEmailHtml(prs, generatedOn, att, fullCount = Infinity, printedPaths = null) {
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // The body is written once before the render work (which can fail) and again
  // after it succeeds. On that first pass there is no article data yet, so
  // nothing may claim a count it does not have — this is what produced the
  // "0 drafts, written and waiting." headline.
  const all = prs.flatMap(pr => pr.articles.map(a => ({ ...a, pr })));
  // Drafts the pull requests contain that could not be rendered. Counting only
  // what survived, and saying nothing about the rest, told the reviewer "2
  // drafts ready" when three had been written — with no hint the third existed.
  const skipped = prs.flatMap(pr => (pr.skipped || []).map(path => ({ path, pr })));
  const counted = all.length > 0;

  // Count every draft the pull requests contain, not only the ones that
  // rendered — the Word note and the PDF cover count the same way, and three
  // artifacts from one run disagreeing about how many drafts there are is its
  // own kind of wrong answer.
  const headline  = counted ? `${plural(all.length + skipped.length, 'draft')} ready for review.`
                            : 'Drafts ready for review.';
  // What this body will actually print in full, which is not always what was
  // drafted: the size guard demotes later drafts to a listed entry, and some
  // may have failed to render. Saying "reproduced in full below" regardless
  // was a promise the message broke sixty kilobytes later.
  const inFull = Math.min(fullCount, all.length);
  const total = all.length + skipped.length;
  // The intro sentence has always been honest about that; the preheader — the
  // line Gmail shows in the inbox, before anything is opened — still promised
  // "the full text is below" for all twenty-one when seven fitted.
  const preheader = !counted
    ? 'Ledger drafts are written and waiting — merging publishes them.'
    : inFull >= total
      ? `${plural(total, 'Ledger article')} drafted and waiting — the full text is below.`
      : `${plural(total, 'Ledger article')} drafted and waiting — ${inFull} in full below, the rest in the PDF.`;
  const intro = !counted
    ? `${plural(prs.length, 'pull request')} drafted but not yet live on jparkassociates.com.
       Merging is what publishes the articles inside.`
    : inFull >= total
      ? `${total === 1 ? 'One article is' : `${total} articles are`} drafted and ready for your review.
         ${total === 1 ? 'It is' : 'They are'} reproduced in full below, exactly as ${total === 1 ? 'it' : 'they'} will read on
         jparkassociates.com. Merging the pull request is what publishes ${total === 1 ? 'it' : 'them'}.`
      : `${total} articles are drafted and ready for your review. ${inFull === 1 ? 'One is' : `${inFull} are`}
         reproduced in full below, exactly as ${inFull === 1 ? 'it' : 'they'} will read on jparkassociates.com;
         the rest ${skipped.length ? 'are named further down' : 'are in the attached PDF'}.
         Merging the pull request is what publishes them.`;

  // What actually made it onto the message. Never promise an attachment that
  // failed to build — the reviewer would go looking for a file that isn't there.
  const enclosures = [
    att.pdf  && ['ledger-drafts.pdf',
                 'each draft laid out as it will read on the site, with a reviewer-notes panel after it.'],
    att.docx && ['Ledger-review-notes.docx',
                 'the reviewer notes on their own — sources, reasoning and anything the scan hedged on — in Word, ready to mark up.'],
  ].filter(Boolean);

  const missing = skipped.length ? callout('Could not be rendered', `
      <p class="t-body" style="margin:0 0 8px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${skipped.length === 1 ? 'One further draft is' : `${skipped.length} further drafts are`} in the pull request but
        could not be rendered for this email &mdash; see the Actions log. Read
        ${skipped.length === 1 ? 'it' : 'them'} on GitHub before merging:
      </p>
      <ul class="t-body" style="margin:0;padding-left:20px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${skipped.map(x => `<li style="margin:0 0 5px;">${esc(x.path)} (PR #${esc(x.pr.number)})</li>`).join('')}
      </ul>`, C.GREY) : '';

  const aside = enclosures.length
    ? callout('Attached', enclosures.map(([name, what]) => `
        <p class="t-body" style="margin:0 0 8px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
          <strong class="t-strong" style="color:${C.NAVY_900};">${esc(name)}</strong> &mdash; ${what}
        </p>`).join('') + `
        <p class="t-muted" style="margin:6px 0 0;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:${C.GREY};">
          Read ${enclosures.length > 1 ? 'either one' : 'it'} anywhere; no GitHub needed.
        </p>`)
    : callout('', `
        <p class="t-body" style="margin:0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
          Neither the PDF packet nor the Word review note could be built this run &mdash; see the Actions log.
          The full article text below is unaffected; review the pull request directly for the notes.
        </p>`, C.GREY);

  // Source line for each PR, then its articles in full.
  const prHeader = pr => panel(`
      <p class="t-gold" style="margin:0 0 6px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${C.GOLD_TEXT};">
        PR #${esc(pr.number)} &middot; open ${esc(pr.age)}${pr.head && pr.head.ref ? ` &middot; ${esc(pr.head.ref)}` : ''}
      </p>
      <p class="t-title" style="margin:0 0 12px;font:700 17px/1.35 Georgia,'Times New Roman',serif;color:${C.NAVY_900};">${esc(pr.title)}</p>
      <a href="${esc(pr.html_url)}" class="t-link" style="font:600 13px/1.4 Arial,Helvetica,sans-serif;color:${C.NAVY_900};text-decoration:underline;">Review and merge on GitHub &rarr;</a>
    `);

  let printed = 0;
  const overflow = [];
  const body = `
    <!--ledger:notice-->
    <p class="t-body" style="margin:0 0 18px;font:400 15px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">${intro}</p>
    ${aside}
    ${missing}
    ${prs.map(pr => prHeader(pr) + pr.articles.map((a, i) => {
      if (printed >= fullCount) { overflow.push(a); return ''; }
      printed++;
      if (printedPaths) printedPaths.push(`${pr.number}:${a.path}`);
      return draftArticleHtml(a, { index: i + 1, total: pr.articles.length, prNumber: pr.number });
    }).join('')).join('')}
    ${overflow.length ? callout('Not shown here', `
      <p class="t-body" style="margin:0 0 8px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${plural(overflow.length, 'further draft')} would have pushed this message past the size at which
        Gmail truncates it. ${att.pdf
          ? `${overflow.length === 1 ? 'It is' : 'They are'} in the attached PDF in full:`
          : `Read ${overflow.length === 1 ? 'it' : 'them'} in the pull request:`}
      </p>
      <ul class="t-body" style="margin:0;padding-left:20px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.SLATE};">
        ${overflow.map(a => `<li style="margin:0 0 5px;">${esc(a.title)}</li>`).join('')}
      </ul>`, C.GREY) : ''}`;

  /* Three numbers, because one was not enough to tell the truth with. The
     plain-text part is a whole message on its own, and "the full text of each
     draft is in the HTML version" was false whenever a draft failed to render
     or got demoted by the size guard — the HTML body says so in a callout, the
     text part had no way to know. The workflow reads these and writes a
     sentence that matches. */
  return `<!--ledger:articles=${all.length};skipped=${skipped.length};full=${Math.min(fullCount, all.length)}-->\n` + emailShell({
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
    const printedPaths = [];
    const html = buildEmailHtml(prs, generatedOn, att, full, printedPaths);
    if (Buffer.byteLength(html) <= htmlBudget() || full === 1) {
      if (full < total) {
        console.log(`::warning::Email body too large for ${total} full drafts; printed ${full} in full, ` +
                    `the rest are listed and remain complete in the PDF.`);
      }
      if (Buffer.byteLength(html) > htmlBudget()) {
        console.log(`::warning::Email body is ${Math.round(Buffer.byteLength(html) / 1024)} KB even with a single ` +
                    'draft in full; Gmail may clip it. Sent whole rather than truncated.');
      }
      return { html, printedPaths };
    }
  }
  return { html: buildEmailHtml(prs, generatedOn, att, 0), printedPaths: [] };
}

/** Visible characters an article's HTML should produce, for the packet check. */
const plainLen = html => String(html || '')
  // Comments first, and as whole units: `<[^>]+>` stops at the first `>`, so a
  // comment containing one leaked its prose into the expected length and the
  // packet was judged to have lost text it never had.
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;

function buildHtml(prs, generatedOn) {
  const totalArticles = prs.reduce((n, pr) => n + pr.articles.length, 0);
  const totalSkipped  = prs.reduce((n, pr) => n + (pr.skipped || []).length, 0);

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
            <span class="cover-pr">PR #${pr.number}${pr.head && pr.head.ref ? ` &middot; branch <code>${esc(pr.head.ref)}</code>` : ''} &middot; open ${esc(pr.age)}</span>
            <ul>${pr.articles.map(a => `<li>${esc(a.title)}</li>`).join('')}</ul>
            <span class="cover-pr"><a href="${esc(pr.html_url)}">${esc(pr.html_url)}</a></span>
          </li>`).join('')}
      </ol>
    </div>
    <p class="cover-foot">
      ${totalArticles} article${totalArticles === 1 ? '' : 's'} across
      ${prs.length} pull request${prs.length === 1 ? '' : 's'}${totalSkipped
        ? `, and ${totalSkipped} more that could not be rendered — read ${totalSkipped === 1 ? 'it' : 'them'} on GitHub`
        : ''}.
      Merging a pull request is what publishes its articles to jparkassociates.com.
      Reviewer notes follow each draft on a cream ground &mdash; those are working notes, not article copy.
    </p>
    <!-- The firm bio, verbatim from blog/_template.html. Every other Ledger
         artifact carries it in its footer; a running page footer has no room for
         it, so the packet's colophon is the cover. -->
    <p class="cover-bio">
      A personalized CPA office on Foothill Blvd. in La Crescenta, keeping the books, taxes,
      and payroll of Crescenta Valley and Los Angeles businesses in order for over 15 years.
    </p>
  </section>`;

  const drafts = prs.map(pr => pr.articles.map((a, i) => `
    <article class="draft" data-pr="${esc(pr.number)}" data-chars="${plainLen(a.bodyHtml)}">
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
        ? notesPanel('notes-article', 'Reviewer notes — not for publication', a.title, md.parse(a.notesMd || ''))
        : notesPanel('notes-article notes-empty', 'Reviewer notes — not for publication', a.title,
            '<p>No per-article notes were found in the pull request body for this draft. ' +
            'Check the pull request directly before merging.</p>')}
    </article>`).join('')).join('');

  const general = prs.flatMap(pr =>
    pr.general.length
      ? [notesPanel('notes-run', 'Run notes — not for publication', `PR #${pr.number}`,
          pr.general.map(s => `<h4>${esc(s.title)}</h4>${md.parse(s.md || '')}`).join(''))]
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
    /* Same three golds as email-chrome.mjs, and used the same way:
       --gold-500 is a SURFACE (rules, borders) and never type;
       --gold-300 is gold on navy — it is C.GOLD_PILL, so the packet and the
       email render the same element in the same gold;
       --gold-text is gold type on a light ground. #C9A84C as type on white is
       2.29:1, which is why it never appears as one here. */
    --gold-500:#C9A84C; --gold-300:#F0DCA8; --gold-text:#7E6015;
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
  .cover-bio { margin-top:8mm; padding-top:4mm; border-top:.5pt solid rgba(245,240,232,.28);
               font-size:8pt; line-height:1.5; color:rgba(245,240,232,.8); max-width:120mm; }
  .draft-body p { margin-bottom:1.3em; }
  /* NOTHING RUNS OFF THE PAGE. <pre> defaults to white-space:pre, so a long
     command in a code sample laid out to 1277px on an 816px page and 64 of its
     169 characters were simply never printed — while plainLen() counted them
     all from the DOM and passed the packet's own completeness check. The email
     wrapped the same block. Long unbroken tokens in cells go the same way. */
  .draft-body pre { white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; }
  .draft-body { overflow-wrap:break-word; }
  .draft-body td, .draft-body th, .draft-body code { overflow-wrap:anywhere; }
  /* A highlight is a gold ground; everything on it is navy, whatever colour the
     rule for its own element would otherwise give it. Without this the panel's
     catch-all painted cream straight over the highlight at 1.06:1. */
  .draft-body mark, .draft-body mark * { background:var(--gold-300); color:var(--navy-900); }
  /* An open <dialog> is position:absolute over an opaque ground in the UA
     stylesheet. Forcing it open so the packet would SHOW its text instead made
     it leave the flow and paint over the paragraph beneath — a sentence about a
     5 percent penalty, obliterated in the PDF and printed in the email. Opened
     and put back in the flow. */
  .draft-body dialog { position:static; display:block; background:transparent; color:inherit;
                       border:0; padding:0; margin:0 0 1.3em; max-width:none; width:auto; }
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
  .draft-body .callout .label { color:var(--gold-text); }
  .draft-body .callout p:last-child { margin-bottom:0; }

  .draft-body .action-list { background:var(--navy-900); border-radius:3mm; padding:7mm; margin:6mm 0; break-inside:avoid; }
  .draft-body .action-list h2, .draft-body .action-list h3 { color:var(--gold-300); margin:0 0 3mm; font-size:11.5pt; }
  /* THE NAVY PANEL. Every text element on it, however deeply wrapped — five
     separate invisible-text bugs have shipped from naming elements one at a
     time and missing one. The universal selector is blunt, and it is scoped
     to this panel. */
  .draft-body .action-list, .draft-body .action-list * { color:rgba(245,240,232,.9); }
  .draft-body .action-list strong,
  .draft-body .action-list dt { color:var(--cream-50); font-weight:600; }
  .draft-body .action-list a { color:var(--gold-300); }
  .draft-body .action-list h1, .draft-body .action-list h2, .draft-body .action-list h3,
  .draft-body .action-list h4, .draft-body .action-list h5, .draft-body .action-list h6 { color:var(--gold-300); }
  .draft-body .action-list ul { list-style:none; margin:0; }
  .draft-body .action-list li { position:relative; padding-left:6mm; margin-bottom:2mm; }
  .draft-body .action-list li::before { content:"\\2713"; position:absolute; left:0; top:0; font-family:var(--serif); font-weight:700; color:var(--gold-500); }
  /* An ORDERED checklist keeps its numbers and drops the checkmark. The reset
     above was written for unordered lists only, so an ol in a panel printed
     "1. checkmark step" — two markers for one step — while the email, whose
     panel renders a fixed checkmark column, printed no number at all. */
  /* NO list-style here. An <ol> is decimal by default, and naming it explicitly
     overrode the element's own type attribute — so an <ol type="a"> in a panel
     printed 25. 26. 27. in the PDF against y. z. aa. in the email. The reset
     above it is scoped to <ul>, so nothing needs cancelling. */
  .draft-body .action-list ol { margin:0 0 0 5mm; }
  .draft-body .action-list ol > li { padding-left:0; }
  .draft-body .action-list ol > li::before { content:none; }

  /* A .callout or .sources-box nested inside the panel is its own white box,
     so everything in it goes back to the body colours. A sources box has no
     background of its own — it is a rule and a label on the page ground — so
     it needs one here, or the resets below paint navy text on the navy panel. */
  .draft-body .action-list .callout,
  .draft-body .action-list .sources-box {
    background:var(--white); border-radius:3mm; padding:6mm; margin:6mm 0;
  }
  .draft-body .action-list .callout, .draft-body .action-list .callout *,
  .draft-body .action-list .sources-box, .draft-body .action-list .sources-box * { color:var(--slate-600); }
  .draft-body .action-list .callout strong, .draft-body .action-list .callout dt,
  .draft-body .action-list .sources-box strong, .draft-body .action-list .sources-box dt { color:var(--navy-900); }
  .draft-body .action-list .callout a,
  .draft-body .action-list .sources-box a { color:var(--navy-700); }
  .draft-body .action-list .callout h1, .draft-body .action-list .callout h2,
  .draft-body .action-list .callout h3, .draft-body .action-list .callout h4,
  .draft-body .action-list .sources-box h1, .draft-body .action-list .sources-box h2,
  .draft-body .action-list .sources-box h3, .draft-body .action-list .sources-box h4 { color:var(--navy-900); }
  .draft-body .action-list .callout .label { color:var(--gold-text); }
  .draft-body .action-list .sources-box .label { color:var(--grey-500); }
  .draft-body .action-list .callout li, .draft-body .action-list .sources-box li { padding-left:0; }
  .draft-body .action-list .callout li::before,
  .draft-body .action-list .sources-box li::before { content:none; }
  .draft-body .action-list .callout ul,
  .draft-body .action-list .sources-box ul { list-style:disc; margin:0 0 1.3em 1.2em; }

  /* The email bolds a <dt>; the packet's reset left it normal weight. */
  .draft-body dt { font-weight:600; color:var(--navy-900); }

  .draft-body .sources-box { border-top:.75pt solid rgba(27,42,74,.16); margin-top:8mm; padding-top:4mm; }
  .draft-body .sources-box .label { color:var(--grey-500); }
  .draft-body .sources-box ul { list-style:none; margin:0; }
  .draft-body .sources-box li { margin-bottom:1.5mm; font-size:9pt; word-break:break-word; }
  .draft-body .disclaimer { margin-top:5mm; font-size:8.5pt; font-style:italic; color:var(--grey-500); }

  /* LAST, and they have to be last. The panel's catch-all is two classes and a
     universal selector — specificity (0,2,0) — which TIES with the disclaimer
     rule, and the sources-box label rule is higher still, so whichever is
     written later wins. Written earlier, the panel lost: a disclaimer inside an
     action list rendered grey #5C6577 on navy at 2.43:1, and a label on a
     panel carrying both container classes rendered gold-on-navy at 2.42:1 —
     both ghosts in the PDF, both perfectly legible in the email. Anything
     nested in a white box inside the panel goes back to dark type after them. */
  .draft-body .action-list .disclaimer { color:rgba(245,240,232,.75); }
  .draft-body .action-list .label { color:var(--gold-300); }
  .draft-body .action-list .callout .disclaimer,
  .draft-body .action-list .sources-box .disclaimer { color:var(--grey-500); }
  .draft-body .action-list .callout .label { color:var(--gold-text); }
  .draft-body .action-list .sources-box .label { color:var(--grey-500); }

  /* A PANEL INSIDE A WHITE BOX INSIDE A PANEL. The box's reset to dark type is
     more specific than the outer panel's catch-all, so it reached on into the
     nested panel — which paints its own navy ground — and printed navy on navy
     at 1.00:1. Written after the box resets, so the innermost ground wins. */
  .draft-body .callout .action-list,
  .draft-body .callout .action-list *,
  .draft-body .sources-box .action-list,
  .draft-body .sources-box .action-list * { color:rgba(245,240,232,.9); }
  .draft-body .callout .action-list h1, .draft-body .callout .action-list h2,
  .draft-body .callout .action-list h3, .draft-body .callout .action-list h4,
  .draft-body .sources-box .action-list h1, .draft-body .sources-box .action-list h2,
  .draft-body .sources-box .action-list h3, .draft-body .sources-box .action-list h4
    { color:var(--gold-300); }
  .draft-body .callout .action-list .label,
  .draft-body .sources-box .action-list .label { color:var(--gold-300); }
  .draft-body .callout .action-list .disclaimer,
  .draft-body .sources-box .action-list .disclaimer { color:rgba(245,240,232,.75); }
  /* …and a white box inside THAT goes back to dark type. */
  .draft-body .callout .action-list .callout,
  .draft-body .callout .action-list .callout *,
  .draft-body .callout .action-list .sources-box,
  .draft-body .callout .action-list .sources-box * { color:var(--slate-600); }

  /* A HIGHLIGHT WINS OVER EVERY GROUND RULE ABOVE IT. Written earlier, the
     panel's own two-class catch-all outranked it and painted cream over the
     gold at 1.06:1; a link inside a highlight measured 1.00:1, gold on gold. */
  .draft-body mark,
  .draft-body mark *,
  .draft-body .action-list mark,
  .draft-body .action-list mark *,
  .draft-body .sources-box mark,
  .draft-body .sources-box mark *,
  .draft-body .callout mark,
  .draft-body .callout mark * { background:var(--gold-300); color:var(--navy-900); }

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
  /* The wrap rules are scoped to .draft-body, and the notes are not in it: a
     fenced code block in a pull-request body ran 148px past the page edge and
     roughly 25 characters of it were never printed. */
  .notes pre, .notes code { white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; }
  .notes { overflow-wrap:break-word; }
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
  // A non-array hits `.length === undefined` and exits 0, so a malformed
  // handoff would be indistinguishable from a quiet week with nothing to review.
  if (!Array.isArray(prs)) throw new Error('DRAFTS_JSON did not contain an array of pull requests.');
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
  // Returns the article paths this body actually printed IN FULL, which is not
  // the same as the ones that rendered: the size guard demotes later drafts to
  // a title in a list. Recording a demoted draft as reviewed locked it out for
  // the week on the strength of a bullet point.
  const writeEmail = async (list, hasPdf) => {
    if (!process.env.EMAIL_HTML_OUT) return [];
    const att = { pdf: hasPdf, docx: await docxOnDisk() };
    const { html, printedPaths } = fitEmailHtml(list, generatedOn, att);
    await fs.writeFile(process.env.EMAIL_HTML_OUT, html);
    return printedPaths;
  };
  await writeEmail(withAge(prs).map(pr => ({ ...pr, articles: [] })), false);

  // Set once the packet is confirmed to contain the drafts — see below.
  let packetOk = false;
  let emptyPrs = new Set();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  /* NO PAGE SCRIPTS, EVER. Stripping <script> inside page.evaluate is too late
     — the parser has already run it. An article carrying
     `<img src=x onerror="document.querySelectorAll('.draft-body').forEach(e=>e.remove())">`
     produced a 34 KB PDF with no cover, no hero and no article body, exit 0,
     and the draft recorded as delivered; one that patched Element.cloneNode
     made the email silently drop every list and callout the packet kept.
     Disabling execution stops both at the door. page.evaluate is unaffected —
     it runs through the Runtime domain, not the page's own script context. */
  await page.setJavaScriptEnabled(false);
  const rendered = [];

  try {
    for (const pr of prs) {
      const { byFile, order, general } = parseNotes(pr.body);
      const paths = await prArticleFiles(pr.number);
      const articles = [];
      const skipped = [];
      /* The subset of `skipped` that is a genuine FAILURE rather than a file
         that was never an article. A hub or landing page added under blog/ is
         legitimate — ledger-published-email.mjs says so in as many words — and
         it will never render, so holding the week open for it mailed the same
         pull request on every trigger, every Monday, for as long as it stayed
         open. Only a render that threw is worth another attempt. */
      const failed = [];

      for (const path of paths) {
        let extracted = null;
        try {
          extracted = await extractArticle(page, await fileAtRef(path, pr.head.sha));
        } catch (err) {
          console.log(`::warning::Could not render ${path} from PR #${pr.number}: ${err.message}`);
          skipped.push(path); failed.push(path);
          continue;
        }
        if (!extracted) {
          console.log(`::warning::${path} in PR #${pr.number} has no .article-body — skipped.`);
          skipped.push(path);
          continue;
        }
        articles.push({ ...extracted, path, notesMd: byFile.get(path) || '' });
      }

      if (!articles.length) {
        console.log(`::warning::PR #${pr.number} contributed no renderable articles.`);
        // Keep the PR in the packet even with nothing rendered: its notes are
        // still reviewable, and the reviewer has to be told the drafts exist.
        const orphanNotes = [...byFile.entries()].map(([path, md]) => ({ title: path, md }));
        rendered.push({ ...pr, articles: [], skipped, failed, general: [...general, ...orphanNotes],
                        age: ageLabel(pr.created_at) });
        continue;
      }

      // Follow the PR body's numbering; anything unnumbered sorts last, by name.
      const rank = p => (order.has(p) ? order.get(p) : Number.MAX_SAFE_INTEGER);
      articles.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));

      // Diff against what actually RENDERED, not against every path the PR
      // touched. Diffing against `paths` meant that when an article failed to
      // render, its reviewer notes matched a path in the list, fell out of the
      // unbound set, and disappeared from the packet and the email both — the
      // notes for the one draft nobody could read were the notes that got lost.
      const shown = new Set(articles.map(a => a.path));
      for (const [path, md] of byFile.entries()) {
        if (!shown.has(path)) general.push({ title: path, md });
      }

      rendered.push({ ...pr, articles, skipped, failed, general, age: ageLabel(pr.created_at) });
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
    /* 'load', but on a short leash. The only subresources left are the webfont
       stylesheet and its font files — every image is stripped — so waiting is
       what gets the packet set in Playfair and Inter rather than fallback
       faces. 'domcontentloaded' does not wait at all, which made the font race
       below a no-op and rendered the packet in fallbacks whenever the
       stylesheet took more than a moment. Fifteen seconds, then carry on: the
       content is parsed either way, and typography is not worth a stalled run. */
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 })
      .catch(() => console.log('::warning::Webfonts did not finish loading in 15s; ' +
                               'the packet may render in fallback faces.'));
    /* The bound has to live in NODE, not in the page. With page scripting
       disabled the page's own setTimeout never fires, so the old in-page race
       had nothing racing: when document.fonts.ready did not settle it blocked
       until Puppeteer's 180-second protocol timeout. A packet in fallback faces
       beats a three-minute stall. */
    await Promise.race([
      page.evaluate(() => document.fonts.ready).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    // C.GREY. The old #8A93A6 measured 3.09:1 on white, on every page.
  const foot = 'font-family:Inter,Arial,sans-serif;font-size:7.5pt;color:#5C6577;width:100%;padding:0 14mm;';
    // Render to a temporary name and move it into place only on success. A
    // page.pdf() that throws partway leaves a truncated but non-empty file, and
    // the workflow's `[ -s "$pdf" ]` test would attach it and call it complete.
    const partial = `${OUT}.partial`;
    await page.pdf({
      path: partial,
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

    await fs.rename(partial, OUT);
    const { size } = await fs.stat(OUT);
    console.log(`Wrote ${OUT} (${Math.round(size / 1024)} KB)`);

    /* Did the packet actually come out with the drafts in it? `fs.rename`
       succeeding only proves a file exists. A blank-but-non-empty PDF passed
       the workflow's `[ -s ]` check, was attached, was described as "each draft
       laid out as it will read on the site", and — because the PDF counts as
       delivery — took the week's lock so nothing retried. */
    const expected = rendered.reduce((n, pr) => n + pr.articles.length, 0);
    const shown = await page.evaluate(() => {
      // `body > article.draft`, not every match in the document: the article's
      // own HTML is injected raw into .draft-body, so an article that itself
      // contained <article class="draft"> inflated the count, failed the check
      // forever, and had the same email re-sent every week.
      const drafts = [...document.querySelectorAll('body > article.draft')];
      const empty = [];
      for (const d of drafts) {
        const b = d.querySelector('.draft-body');
        const got = b ? (b.innerText || '').trim().length : 0;
        // Against what this article SHOULD produce, not a flat floor. A fixed
        // 120 characters called a genuinely short draft empty — and because the
        // verdict was run-wide, that one draft stripped every other pull
        // request in the run of its lock and re-mailed them weekly, forever.
        const want = Number(d.getAttribute('data-chars') || 0);
        if (got < Math.max(20, want * 0.4)) empty.push(d.getAttribute('data-pr'));
      }
      // Per PULL REQUEST, so one bad draft costs only its own.
      return { drafts: drafts.length, empty: [...new Set(empty)] };
    });
    emptyPrs = new Set(shown.empty);
    packetOk = shown.drafts === expected;
    if (!packetOk || emptyPrs.size) {
      const short = emptyPrs.size
        ? `; PR ${[...emptyPrs].map(n => '#' + n).join(', ')} came out much shorter than the source`
        : '';
      console.log(`::warning::The packet rendered ${shown.drafts} of ${expected} drafts${short}. ` +
                  'It is still attached. Any draft the email did not also print in full is not ' +
                  'counted as delivered, so the next run will rebuild and send it again.');
    }

    const printedPaths = new Set(await writeEmail(rendered, true));
    if (process.env.EMAIL_HTML_OUT) console.log(`Wrote ${process.env.EMAIL_HTML_OUT}`);

    /* Which pull requests actually had their article text put in front of the
       reviewer. The workflow records only these as reviewed for the week. A
       run-wide "did anything render" flag locked out a draft whose own article
       failed whenever a sibling's succeeded — recorded as reviewed, delivered
       as a bare link, shut out until the following Monday. */
    /* How many drafts each pull request contributed, rendered or not. The
       subject line is written from this rather than from the number of pull
       requests: one pull request carrying two articles used to be "2 Ledger
       drafts ready for review" in the subject and "3 drafts ready for review"
       in the body of the same message, both saying "drafts". */
    if (process.env.COUNTS_OUT) {
      await fs.writeFile(process.env.COUNTS_OUT, JSON.stringify(Object.fromEntries(
        rendered.map(pr => [String(pr.number), pr.articles.length + (pr.skipped || []).length]))));
    }

    if (process.env.CARRIED_OUT) {
      /* Which pull requests the reviewer has actually been given this week.
         "Given" means in the body OR in the attached PDF, which carries every
         rendered draft in full — that is what the PDF is for, and the body says
         so when the size guard demotes a draft to a listed entry.

         Two ways to get this wrong, and both were live:
         - Keying on the bare path let one pull request's printed article
           satisfy another's membership test when they touched the same slug.
         - Requiring nothing be skipped meant a draft with one unrenderable
           article was never recorded — and since the failure is deterministic,
           every trigger rebuilt it and sent a byte-identical email, weekly,
           forever. An article that cannot be rendered is a defect to fix, not
           a thing to re-mail; the email names it and the Actions log warns. */
      const key = (pr, a) => `${pr.number}:${a.path}`;
      const carried = rendered
        .filter(pr => (pr.articles.length
          ? ((packetOk && !emptyPrs.has(String(pr.number)))
             || pr.articles.every(a => printedPaths.has(key(pr, a))))
          /* Nothing rendered from this pull request. `[].every()` is true, so
             this branch has to be spelled out or a run in which EVERY article
             failed would record every pull request as delivered.

             No article files at all is not a failure: a [Ledger] pull request
             that touched only automation has nothing to render and nothing was
             lost, and the email still names it and links it. Left out of the
             record it was re-sent by both of the week's triggers, every week,
             for as long as it stayed open — the duplicate this whole rework
             exists to remove. Article files that failed to render ARE a loss,
             so those stay out and the Monday floor tries again. */
          /* Nothing to render is not a loss; a render that THREW is. A pull
             request touching only automation, and one adding a hub page under
             blog/, are both ordinary — the email names them and links them,
             and nothing more will ever come of rebuilding them. */
          : !(pr.failed || []).length))
        .map(pr => String(pr.number));
      await fs.writeFile(process.env.CARRIED_OUT, JSON.stringify(carried));
      console.log(`Delivered this week: ${carried.length ? carried.map(n => '#' + n).join(', ') : '(none)'}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
