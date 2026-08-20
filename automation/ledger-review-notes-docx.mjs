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
   gold letterspaced eyebrows, Georgia headings, Arial body, cream note grounds.
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
  Header, Footer, PageNumber,
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

/* The article's OWN <h1>, which is what the email and the PDF packet call it.
   Titling the draft from the pull-request body heading instead meant one run
   produced three artifacts naming the same draft two different things —
   "Sep 15 extended returns" in the Word note against "Extended S corp and
   partnership returns are due September 15, 2026" everywhere else. Best effort:
   a hiccup here costs the nicer title, never the note. */
async function articleTitle(path, ref) {
  if (!REPO || !process.env.GITHUB_TOKEN) return '';
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
    if (!res.ok) return '';
    const html = await res.text();
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return '';
    const t = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '\u2019')
                  .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '\u2014').replace(/\s+/g, ' ').trim();
    return xmlSafe(t);
  } catch { return ''; }
}

/* ---------- markdown -> Word --------------------------------------------- */

/**
 * Inline markdown -> docx runs. Handles bold, italic (asterisk or underscore),
 * inline code and links, including bold inside a link. Anything unrecognised
 * stays literal text — a stray asterisk must never eat the rest of a sentence.
 */
function runs(md, base = {}, depth = 0) {
  /* Every emphasis branch recurses now, so the "cannot recurse more than once"
     that used to hold for link text no longer does. Each step strictly shortens
     the string, so this terminates on its own; the cap is a backstop against a
     pathological body, and falling back to a plain run loses styling, never text. */
  if (depth > 6) return [new TextRun({ text: md, font: SANS, size: pt(10), color: SLATE, ...base })];
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
    '\\[(?<text>(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]\\((?<url>(?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\)',
    // A bare CommonMark autolink. The PDF renders it as a live link; the
    // Word note printed the angle brackets and no hyperlink at all.
    '<(?<auto>https?://[^>\\s]+)>',
  ].join('|'), 'gs');
  let last = 0, m;
  const lit = t => { if (t) out.push(new TextRun({ text: t, font: SANS, size: pt(10), color: SLATE, ...base })); };

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
    if (g.bi !== undefined) {
      out.push(...runs(g.bi, { ...base, bold: true, italics: true }, depth + 1));
    } else if (bold !== undefined) {
      out.push(...runs(bold, { ...base, bold: true, color: NAVY_900 }, depth + 1));
    } else if (ital !== undefined) {
      out.push(...runs(ital, { ...base, italics: true }, depth + 1));
    } else if (g.code !== undefined || g.code2 !== undefined) {
      // color AFTER the spread: inside a bold run `base.color` is navy-900, and
      // spreading it last repainted code spans with it.
      // CommonMark strips ONE leading and trailing space when both are present
      // and the span is not all spaces — that is how ``` `` ` `` ``` yields a
      // lone backtick. Not a trim(): interior padding is content.
      const raw = g.code ?? g.code2;
      const codeText = /^ [\s\S]* $/.test(raw) && raw.trim() ? raw.slice(1, -1) : raw;
      out.push(new TextRun({ text: codeText, font: 'Consolas', size: pt(9.5), ...base, color: NAVY_700 }));
    } else {
      if (g.auto !== undefined) {
        // A bare autolink: the text and the target are the same string.
        out.push(new ExternalHyperlink({
          link: g.auto,
          children: [new TextRun({ text: g.auto, font: SANS, size: pt(10), ...base,
                                   color: NAVY_700, underline: { type: 'single', color: NAVY_700 } })],
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
      const url = g.url.replace(/^<(.*)>$/s, '$1');
      out.push(new ExternalHyperlink({
        link: url,
        children: g.text ? runs(g.text, style, depth + 1)
                         : [new TextRun({ text: url, font: SANS, size: pt(10), ...style })],
      }));
    }
  }
  lit(md.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: SANS, size: pt(10) })];
}

const noteHeading = (text, level) => new Paragraph({
  keepNext: true,
  spacing: { before: level === 3 ? 200 : 160, after: 80 },
  children: [new TextRun({
    text, font: SANS, bold: true, color: NAVY_900,
    size: level === 3 ? pt(11) : pt(10.5),
  })],
});

/* `instance` is what makes two ordered lists two lists. With a single instance
   Word continues one sequence through the whole document, so the "After
   merging" list under article 2 came out 3. 4. rather than 1. 2. — and kept
   climbing for every list in every draft. */
const bullet = (md, ordered, level, instance = 0) => new Paragraph({
  spacing: { after: 60 },
  ...(ordered ? { numbering: { reference: 'ledger-ol', level, instance } } : { bullet: { level } }),
  children: runs(md),
});

/** A markdown table -> a bordered Word table. Alignment rows are dropped. */
function mdTable(lines) {
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
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

function mdBlocks(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let inOl = false;

  const flush = () => {
    if (!para.length) return;
    out.push(new Paragraph({ spacing: { after: 120, line: 280 }, children: runs(para.join(' ')) }));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

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
    if (t && !inOl && under && /^(=+|-{2,})$/.test(under) && !/^[-*+]\s/.test(t)) {
      flush();
      out.push(noteHeading(t, under[0] === '=' ? 3 : 4));
      i++;
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(t)) { flush(); continue; }        // horizontal rule

    if (t.startsWith('|') && lines[i + 1] && /^\s*\|?[\s:|-]*-[\s:|-]*\|/.test(lines[i + 1])) {
      flush();
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      i--;
      out.push(...mdTable(block));
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    // Any non-blank line that is NOT a list item ends the run. A blank one does
    // not — a loose list is still one list, and restarting it there would put
    // two "1."s in what the reader sees as a single sequence.
    if (!li && t) inOl = false;
    if (li) {
      flush();
      const level = Math.min(2, Math.floor(li[1].replace(/\t/g, '  ').length / 2));
      const ordered = /\d/.test(li[2]);
      // A new numbering instance whenever an ordered list STARTS — that is,
      // when this ordered item does not directly follow another one.
      if (ordered && !inOl) olInstance++;
      inOl = ordered;
      out.push(bullet(li[3], ordered, level, olInstance));
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
    // The only serif line in the document. This is the masthead — the role
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
    children: [new TextRun({ text: title, font: SANS, bold: true, size: pt(14), color: NAVY_900 })],
  }),
  new Paragraph({
    keepNext: true, spacing: { after: 120 },
    children: [new TextRun({ text: meta, font: 'Consolas', size: pt(9), color: GREY })],
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
    let paths = [];
    try {
      paths = await prArticleFiles(pr.number);
    } catch (err) {
      console.log(`::warning::Could not list files for PR #${pr.number}: ${err.message}`);
    }
    // Fall back to whatever the PR body itself bound, so a GitHub hiccup costs
    // the file list but never the notes.
    if (!paths.length) paths = [...byFile.keys()];

    const rank = p => (order.has(p) ? order.get(p) : Number.MAX_SAFE_INTEGER);
    paths = [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    draftCount += paths.length;

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

    for (const path of paths) {
      const h1 = await articleTitle(path, pr.head && pr.head.sha);
      children.push(...articleBlock(h1 || titles.get(path) || path.replace(/^blog\/|\.html$/g, ''),
                                    path, byFile.get(path)));
    }

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
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE, space: 4 } },
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
