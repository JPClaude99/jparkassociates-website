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
    for (const el of body.querySelectorAll('style, script, link, meta, base, iframe, object, embed')) {
      el.remove();
    }
    /* Attributes, not just elements. A single inline style can cover the whole
       packet — `position:fixed;width:100%;height:100%;background:#fff` renders
       every page blank — and `display:none` makes the packet and the email
       disagree about what the article even says. Event handlers are inert with
       scripting disabled, but they are stripped so the packet's HTML cannot
       carry one into any future renderer. data-ledger-* is ours: an article
       that spoofs it could delete its own content from the email. */
    for (const el of body.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on') || n === 'style' || n.startsWith('data-ledger-')) el.removeAttribute(attr.name);
      }
    }

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
                           'HR', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'FORM']);
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
    const inlineNode = (n, onNavy) => {
      if (n.nodeType === 3) return escHtml(n.nodeValue);
      if (n.nodeType !== 1 || BLOCK.has(n.tagName)) return '';
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
        case 'CODE':   return `<code style="font-family:Consolas,Menlo,monospace;font-size:13px;color:${mono};">${inline(n, onNavy)}</code>`;
        case 'SUP':    return `<sup>${inline(n, onNavy)}</sup>`;
        case 'SUB':    return `<sub>${inline(n, onNavy)}</sub>`;
        case 'SCRIPT':
        case 'STYLE':  return '';
        default:       return inline(n, onNavy);   // span, and anything unexpected
      }
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
      const add = t => { if (t && t.trim()) out += (out && !/\s$/.test(out) ? ' ' : '') + t; };
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { out += escHtml(n.nodeValue); continue; }
        if (n.nodeType !== 1) continue;
        if (BLOCK.has(n.tagName)) add(flatten(n, onNavy));
        else out += inlineNode(n, onNavy);
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
      clone.querySelectorAll(`[${MARK}]`)
        .forEach(n => n.replaceWith(n.ownerDocument.createTextNode(' ')));
      nodes.forEach(n => n.removeAttribute(MARK));
      return clone;
    };

    const CONTAINER_CLASS = ['callout', 'action-list', 'sources-box'];
    const OWNED_SEL = 'ul, ol, table, pre, blockquote, dl, figure, .callout, .action-list, .sources-box';
    const isContainer = el => el.tagName === 'LI' || HEAVY.has(el.tagName) ||
      CONTAINER_CLASS.some(c => el.classList.contains(c));

    const cellsOf = tr => [...tr.children]
      .filter(c => c.tagName === 'TH' || c.tagName === 'TD')
      .map(c => ({
        html: flatten(c, false),
        // Carried through, or a merged header cell shifts every value in the
        // row one column left and puts a California date under "Form".
        colspan: Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1),
        rowspan: Math.max(1, parseInt(c.getAttribute('rowspan') || '1', 10) || 1),
      }));

    const tableBlock = (el) => {
      // Scoped: an unscoped querySelectorAll('tr') hoisted the rows of a nested
      // table out of their cell and made them siblings of the outer table.
      const trs = [...el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
      const rows = trs.map(tr => ({
        header: [...tr.children].some(c => c.tagName === 'TH'),
        cells: cellsOf(tr),
      })).filter(r => r.cells.length);
      const capEl = el.querySelector(':scope > caption');
      const cap = text(capEl);
      const out = [];
      if (cap) out.push({ kind: 'h3', text: cap });
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
      for (const c of el.children) {
        if (c.tagName === 'DT') {
          if (term) list.push({ html: bold(term), depth: 0 });   // term with no definition
          term = flatten(c, onNavy);
        } else if (c.tagName === 'DD') {
          list.push({ html: term ? `${bold(term)} &mdash; ${flatten(c, onNavy)}` : flatten(c, onNavy), depth: 0 });
          term = '';
        }
      }
      if (term) list.push({ html: bold(term), depth: 0 });        // trailing orphan term
      return list.length ? [{ kind: 'list', ordered: false, items: list }] : [];
    };

    /* A list becomes a SEQUENCE of blocks, not a list plus a pile of leftovers.
       Emitting an item's table after the whole list printed step 1's figures
       below step 2. Each heavy block breaks the list where it actually sits. */
    const listBlocks = (list, onNavy, depth = 0) => {
      const out = [];
      let run = [];
      const flush = () => {
        if (run.length) out.push({ kind: 'list', ordered: list.tagName === 'OL', items: run });
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

        // The item's own text: everything except what it owns, which is
        // emitted in its own right below.
        const html = flatten(withoutNodes(li, owned), onNavy).trim();
        // An <li> whose only content is a table used to emit a blank bullet.
        if (html) run.push({ html, depth });
        for (const node of owned) {
          if (node.tagName === 'UL' || node.tagName === 'OL') {
            for (const b of listBlocks(node, onNavy, depth + 1)) {
              if (b.kind === 'list') run.push(...b.items);
              else { flush(); out.push(b); }
            }
          } else {
            flush();
            out.push(...blocksOfNode(node, onNavy));
          }
        }
      }
      flush();
      return out;
    };

    /** One element -> its email blocks. Split out so a list item, a table cell
        and the body can all reach the same handling. */
    const blocksOfNode = (el, onNavy) => {
      const cls = el.classList;
      switch (el.tagName) {
        case 'P':
          return text(el)
            ? [cls.contains('disclaimer')
                ? { kind: 'disclaimer', html: inline(el, onNavy) }
                : { kind: 'p', html: inline(el, onNavy) }]
            : [];
        case 'H1': case 'H2': return [{ kind: 'h2', text: text(el) }];
        case 'H3': case 'H4':
        case 'H5': case 'H6': return [{ kind: 'h3', text: text(el) }];
        case 'UL': case 'OL':  return listBlocks(el, onNavy);
        case 'TABLE':          return tableBlock(el);
        case 'DL':             return dlBlock(el, onNavy);
        case 'PRE':            return text(el) ? [{ kind: 'pre', text: el.textContent.replace(/\s+$/, '') }] : [];
        case 'HR':             return [];
        case 'BLOCKQUOTE': {
          const inner = blocksOf(el, onNavy);
          if (inner.length) return [{ kind: 'callout', label: '', blocks: inner }];
          // No inner blocks does not mean no content — a bare-text quote used
          // to render as an empty cream box.
          return text(el) ? [{ kind: 'callout', label: '', blocks: [{ kind: 'p', html: inline(el, onNavy) }] }] : [];
        }
        case 'FIGURE': {
          // The raster is dropped on purpose; the caption is not. A figcaption
          // routinely carries the only statement of what a chart shows.
          const cap = el.querySelector('figcaption');
          return text(cap) ? [{ kind: 'disclaimer', html: inline(cap, onNavy) }] : [];
        }
        default: {
          if (cls.contains('callout')) {
            // The label node itself, wherever it sits — and the SAME node is
            // what gets removed. Reading `:scope > .label` while removing
            // `.label` at any depth deleted a nested label without using it.
            const label = el.querySelector('.label');
            const clone = el.cloneNode(true);
            const labels = [...clone.querySelectorAll('.label')];
            if (label && labels.length) labels[0].remove();
            const blocks = blocksOf(clone, onNavy);
            return blocks.length ? [{ kind: 'callout', label: text(label), blocks }] : [];
          }
          if (cls.contains('action-list') || cls.contains('sources-box')) {
            const isAction = cls.contains('action-list');
            /* Lists belonging to a NESTED callout or sources box are that box's,
               not this panel's. Adopting them printed a source URL as an action
               step with a checkmark and left the nested box rendering as an
               empty navy bar. */
            const lists = ownedBy(el, 'ul, ol',
                                  p => isContainer(p) || p.classList.contains('label'));
            const listSet = new Set(lists);
            const label = isAction ? null : el.querySelector('.label');

            /* Walk the children IN ORDER and split at the first list. Collecting
               every paragraph into `lead` regardless of where it sat printed
               trailing prose above the checklist, and a table that introduced
               the steps below them. */
            const before = [], after = [], items = [];
            let seenList = false;
            let heading = '';
            const sink = () => (seenList ? after : before);
            for (const node of el.childNodes) {
              if (node.nodeType === 3) {
                const t = node.nodeValue.trim();
                if (t) sink().push({ kind: 'p', html: escHtml(t) });
                continue;
              }
              if (node.nodeType !== 1) continue;
              const mine = lists.filter(l => l === node || node.contains(l));
              if (mine.length) {
                for (const l of mine) {
                  for (const b of listBlocks(l, isAction, 0)) {
                    if (b.kind === 'list') items.push(...b.items);
                    else after.push(b);
                  }
                }
                seenList = true;
                // A wrapper around the list may carry prose of its own.
                if (!listSet.has(node)) {
                  for (const b of blocksOf(withoutNodes(node, mine), isAction)) sink().push(b);
                }
                continue;
              }
              if (label && (node === label || node.contains(label))) {
                if (node !== label) for (const b of blocksOf(withoutNodes(node, [label]), false)) sink().push(b);
                continue;
              }
              if (isAction && !heading && /^H[1-6]$/.test(node.tagName)) { heading = text(node); continue; }
              for (const b of blocksOfNode(node, isAction)) sink().push(b);
            }

            /* Prose stays on the panel's ground; anything else leaves it. A
               callout computed for navy and then rendered on cream put #F5F0E8
               text on an #F5F0E8 background — the inverse of the bug the onNavy
               flag exists to prevent — so what leaves is recomputed for light. */
            // Only the action panel has a `lead` slot. Folding a sources box's
            // prose into one dropped it: the panel renders label and citations
            // and nothing else. For that panel everything stays a real block.
            const lead = [], leadOut = [];
            for (const b of before) {
              if (!isAction) leadOut.push(b);
              else if (b.kind === 'p' || b.kind === 'disclaimer') lead.push(b.html);
              else if (b.kind === 'h2' || b.kind === 'h3') lead.push(`<strong>${escHtml(b.text)}</strong>`);
              else leadOut.push(b);
            }
            const relight = bs => (isAction ? bs.map(b => relightBlock(b)) : bs);
            const panel = isAction
              ? { kind: 'action', heading, lead, items }
              : { kind: 'sources', label: text(label) || 'Sources', items };
            return [...relight(leadOut), panel, ...relight(after)];
          }
          if ([...el.children].some(c => BLOCK.has(c.tagName))) return blocksOf(el, onNavy);
          return text(el) ? [{ kind: 'p', html: inline(el, onNavy) }] : [];
        }
      }
    };

    /** Re-colour a block that was computed for navy but is leaving the panel. */
    const relightBlock = (b) => {
      const swap = h => String(h)
        .split(P.GOLD_PILL).join(P.NAVY_900)
        .split(`color:${P.CREAM}`).join(`color:${P.NAVY_900}`);
      const out = { ...b };
      if (out.html) out.html = swap(out.html);
      if (out.items) out.items = out.items.map(i => (typeof i === 'string' ? swap(i) : { ...i, html: swap(i.html) }));
      if (out.blocks) out.blocks = out.blocks.map(relightBlock);
      if (out.rows) out.rows = out.rows.map(r => ({ ...r, cells: r.cells.map(c => ({ ...c, html: swap(c.html) })) }));
      return out;
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
        if (!BLOCK.has(node.tagName)) { buf += inlineNode(node, onNavy); continue; }
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
  const preheader = counted
    ? `${plural(all.length, 'Ledger article')} drafted and waiting — the full text is below.`
    : 'Ledger drafts are written and waiting — merging publishes them.';
  // What this body will actually print in full, which is not always what was
  // drafted: the size guard demotes later drafts to a listed entry, and some
  // may have failed to render. Saying "reproduced in full below" regardless
  // was a promise the message broke sixty kilobytes later.
  const inFull = Math.min(fullCount, all.length);
  const total = all.length + skipped.length;
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
  .draft-body .callout .label { color:var(--gold-text); }
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

      for (const path of paths) {
        let extracted = null;
        try {
          extracted = await extractArticle(page, await fileAtRef(path, pr.head.sha));
        } catch (err) {
          console.log(`::warning::Could not render ${path} from PR #${pr.number}: ${err.message}`);
          skipped.push(path);
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
        rendered.push({ ...pr, articles: [], skipped, general: [...general, ...orphanNotes],
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

      rendered.push({ ...pr, articles, skipped, general, age: ageLabel(pr.created_at) });
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
    const shown = await page.evaluate(() => ({
      drafts: document.querySelectorAll('article.draft').length,
      chars: (document.body.innerText || '').trim().length,
    }));
    packetOk = shown.drafts === expected && shown.chars > 500;
    if (!packetOk) {
      console.log(`::warning::The packet rendered ${shown.drafts} of ${expected} drafts and ` +
                  `${shown.chars} characters. It is still attached, but it is NOT counted as ` +
                  'delivery, so the next run will rebuild and send again.');
    }

    const printedPaths = new Set(await writeEmail(rendered, true));
    if (process.env.EMAIL_HTML_OUT) console.log(`Wrote ${process.env.EMAIL_HTML_OUT}`);

    /* Which pull requests actually had their article text put in front of the
       reviewer. The workflow records only these as reviewed for the week. A
       run-wide "did anything render" flag locked out a draft whose own article
       failed whenever a sibling's succeeded — recorded as reviewed, delivered
       as a bare link, shut out until the following Monday. */
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
        .filter(pr => pr.articles.length
                   && (packetOk || pr.articles.every(a => printedPaths.has(key(pr, a)))))
        .map(pr => String(pr.number));
      await fs.writeFile(process.env.CARRIED_OUT, JSON.stringify(carried));
      console.log(`Delivered this week: ${carried.length ? carried.map(n => '#' + n).join(', ') : '(none)'}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
