#!/usr/bin/env node
/* ============================================================================
   THE LEDGER — reviewer notes, as a Word document
   ----------------------------------------------------------------------------
   Called by .github/workflows/ledger-draft-alert.yml. Takes the same open,
   unmerged [Ledger] pull requests the weekly review email is about, and writes
   the reviewer notes out as a .docx that Justin can mark up and send back.

   WHY A SEPARATE SCRIPT — this one never launches a browser. The PDF packet
   needs Chromium to render the articles; the notes are markdown in the PR body
   and need nothing. Keeping them apart means a Chromium failure on the runner
   costs the packet but never the Word note, and vice versa. Both steps are
   continue-on-error, and the email names only the enclosures that actually
   reached disk.

   The notes themselves are parsed by ./ledger-notes.mjs — shared with the PDF
   builder, so the two can never bind a note to a different article.

   Branding follows emails/_template.html and email-chrome.mjs: navy masthead,
   gold letterspaced eyebrows, Georgia draft titles, Arial body and section
   headings, cream note grounds.
   Every page is stamped NOT FOR PUBLICATION — this document is working paper,
   and it must never be mistaken for something a client could receive.

   Env:
     DRAFTS_JSON  path to a JSON array of PRs: {number,title,html_url,body,
                  head:{sha,ref},created_at}
     DOCX_OUT     where to write the .docx (default: Ledger-review-notes.docx)
     GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_API_URL
   ========================================================================== */

import fs from 'node:fs/promises';
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  Header, Footer, PageNumber, Tab,
} from 'docx';
import { parseNotes, ageLabel, generatedOn } from './ledger-notes.mjs';

const API  = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
const OUT  = process.env.DOCX_OUT || 'Ledger-review-notes.docx';

/* Same palette as the email and the PDF, used the same way — read the header
   note in email-chrome.mjs before changing any of it. Two rules bite here:
   GOLD_RULE is a surface and never type, and gold ON NAVY is GOLD_PILL. The
   masthead used to set GOLD_RULE as type on the navy band, which is precisely
   what that note forbids. Every value below is a token from email-chrome.mjs;
   nothing is invented locally. */
const NAVY = '111C33', NAVY_900 = '1B2A4A', NAVY_700 = '2E4A7A';
const GOLD_RULE = 'C9A84C';   // rules and borders only — never type
const GOLD_TEXT = '7E6015';   // gold type on a light ground
const GOLD_PILL = 'F0DCA8';   // gold type on navy
const CREAM = 'F5F0E8', SLATE = '3A4660', GREY = '5C6577';
const HAIRLINE = 'E8E2D6';    // the same hairline as emails/_template.html

/* XML 1.0 has no representation for most C0 control characters — not even as
   a numeric entity — so one stray \x0c anywhere in a PR body produces a .docx
   that is a valid zip full of unparseable XML. The zip opens, nothing errors,
   and the reviewer gets "Word found unreadable content." Strip them, and strip
   unpaired surrogates with them, at the point the data enters this file. */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const xmlSafe = (v, depth = 0) =>
  typeof v === 'string' ? v.replace(XML_ILLEGAL, '').replace(LONE_SURROGATE, '\uFFFD')
  // A depth floor: the real handoff is two levels deep, and unbounded recursion
  // over arbitrary parsed JSON blew the stack rather than writing a document.
  : depth > 12 ? v
  : Array.isArray(v) ? v.map(x => xmlSafe(x, depth + 1))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, xmlSafe(x, depth + 1)]))
  : v;

const SERIF = 'Georgia', SANS = 'Arial';
const pt = n => n * 2;                 // docx sizes are half-points
/* Letter-spacing, in twentieths of a point. The canonical eyebrow is 3px on
   11px type = 0.27em (emails/_template.html). Word takes an absolute measure
   rather than an em, so the ratio has to be recomputed per size — these are
   0.27em at 8pt and at 7.5pt. */
const TRACK_8 = 44, TRACK_75 = 41;

/* ---------- GitHub ------------------------------------------------------- */

async function prArticleFiles(number) {
  if (!REPO || !process.env.GITHUB_TOKEN) return [];
  const files = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ledger-review-notes',
      },
    });
    if (!res.ok) throw new Error(`GitHub API pulls/${number}/files -> ${res.status}`);
    const batch = await res.json();
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files
    .filter(f => f.status !== 'removed')
    .filter(f => /^blog\/[^/]+\.html$/.test(f.filename))
    .filter(f => !f.filename.endsWith('/_template.html'))
    // Through xmlSafe, like everything else that reaches a <w:t>. The header
    // note claims C0 characters are stripped where data enters this file, and
    // this was the one path that bypassed it: [^/]+ happily matches a form feed,
    // and one byte of it produced a valid zip full of unparseable XML — the
    // "Word found unreadable content" dialog, with the run still exiting 0.
    .map(f => xmlSafe(f.filename));
}

/* The email and the packet read titles with textContent, which resolves EVERY
   entity. A hand-written shortlist did not: a shipped article whose <h1> holds
   &ldquo;handled&rdquo; reached the Word note as literal &ldquo; and &rdquo;
   while the other two artifacts printed curly quotes — the same draft under two
   different names again. Numeric and hex forms included. */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', shy: '', lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201a',
  ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e', ndash: '\u2013', mdash: '\u2014',
  hellip: '\u2026', middot: '\u00b7', bull: '\u2022', dagger: '\u2020', prime: '\u2032',
  laquo: '\u00ab', raquo: '\u00bb', deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7',
  divide: '\u00f7', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', euro: '\u20ac', pound: '\u00a3',
  yen: '\u00a5', cent: '\u00a2', sect: '\u00a7', para: '\u00b6', dollar: '$' };
const decodeEntities = t => String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, g) => {
  if (g[0] === '#') {
    const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    // Out of range, or a lone surrogate: leave the source text alone rather
    // than manufacturing a code point that xmlSafe would then have to strip.
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
      ? String.fromCodePoint(n) : m;
  }
  const v = NAMED[g.toLowerCase()];
  return v === undefined ? m : v;
});

/* The article's OWN <h1>, which is what the email and the PDF packet call it.
   Titling the draft from the pull-request body heading instead meant one run
   produced three artifacts naming the same draft two different things —
   "Sep 15 extended returns" in the Word note against "Extended S corp and
   partnership returns are due September 15, 2026" everywhere else. Best effort:
   a hiccup here costs the nicer title, never the note. */
async function articleTitle(path, ref) {
  return (await articleInfo(path, ref)).title;
}

/* Title AND whether the file is an article at all. The note counted every
   blog/*.html in the pull request, so a hub page added beside a draft became
   "2 drafts across 1 pull request" here against "1 article … and 1 more that
   could not be rendered" on the packet cover — three artifacts from one run
   disagreeing about the week. `isArticle` false leaves the file out entirely,
   which is what the packet does. */
async function articleInfo(path, ref) {
  if (!REPO || !process.env.GITHUB_TOKEN) return { title: '', isArticle: true };
  try {
    const res = await fetch(
      `${API}/repos/${REPO}/contents/${encodeURI(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, {
        headers: {
          accept: 'application/vnd.github.raw',
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'ledger-review-notes',
        },
      });
    if (!res.ok) return { title: '', isArticle: true };
    const html = await res.text();
    // The same test the publish notice uses: the class token, inside a tag.
    const tags = html.match(/<[a-zA-Z](?:"[^"]*"|'[^']*'|[^>"'])*>/g) || [];
    const isArticle = tags.some(t =>
      (t.match(/(?:^|[\s"'/])class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi) || [])
        .some(a => a.replace(/^[^=]*=\s*/, '').replace(/^["']|["']$/g, '')
                    .split(/\s+/).includes('article-body')));
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = m
      ? xmlSafe(decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
      : '';
    return { title, isArticle };
  } catch { return { title: '', isArticle: true }; }
}

/* ---------- markdown -> Word --------------------------------------------- */

/**
 * Inline markdown -> docx runs. Handles bold, italic (asterisk or underscore),
 * inline code and links, including bold inside a link. Anything unrecognised
 * stays literal text — a stray asterisk must never eat the rest of a sentence.
 */
/* Backslash escapes are resolved BEFORE the alternation runs, the way marked
   resolves them in a pre-pass. As one more alternative they could not win
   against an emphasis alternative that started earlier: "*a\*b*" printed an
   italic "a\" and a literal "b*", showing the backslash the author wrote to
   hide the asterisk and mis-terminating the emphasis.

   An escape becomes ESC + one index character. ESC is U+E000, private-use, and
   any U+E000 ALREADY IN THE BODY is doubled first so it round-trips — the flat
   "nothing can contain these" version deleted a Powerline glyph pasted out of a
   terminal prompt (U+E0A0) and turned a stray U+E003 into an underscore, while
   the packet printed both unchanged. */
const ESC = '\ue000';
const ESC_BASE = 0xe001;
const ESCAPABLE = '\\`*_{}[]()#+-.!~|<>&"\'';
const maskEscapes = t => String(t)
  .split(ESC).join(ESC + ESC)
  .replace(/\\([\\`*_{}\[\]()#+\-.!~|<>&"'])/g,
           (m, c) => ESC + String.fromCharCode(ESC_BASE + ESCAPABLE.indexOf(c)));
/* `literal` restores the BACKSLASH as well as the character: inside a code span
   CommonMark keeps a backslash literal, so `\d+\.` is a regex and printing it
   as `d+.` corrupts what the reviewer is meant to copy. */
const unmask = (t, literal = false) => String(t).replace(
  new RegExp(ESC + '([\\s\\S])', 'g'),
  (m, c) => {
    if (c === ESC) return ESC;
    const ch = ESCAPABLE[c.charCodeAt(0) - ESC_BASE];
    return ch === undefined ? m : (literal ? '\\' + ch : ch);
  });
const unmaskEscapes = t => unmask(t, false);

function runs(md, base = {}, depth = 0, inLink = false) {
  if (!depth && !inLink) md = maskEscapes(md);
  /* Every emphasis branch recurses now, so the "cannot recurse more than once"
     that used to hold for link text no longer does. Each step strictly shortens
     the string, so this terminates on its own; the cap is a backstop against a
     pathological body, and falling back to a plain run loses styling, never text. */
  if (depth > 6) return [new TextRun({ text: unmaskEscapes(md), font: SANS, size: pt(10), color: SLATE, ...base })];
  const out = [];
  /* Notes on the alternatives, each of which was a bug first:
     - `_` emphasis is guarded against word characters on both sides. GFM
       refuses intraword `_`, and marked (which renders the PDF) obeys that;
       without the guard `blog/september_15_2026.html` came out of the Word
       note as `blog/september152026.html` and `LEDGER_ALERT_SMTP_USER` as
       `LEDGERALERTSMTPUSER` — a working note naming a file that does not exist.
     - The URL allows ONE level of balanced parentheses, because real government
       URLs have them: .../wiki/Tax_(disambiguation), and IRS and CDTFA
       publication anchors do the same. A plain [^)]+ stops at the inner paren,
       producing a dead link and leaking the stray ")" into the sentence. */
  const re = new RegExp([
    // *** *** first, or the ** branch claims the outer pair and leaves a
    // stray asterisk on each side of the text.
    '\\*\\*\\*(?<bi>.+?)\\*\\*\\*',
    '\\*\\*(?<b1>.+?)\\*\\*',
    '(?<![A-Za-z0-9_])__(?<b2>.+?)__(?![A-Za-z0-9_])',
    '\\*(?!\\s)(?<i1>.+?)(?<!\\s)\\*',
    '(?<![A-Za-z0-9_])_(?!\\s)(?<i2>.+?)(?<!\\s)_(?![A-Za-z0-9_])',
    // Double-backtick first: a span written ``a ` b`` holds a literal
    // backtick, and the single-backtick branch closed on it and
    // mis-delimited the rest of the line into monospace.
    '``(?<code2>(?:[^`]|`(?!`))+)``',
    '`(?<code>[^`]+)`',
    // Link text may itself contain balanced brackets — "[Form 1099-NEC
    // [instructions]](https://…)" is ordinary GFM and used to print whole,
    // as text, with no link on it at all.
    '!\\[(?<alt>(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]\\((?<img>(?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\)',
    // <…> first: CommonMark allows spaces inside an angle-bracket destination,
    // which is the form the scan agent reaches for when a URL has one.
    '\\[(?<atext>(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]\\(\\s*<(?<aurl>[^<>]*)>(?:\\s+"[^"]*")?\\s*\\)',
    '\\[(?<text>(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]\\((?<url>(?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\)',
    // A bare CommonMark autolink. The PDF renders it as a live link; the
    // Word note printed the angle brackets and no hyperlink at all.
    '<(?<auto>https?://[^>\\s]+)>',
    // <someone@example.com> — the packet renders a mailto link and this printed
    // the angle brackets with nothing behind them.
    '<(?<mail>[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+)>',
    // GFM strikethrough. `marked` renders <del>; this printed the tildes.
    '~~(?<del>[^~]+)~~',
    // One tilde is GFM strikethrough too; this printed the tildes.
    '~(?<del1>[^~\\s][^~]*?)~(?!~)',
    /* A BARE url, which is how a source gets pasted into a pull-request body
       more often than not, and which the packet turns into a live link. The
       trailing-punctuation trim keeps a sentence's full stop out of the target.
       Last in the alternation so an explicit [text](url) still wins. */
    '(?<bare>https?://[^\\s<>()\\[\\]]+(?:\\([^\\s()]*\\)[^\\s<>()\\[\\]]*)*)',
    /* GFM's extended autolinks, which is how a source actually gets pasted into
       a pull-request body: a bare www. host and a bare email address. The packet
       turns both into live links; this printed them as plain text, so the
       reviewer lost the one route back to the source. */
    '(?<![A-Za-z0-9.@/-])(?<www>www\\.[^\\s<>()\\[\\]]+(?:\\([^\\s()]*\\)[^\\s<>()\\[\\]]*)*)',
    '(?<![A-Za-z0-9._%+-])(?<bmail>[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)',
  ].join('|'), 'gs');
  let last = 0, m;
  const lit = t => { if (t) out.push(new TextRun({ text: unmaskEscapes(t), font: SANS, size: pt(10), color: SLATE, ...base })); };

  while ((m = re.exec(md)) !== null) {
    lit(md.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups;
    const bold = g.b1 ?? g.b2, ital = g.i1 ?? g.i2;
    /* RECURSE, do not emit the capture as a flat run. Only the link branch used
       to descend, so anything WRAPPING a link swallowed it: PIPELINE.md's own
       "**Source** **[IRS Notice 2026-12](https://…)**" citation convention
       printed the whole bracket-and-parenthesis form as literal text, in bold,
       with no hyperlink in the document at all — the reviewer's one route back
       to the source. Emphasis nested inside emphasis was flattened the same
       way. Every branch now recurses, with its own styling folded into `base`
       so the inner runs inherit it. */
    if (g.del !== undefined || g.del1 !== undefined) {
      out.push(...runs(g.del ?? g.del1, { ...base, strike: true }, depth + 1, inLink));
    } else if (g.bi !== undefined) {
      out.push(...runs(g.bi, { ...base, bold: true, italics: true }, depth + 1, inLink));
    } else if (bold !== undefined) {
      out.push(...runs(bold, { ...base, bold: true, color: NAVY_900 }, depth + 1, inLink));
    } else if (ital !== undefined) {
      out.push(...runs(ital, { ...base, italics: true }, depth + 1, inLink));
    } else if (g.code !== undefined || g.code2 !== undefined) {
      // color AFTER the spread: inside a bold run `base.color` is navy-900, and
      // spreading it last repainted code spans with it.
      // CommonMark strips ONE leading and trailing space when both are present
      // and the span is not all spaces — that is how ``` `` ` `` ``` yields a
      // lone backtick. Not a trim(): interior padding is content.
      const raw = g.code ?? g.code2;
      const codeText = /^ [\s\S]* $/.test(raw) && raw.trim() ? raw.slice(1, -1) : raw;
      // font and size after the spread, like color: a heading passes font: SANS
      // and size: pt(11) as `base`, and spreading it last repainted the code
      // span in Arial — a file path in a heading then read as a hyperlink.
      out.push(new TextRun({ text: unmask(codeText, true), ...base, font: 'Consolas',
                             size: Math.max(14, Math.round((base.size || pt(10)) * 0.95)),
                             color: NAVY_700 }));
    } else {
      /* EVERY destination goes through this. Three of the four branches used to
         take the raw match: a masked escape reached word/_rels as a literal
         U+E000 (a dead link whose visible text read correctly), and an entity
         in an autolink or a bare URL opened a different address than the
         packet's link. */
      /* xmlSafe LAST. decodeEntities turns "&#12;" back into a form feed, and
         this string goes straight into a Target= attribute in
         word/_rels/document.xml.rels, which nothing else sanitises — a valid
         zip whose rels part is not well-formed XML, written with exit 0, is the
         "Word found unreadable content" dialog. articleTitle() already ends
         with xmlSafe for the same reason. */
      const target = u => xmlSafe(decodeEntities(unmaskEscapes(String(u || '').trim())));
      const linkRun = text => new TextRun({
        text: unmaskEscapes(text), font: SANS, size: pt(10), ...base,
        color: NAVY_700, underline: { type: 'single', color: NAVY_700 },
      });
      if (g.bare !== undefined) {
        // Trailing sentence punctuation is not part of the URL.
        const m2 = g.bare.match(/^(.*?)([.,;:!?]*)$/s);
        const dest = target(m2[1]), tail = m2[2];
        out.push(inLink
          ? linkRun(m2[1])
          : new ExternalHyperlink({ link: dest, children: [linkRun(m2[1])] }));
        if (tail) lit(tail);
        continue;
      }
      if (g.img !== undefined) {
        // An image a reviewer cannot see in a Word note is still worth naming
        // and linking; this printed a bare "!" in front of a link.
        const label = unmaskEscapes(g.alt || '').trim() || 'image';
        out.push(inLink ? linkRun(label)
          : new ExternalHyperlink({ link: target(g.img), children: [linkRun(label)] }));
        continue;
      }
      if (g.mail !== undefined || g.bmail !== undefined) {
        const addr = g.mail ?? g.bmail;
        out.push(inLink ? linkRun(addr)
          : new ExternalHyperlink({ link: `mailto:${target(addr)}`, children: [linkRun(addr)] }));
        continue;
      }
      if (g.www !== undefined) {
        const m3 = g.www.match(/^(.*?)([.,;:!?]*)$/s);
        out.push(inLink ? linkRun(m3[1])
          : new ExternalHyperlink({ link: `https://${target(m3[1])}`, children: [linkRun(m3[1])] }));
        if (m3[2]) lit(m3[2]);
        continue;
      }
      /* A HYPERLINK INSIDE A HYPERLINK IS NOT A THING WORD CAN OPEN. docx only
         converts an ExternalHyperlink at the paragraph level, so one nested in
         another serialized as a bare <w:externalHyperlink/> — an element that
         does not exist in ECMA-376 — and took its own text with it: the inner
         words and URL were simply gone from the document. The outer link wins,
         which is what a reader can actually click; the inner one keeps its text
         and its underline and stops being a relationship. */
      if (g.auto !== undefined) {
        // A bare autolink: the text and the target are the same string.
        // Decoded for display too: the packet showed "&" where this showed
        // "&amp;" in the very same URL.
        const shown = decodeEntities(g.auto);
        out.push(inLink ? linkRun(shown) : new ExternalHyperlink({
          link: target(g.auto),
          children: [linkRun(shown)],
        }));
        continue;
      }
      // Recurse into the link text so **bold** and `code` inside a link render
      // as bold and code, not as literal asterisks and backticks. The doc
      // comment above has always claimed this; now it is true. Link text
      // cannot contain a bracket, so this cannot recurse more than once.
      const style = { ...base, color: NAVY_700, underline: { type: 'single', color: NAVY_700 } };
      // CommonMark lets a destination be wrapped in angle brackets — the form
      // the scan agent reaches for when a URL has a query string. Kept literal,
      // the link target became "&lt;https://...&gt;" and was simply dead.
      // Entities in a destination are decoded, the way marked decodes them:
      // taken verbatim, "?a=1&amp;b=2" reached Word as "?a=1&amp;amp;b=2" and
      // opened a different address than the packet's link.
      const rawText = g.text ?? g.atext;
      // A space in a destination is percent-encoded, as marked encodes it.
      const url = target((g.aurl ?? g.url ?? '').replace(/^<(.*)>$/s, '$1')).replace(/ /g, '%20');
      const kids = rawText ? runs(rawText, style, depth + 1, true)
                          : [new TextRun({ text: unmaskEscapes(url || rawText || ''), font: SANS, size: pt(10), ...style })];
      // An empty destination — [text](<>) — would become an external
      // relationship with Target="", a dead link Word may object to.
      if (!url || inLink) out.push(...kids);
      else out.push(new ExternalHyperlink({ link: url, children: kids }));
    }
  }
  lit(md.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: SANS, size: pt(10) })];
}

/* `md` goes through runs() so a heading can hold a link, code or emphasis —
   the packet renders all three and this printed the raw markdown, hyperlink
   included, with no relationship in the document at all. The heading's own
   styling is the `base`, so the inline runs inherit it. */
const noteHeading = (md, level) => new Paragraph({
  keepNext: true,
  spacing: { before: level === 3 ? 200 : 160, after: 80 },
  children: runs(String(md ?? ''), {
    font: SANS, bold: true, color: NAVY_900,
    size: level === 3 ? pt(11) : pt(10.5),
  }),
});

/* `instance` is what makes two ordered lists two lists. With a single instance
   Word continues one sequence through the whole document, so the "After
   merging" list under article 2 came out 3. 4. rather than 1. 2. — and kept
   climbing for every list in every draft. */
/* A list that starts at 1 is a real Word numbered list. One that does not is
   written out by hand.

   docx exposes `instance` — which is what gives each list its own sequence —
   but no way to set that instance's startOverride, so an ol starting at 5 was
   silently renumbered 1, 2, 3 while the packet printed 5, 6, 7. "Confirm the
   FTB date, step 5" then named a different step in each artifact. Word list
   semantics are worth less than the two documents agreeing, so these carry the
   number as text at the same indent and hang. */
const bullet = (md, ordered, level, instance = 0, n = null) => new Paragraph({
  spacing: { after: 60 },
  ...(ordered && n !== null
    ? { indent: { left: 720 + level * 360, hanging: 360 } }
    : ordered ? { numbering: { reference: 'ledger-ol', level, instance } }
              : { bullet: { level } }),
  children: [
    ...(ordered && n !== null
      ? [new TextRun({ text: `${n}.`, font: SANS, size: pt(10), color: SLATE }), new TextRun({ children: [new Tab()] })]
      : []),
    ...runs(md),
  ],
});

/** A markdown table -> a bordered Word table. Alignment rows are dropped. */
/* Split on a pipe that is NOT escaped. Splitting on every pipe turned
   "| a \| b | fine |" into three cells against a two-column header, so the
   headings no longer labelled the data and a stray backslash was printed. */
/* Split on an UNESCAPED pipe, counting backslashes: a doubled backslash is a
   literal backslash and the pipe after it is a real boundary, which a simple
   negative lookbehind got backwards — "| x\\|y | z |" came out as two cells
   holding different data than the packet's, with a stray \| printed. */
const splitRow = line => {
  const t = String(line).trim();
  const cells = [];
  let cur = '', slash = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') { slash++; cur += c; continue; }
    if (c === '|' && slash % 2 === 0) { cells.push(cur); cur = ''; slash = 0; continue; }
    slash = 0; cur += c;
  }
  cells.push(cur);
  // A leading and a trailing pipe are the row's own delimiters, not cells.
  if (cells.length && !cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells;
};

function mdTable(lines) {
  const cells = l => splitRow(l).map(c => c.trim());
  // Drop row 1 and only row 1. The caller has already established that it is
  // the alignment row; filtering by shape instead deleted legitimate data rows
  // such as `| - | - |`, which is how a notes table says "not applicable".
  const rows = lines.map(cells);
  if (rows.length > 1) rows.splice(1, 1);
  if (!rows.length) return [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE };
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border,
               insideHorizontal: border, insideVertical: border },
    rows: rows.map((cols, r) => new TableRow({
      tableHeader: r === 0,
      children: cols.map(c => new TableCell({
        shading: r === 0 ? { type: ShadingType.CLEAR, fill: CREAM } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: runs(c, r === 0 ? { bold: true } : {}) })],
      })),
    })),
  }),
  new Paragraph({ spacing: { after: 120 }, children: [] })];
}

/**
 * Reviewer-note markdown -> Word blocks. The scan agent writes ordinary GFM:
 * `###`/`####` headings, `-` bullets, `1.` lists, tables, links and emphasis.
 * Unknown constructs degrade to plain paragraphs rather than being dropped.
 */
/* Module-level, so two notes in the same document never share an instance and
   a second article's "1. 2." cannot continue the first's. */
let olInstance = 0;

// Every cell dashes, AND as many cells as the header row — both are GFM
// requirements, and without the second a two-column header over a one-cell
// delimiter still rendered as a table here and as a paragraph in the packet.
const isDelimiterRow = (line, header) => {
  const cells = splitRow(line);
  if (!cells.length || !cells.every(c => /^\s*:?-+:?\s*$/.test(c))) return false;
  return header === undefined || cells.length === splitRow(header).length;
};

/* Reference links. `marked` collects "[label]: https://…" definition lines,
   hides them, and resolves [text][label] / [label][] / [label] against them;
   this printed both the use and the definition as literal text. Resolved into
   inline form before the block walk, which is the smallest change that makes
   the note and the packet agree. */
const slot = i => `${ESC}\ue0ff${i}\ue0fe`;
const SLOT_RE = new RegExp(`^${ESC}\\ue0ff(\\d+)\\ue0fe$`);

const resolveRefs = md => {
  /* CODE IS NOT MARKDOWN. This ran over the whole body before the fence branch
     ever saw it, so a definition quoted inside a ``` block was deleted from the
     sample and a [label] beside it was rewritten into a link the author never
     typed — in a document whose entire purpose is to be copied from. A fence
     holding nothing but definitions disappeared altogether. Fences and 4-space
     indented blocks are lifted out, the resolution runs on what is left, and
     they go back exactly as they were. */
  const src = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  const out = [];
  let fence = null;
  for (const line of src) {
    const t = line.trim();
    if (fence) {
      const m = t.match(/^(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      kept.push(line); out.push(slot(kept.length - 1)); continue;
    }
    const open = t.match(/^(`{3,}|~{3,})/);
    if (open) { fence = open[1]; kept.push(line); out.push(slot(kept.length - 1)); continue; }
    // An indented code block: four spaces or a tab, and not a list continuation.
    if (/^(?: {4}|\t)/.test(line) && line.trim()) { kept.push(line); out.push(slot(kept.length - 1)); continue; }
    out.push(line);
  }
  /* The placeholder carries its own INDEX. A flat marker was matched by any
     body line equal to it, which consumed a restore slot that was never filled
     and silently deleted a line. Indexed, a stray marker in the body restores
     nothing and stays as itself. */
  const restore = t => t.split('\n')
    .map(l => { const m = l.match(SLOT_RE); return m && kept[+m[1]] !== undefined ? kept[+m[1]] : l; })
    .join('\n');

  const defs = new Map();
  const body = out.join('\n').replace(
    /^[ \t]*\[([^\]\n]+)\]:[ \t]*(\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$\n?/gm,
    (m, label, url) => { if (!defs.has(label.toLowerCase())) defs.set(label.toLowerCase(), url); return ''; });
  if (!defs.size) return restore(out.join('\n'));
  const at = label => defs.get(String(label).toLowerCase());
  return restore(body
    // [text][label]
    .replace(/\[([^\]\n]*)\]\[([^\]\n]+)\]/g, (m, text, label) => {
      const u = at(label); return u ? `[${text}](${u})` : m;
    })
    // [label][] and a bare [label] that is not already a link or an image
    .replace(/(!?)\[([^\]\n]+)\](\[\])?(?!\()/g, (m, bang, label, empty) => {
      if (bang) return m;
      const u = at(label);
      return u && (empty || defs.has(label.toLowerCase())) ? `[${label}](${u})` : m;
    }));
};

function mdBlocks(md) {
  const lines = resolveRefs(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  /* One counter per nesting level, so a sub-list under a hand-numbered list
     counts on its own instead of every item printing the parent's number. */
  let inOl = false, inList = false, olNums = [], olDelim = '';

  const flush = () => {
    if (!para.length) return;
    out.push(new Paragraph({ spacing: { after: 120, line: 280 }, children: runs(para.join(' ')) }));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    /* What ENDS an ordered list run: a non-blank, UNINDENTED line that is not
       itself an ordered item at the top level — a heading, a rule, a table, a
       fence, a blockquote, a new paragraph. It has to be at the TOP of the
       loop, because every branch below `continue`s past anything written after
       it, which is how two lists separated by a "### After merging" heading
       ended up sharing one sequence.
       What does NOT end it: a blank line (a loose list is still one list), an
       indented continuation line, and a nested sub-list of either kind. Ending
       the run on those meant a list written "1. / 1. / 1." — the house style in
       automation/PIPELINE.md, and legal markdown that renders 1, 2, 3 —
       restarted at 1 in Word after every nested bullet. */
    if (t && !/^\s/.test(line) && !/^([-*+]|\d+[.)])\s+/.test(line)) { inList = false; }
    if (t && !/^\s/.test(line) && !/^\d+[.)]\s+/.test(line)) { inOl = false; olNums = []; }

    // A fenced block is verbatim. Without this, `# comment` inside a code
    // sample became a heading and `- item` became a bullet, and the fence
    // markers printed as prose.
    if (/^(```|~~~)/.test(t)) {
      flush();
      /* CHARACTER AND LENGTH, both. Matching on the first three characters
         alone meant a ```` ```` ```` block quoting a ``` block closed on the
         INNER fence: the quoted sample came out empty and the "## 1. Title"
         inside it was promoted to a real heading in the middle of the notes.
         The mirror case — a ~~~~ block closed on a ~~~ line — swallowed the
         rest of the section into one code block. CommonMark: a closing fence
         is the same character and AT LEAST as long. ledger-notes.mjs has
         always got this right; this file had not. */
      const open = t.match(/^(`{3,}|~{3,})/)[1];
      const closes = ln => {
        const m = ln.trim().match(/^(`{3,}|~{3,})\s*$/);
        return !!m && m[1][0] === open[0] && m[1].length >= open.length;
      };
      const code = [];
      for (i++; i < lines.length && !closes(lines[i]); i++) code.push(lines[i]);
      if (code.length) {
        out.push(new Paragraph({
          spacing: { after: 120 },
          shading: { type: ShadingType.CLEAR, fill: CREAM },
          indent: { left: 240, right: 240 },
          children: code.flatMap((c, n) => [
            ...(n ? [new TextRun({ break: 1 })] : []),
            new TextRun({ text: c, font: 'Consolas', size: pt(9), color: NAVY_700 }),
          ]),
        }));
      }
      continue;
    }

    if (!t) { flush(); continue; }

    /* A 4-SPACE INDENTED CODE BLOCK. There was no branch for one, so its lines
       reached the paragraph buffer trimmed and were joined with a space: two
       shell commands became one line, and the URL in them was linkified. Only
       when a paragraph is not already open and no list is — an indented line
       under a paragraph is a lazy continuation, and under a bullet it is the
       rest of the bullet. Guarding on `inOl` alone turned the wrapped second
       line of an ordinary "- **Confidence notes**: …" item — the shape
       automation/PIPELINE.md itself uses — into a cream code block, detached
       from the bullet it belongs to, and a 4-space-nested sub-bullet into a
       literal "- nested" in Consolas. */
    if (!para.length && !inList && /^(?: {4}|\t)/.test(line)) {
      const code = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (/^(?: {4}|\t)/.test(l)) { code.push(l.replace(/^(?: {4}|\t)/, '')); continue; }
        if (!l.trim()) { code.push(''); continue; }
        break;
      }
      i--;
      while (code.length && !code[code.length - 1].trim()) code.pop();
      if (code.length) {
        out.push(new Paragraph({
          spacing: { after: 120 },
          shading: { type: ShadingType.CLEAR, fill: CREAM },
          indent: { left: 240, right: 240 },
          children: code.flatMap((c, n) => [
            ...(n ? [new TextRun({ break: 1 })] : []),
            new TextRun({ text: c, font: 'Consolas', size: pt(9), color: NAVY_700 }),
          ]),
        }));
      }
      continue;
    }

    if (/^#{1,6}\s/.test(t)) {
      flush();
      const depth = t.match(/^#+/)[0].length;
      out.push(noteHeading(t.replace(/^#+\s*/, ''), depth <= 3 ? 3 : 4));
      continue;
    }
    /* SETEXT headings — "Sources checked" over a row of = or -. The PDF packet
       renders them as headings; here the underline was swallowed by the rule
       branch below and the title left as body prose, or, with =, the two lines
       ran together into one paragraph. Checked before the rule branch, because
       a --- under text is a heading and a --- under a blank line is a rule. */
    const under = lines[i + 1] && lines[i + 1].trim();
    if (t && !inOl && under && /^(=+|-{2,})$/.test(under) &&
        !/^[-*+]\s/.test(t) && !/^\d+[.)]\s/.test(t)) {
      flush();
      out.push(noteHeading(t, under[0] === '=' ? 3 : 4));
      i++;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(t)) { flush(); continue; }        // horizontal rule

    /* EVERY cell of the delimiter row has to be dashes. The old test only
       needed one dash somewhere, so "| - | pending |" looked like a delimiter,
       mdTable spliced that row out unconditionally, and the word "pending"
       vanished from the document — while `marked` renders none of those three
       lines as a table at all. */
    if (t.startsWith('|') && lines[i + 1] && isDelimiterRow(lines[i + 1], line)) {
      flush();
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      i--;
      out.push(...mdTable(block));
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const level = Math.min(2, Math.floor(li[1].replace(/\t/g, '  ').length / 2));
      const ordered = /\d/.test(li[2]);
      // A new numbering instance whenever a TOP-LEVEL ordered list starts.
      /* A NEW LIST, not just a new item: "1." and "1)" are different markers, so
         a run of each is two lists — Word merged them into one sequence and
         printed 1, 2, 3, 4 where the packet printed 1, 2 then 1, 2. */
      const delim = ordered ? li[2].slice(-1) : '';
      if (ordered && !level && (!inOl || delim !== olDelim)) {
        olInstance++;
        olNums = [];
        olDelim = delim;
      }
      if (!level) inOl = ordered;
      inList = true;
      let n = null;
      if (ordered) {
        /* A LEVEL IS HAND-NUMBERED IF ITS OWN LIST DOES NOT START AT 1, or if
           an enclosing level already is — a Word list cannot be told where to
           start, so once one level is written out by hand the levels under it
           have to be too or they inherit the parent's number. Gating the whole
           thing on the TOP level meant a sub-list written "5. / 6." under an
           ordinary "1." list printed 1. and 2., while the packet printed 5 and
           6: "check step 5" naming different steps in one email's two
           enclosures. */
        /* `undefined` means NOT YET DECIDED; `null` means "Word numbers this
           level". Treating them alike re-ran the decision on every item, so a
           list written "1. / 5. / 6." printed 1, 5, 6 where marked — and so the
           packet — prints 1, 2, 3: only the FIRST marker of a list decides
           where it starts. */
        if (!(level in olNums) || olNums[level] === undefined) {
          const own = parseInt(li[2], 10);
          const outerHand = olNums.slice(0, level).some(v => v !== null && v !== undefined);
          olNums[level] = (Number.isFinite(own) && own !== 1) || outerHand
            ? (Number.isFinite(own) ? own : 1)
            : null;
        }
        if (olNums[level] !== null) { n = olNums[level]; olNums[level]++; }
        olNums.length = level + 1;        // a shallower item restarts the deeper ones
      } else if (!level) {
        olNums = [];
      }
      // GFM task list. The packet draws a checkbox; this printed a literal
      // "[ ]" in front of the item.
      const task = li[3].match(/^\[([ xX])\]\s+(.*)$/);
      const body = task ? `${task[1] === ' ' ? '\u2610' : '\u2611'} ${task[2]}` : li[3];
      out.push(bullet(body, ordered, level, olInstance, n));
      continue;
    }

    if (t.startsWith('>')) {
      flush();
      out.push(new Paragraph({
        spacing: { after: 120 }, indent: { left: 360 },
        children: runs(t.replace(/^>\s?/, ''), { italics: true }),
      }));
      continue;
    }

    para.push(t);
  }
  flush();
  return out;
}

/* ---------- branded chrome ----------------------------------------------- */

const eyebrow = (text, color = GOLD_TEXT) => new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({
    text: text.toUpperCase(), font: SANS, bold: true, size: pt(8),
    color, characterSpacing: TRACK_8,
  })],
});

const rule = (color = GOLD_RULE, size = 6) => new Paragraph({
  spacing: { before: 60, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size, color, space: 1 } },
  children: [],
});

/** The navy title block. Shading is on the paragraphs, so it survives export. */
function masthead(draftCount, prCount) {
  // Inset from the band edge the way the email masthead is inset from its navy
  // panel — type flush against a shaded edge reads as a mistake.
  const band = (children, spacing) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: NAVY },
    indent: { left: 288, right: 288 },
    spacing,
    children,
  });
  return [
    band([new TextRun({ text: 'J PARK & ASSOCIATES · THE LEDGER', font: SANS, bold: true,
                        size: pt(8), color: GOLD_PILL, characterSpacing: TRACK_8 })],
         { before: 240, after: 40 }),
    // The masthead serif line; article titles use it too. This is the masthead — the role
    // Georgia plays in the email. Everything under it is working paper, and
    // ledger-draft-pdf.mjs is explicit that sans is what marks it as such.
    band([new TextRun({ text: 'Reviewer notes', font: SERIF, bold: true, size: pt(26), color: CREAM })],
         { after: 60 }),
    band([new TextRun({ text: generatedOn(), font: SANS, size: pt(10), color: GOLD_PILL })],
         { after: 40 }),
    band([new TextRun({
      text: `${draftCount} draft${draftCount === 1 ? '' : 's'} across ` +
            `${prCount} pull request${prCount === 1 ? '' : 's'}  ·  NOT FOR PUBLICATION`,
      font: SANS, bold: true, size: pt(8), color: GOLD_PILL, characterSpacing: TRACK_8,
    })], { after: 240 }),
    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: runs(
        'These are the working notes behind this week’s Ledger drafts — the sources each ' +
        'article rests on, why it was drafted, and anything the scan hedged on. The articles ' +
        'themselves are in the review email and the attached PDF. Mark up anything that needs ' +
        'changing and take it to the pull request, or merge as it stands if it reads right.'),
    }),
  ];
}

/**
 * The scan agent opens every article section with the same meta line —
 *     `blog/<slug>.html` · category `deadlines` · 5 min
 * — which is what binds the notes to the file. It belongs under the headline as
 * a byline, not as the note's first paragraph, so lift it out of the body here
 * rather than printing the path twice.
 */
function articleBlock(title, path, md) {
  let meta = path, body = md || '';
  const first = body.match(/^\s*(`?blog\/[A-Za-z0-9._-]+\.html`?[^\n]*)\n?/);
  if (first) {
    meta = first[1].replace(/`/g, '').trim();
    body = body.slice(first[0].length).replace(/^\s*\n/, '');
  }
  return [
  new Paragraph({
    keepNext: true, spacing: { before: 320, after: 40 },
    // Georgia, like the headline type in the email and the packet — the header
    // note has always claimed the pairing and every heading was Arial.
    children: [new TextRun({ text: title, font: SERIF, bold: true, size: pt(14), color: NAVY_900 })],
  }),
  new Paragraph({
    keepNext: true, spacing: { after: 120 },
    // Through runs(): the byline is the line the author writes after the
    // heading, and "**needs a fact check**" appended to it printed its
    // asterisks here while the packet bolded them.
    children: runs(meta, { font: 'Consolas', size: pt(9), color: GREY }),
  }),
  rule(GOLD_RULE, 4),
  ...(body.trim() ? mdBlocks(body) : [new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({
      text: 'No notes for this draft were found in the pull request body. Check the pull request ' +
            'directly before merging.',
      font: SANS, size: pt(10), color: GREY, italics: true,
    })],
  })]),
  ];
}

/* ---------- main --------------------------------------------------------- */

async function main() {
  const prs = xmlSafe(JSON.parse(await fs.readFile(process.env.DRAFTS_JSON, 'utf8')));
  // A non-array would hit `.length === undefined` and exit 0, so a malformed
  // handoff would look exactly like a quiet week with nothing to review.
  if (!Array.isArray(prs)) throw new Error('DRAFTS_JSON did not contain an array of pull requests.');
  if (!prs.length) {
    console.log('No draft PRs supplied — no review note to write.');
    return;
  }

  const children = [];
  let draftCount = 0;

  for (const pr of prs) {
    const { byFile, order, titles, general } = parseNotes(pr.body);
    let paths = [], listed = true;
    try {
      paths = await prArticleFiles(pr.number);
    } catch (err) {
      console.log(`::warning::Could not list files for PR #${pr.number}: ${err.message}`);
      listed = false;
    }
    /* Fall back to whatever the PR body bound ONLY when the listing FAILED, so
       a GitHub hiccup costs the file list but never the notes. Falling back
       whenever the list came back empty made this document disagree with the
       other two about the week: a pull request that legitimately touched no
       blog/*.html was "1 draft" here and "0 articles" on the packet cover. */
    if (!listed && !paths.length) paths = [...byFile.keys()];

    const rank = p => (order.has(p) ? order.get(p) : Number.MAX_SAFE_INTEGER);
    paths = [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    // Counted AFTER the article loop below drops the non-articles; counting
    // here made the masthead say two drafts for a draft and a hub page.

    children.push(
      eyebrow(`Pull request #${pr.number} · open ${ageLabel(pr.created_at)}`),
      new Paragraph({
        keepNext: true, spacing: { after: 60 },
        children: [new TextRun({ text: pr.title, font: SANS, bold: true, size: pt(12), color: NAVY_900 })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `branch ${pr.head && pr.head.ref || '—'}  ·  `, font: SANS, size: pt(9), color: GREY }),
          ...(pr.html_url
            ? [new ExternalHyperlink({
                link: pr.html_url,
                children: [new TextRun({ text: pr.html_url, font: SANS, size: pt(9), color: NAVY_700,
                                         underline: { type: 'single', color: NAVY_700 } })],
              })]
            : [new TextRun({ text: '—', font: SANS, size: pt(9), color: GREY })]),
        ],
      }),
      rule(NAVY_700, 8),
    );

    const kept = [];
    for (const path of paths) {
      const info = await articleInfo(path, pr.head && pr.head.sha);
      if (!info.isArticle) {
        console.log(`::warning::${path} in PR #${pr.number} is not an article page; not counted as a draft.`);
        continue;
      }
      kept.push(path);
      children.push(...articleBlock(info.title || titles.get(path) || path.replace(/^blog\/|\.html$/g, ''),
                                    path, byFile.get(path)));
    }
    paths = kept;
    draftCount += paths.length;

    // Notes that never bound to an article still belong in the document.
    const unbound = [...byFile.entries()].filter(([p]) => !paths.includes(p));
    const runNotes = [...general, ...unbound.map(([p, md]) => ({ title: p, md }))];
    if (runNotes.length) {
      children.push(
        new Paragraph({ spacing: { before: 360, after: 40 }, children: [] }),
        eyebrow('Run notes — not for publication', NAVY_700),
        rule(NAVY_700, 8),
      );
      for (const s of runNotes) {
        children.push(noteHeading(s.title, 3), ...mdBlocks(s.md));
      }
    }
  }

  const doc = new Document({
    creator: 'The Ledger Bot',
    lastModifiedBy: 'The Ledger Bot',   // else Word shows the library's "Un-named"
    title: 'The Ledger — reviewer notes',
    description: 'Working notes behind this week’s Ledger article drafts. Not for publication.',
    styles: {
      default: { document: { run: { font: SANS, size: pt(10), color: SLATE } } },
    },
    numbering: {
      config: [{
        reference: 'ledger-ol',
        levels: [0, 1, 2].map(level => ({
          level, format: 'decimal', text: `%${level + 1}.`, alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
        })),
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD_RULE, space: 4 } },
            children: [
              new TextRun({ text: 'J PARK & ASSOCIATES', font: SANS, bold: true, size: pt(7.5),
                            color: NAVY_900, characterSpacing: TRACK_75 }),
              new TextRun({ text: '   ·   THE LEDGER · REVIEWER NOTES · NOT FOR PUBLICATION',
                            font: SANS, bold: true, size: pt(7.5), color: GOLD_TEXT, characterSpacing: TRACK_75 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [
          // The firm bio, verbatim from blog/_template.html. Every other Ledger
          // artifact carries it; this document was the only one whose footer
          // did not say who the firm is.
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE, space: 4 } },
            spacing: { after: 40 },
            children: [new TextRun({
              text: 'A personalized CPA office on Foothill Blvd. in La Crescenta, keeping the books, ' +
                    'taxes, and payroll of Crescenta Valley and Los Angeles businesses in order for ' +
                    'over 15 years.',
              font: SANS, size: pt(7.5), color: GREY,
            })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: '2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214  ·  (818) 248-1580  ·  Page ',
                            font: SANS, size: pt(8), color: GREY }),
              new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: pt(8), color: GREY }),
              new TextRun({ text: ' of ', font: SANS, size: pt(8), color: GREY }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: pt(8), color: GREY }),
            ],
          })],
        }),
      },
      children: [...masthead(draftCount, prs.length), ...children],
    }],
  });

  await fs.writeFile(OUT, await Packer.toBuffer(doc));
  const { size } = await fs.stat(OUT);
  console.log(`Wrote ${OUT} (${Math.round(size / 1024)} KB) — ${draftCount} draft(s), ${prs.length} PR(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
