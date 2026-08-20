/* ============================================================================
   J PARK & ASSOCIATES — shared email chrome
   ----------------------------------------------------------------------------
   One shell for every automated Ledger email, so the weekly review and the
   publish notice cannot drift apart. Matches emails/_template.html: cream
   ground, 640px table, navy masthead, gold letterspaced eyebrow, Georgia
   headings, Arial body.

   DARK MODE — read this before changing a colour.

   Declaring `color-scheme` is NOT enough. Apple Mail and iOS Mail honour it;
   the Gmail iOS and Android apps ignore it and invert the message anyway, and
   these alerts go to a Gmail/Workspace mailbox. So the palette is chosen to
   SURVIVE inversion rather than to prevent it. Every foreground/background
   pair here was measured against three models — as-sent, Gmail-iOS (255-c)
   and Gmail-Android (HSL lightness flip) — and clears 4.5:1 in all three.

     • The masthead is ONE full-width image with navy baked into its own
       canvas. Clients never invert image pixels, so that is the only ground
       that cannot move out from under the white wordmark. A transparent PNG
       on a navy <td> does NOT survive: the td flips pale and the wordmark
       disappears.
     • GOLD_PILL #F0DCA8 carries the button and any gold on navy. Mid-tone
       #C9A84C flips to another mid-tone — the old pill measured 1.69:1 under
       the Android model.
     • GOLD_TEXT #7E6015 is gold type on light grounds. #C9A84C as text is
       2.29:1 on white, a failure that predates dark mode entirely; it
       survives only as a surface — rules and borders — never as type.

   Outlook.com rewrites the DOM instead of honouring media queries: data-ogsb
   marks a changed BACKGROUND, data-ogsc a changed TEXT COLOUR, and it stamps
   the attribute on the element it changed, not on a wrapper. An element is
   not its own ancestor, so every rule needs BOTH the descendant form and the
   self form or it silently matches nothing.

   Inline styles carry the light palette so a client with no <style> support
   still gets the intended design; the <style> block only ever overrides.
   ========================================================================== */

export const C = {
  NAVY: '#111c33',
  NAVY_900: '#1B2A4A',
  GOLD_RULE: '#C9A84C',   // surfaces only — never type
  GOLD_TEXT: '#7E6015',   // gold type on light grounds
  GOLD_PILL: '#F0DCA8',   // button, and gold on navy
  CREAM: '#F5F0E8',
  SLATE: '#3A4660',
  GREY: '#5C6577',
  WHITE: '#ffffff',
};

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const HEAD_IMG = 'https://jparkassociates.com/assets/brand/logo-email-header-640.png';

/** A bordered white panel — used for each PR or each published article. */
export const panel = inner => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr><td class="e-item" bgcolor="${C.WHITE}" style="background-color:${C.WHITE};border:1px solid #e8e2d6;border-radius:10px;padding:18px 22px;">
        ${inner}
      </td></tr>
    </table>`;

/** The cream, gold-ruled aside. `accent` lets a neutral state drop the gold. */
export const callout = (label, inner, accent = C.GOLD_RULE) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
      <td class="e-callout" bgcolor="${C.CREAM}" style="background-color:${C.CREAM};border-left:4px solid ${accent};border-radius:10px;padding:20px 24px;">
        ${label ? `<p class="t-gold" style="margin:0 0 8px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:${C.GOLD_TEXT};">${esc(label)}</p>` : ''}
        ${inner}
      </td>
    </tr></table>`;

/**
 * Full email document.
 * @param {object} o
 * @param {string} o.preheader  inbox preview text
 * @param {string} o.eyebrow    e.g. "The Ledger · weekly draft review"
 * @param {string} o.headline   masthead headline
 * @param {string} o.dateLine   date under the headline
 * @param {string} o.bodyHtml   markup for the white card
 * @param {string} o.asideHtml  optional callout block, already wrapped
 * @param {object} o.cta        { href, label, lead, caption }
 * @param {string} o.footNote   small print under the address block (HTML)
 */
export function emailShell(o) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${esc(o.title || o.headline)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }

  @media (prefers-color-scheme: dark) {
    .e-page   { background-color: #0b1220 !important; }
    .e-card   { background-color: #16203a !important; }
    .e-item   { background-color: #22304c !important; border-color: #3d4d6e !important; }
    .e-callout{ background-color: #22304c !important; }
    .e-cta    { border: 1px solid #3d4d6e !important; }
    /* A table header cell carried .t-strong (which flips to cream) and a cream
       background that did not, so every rate-table header measured 1.00:1 —
       cream on cream, invisible — in Apple Mail, iOS Mail and Gmail web dark. */
    .e-th     { background-color: #2b3a5c !important; }
    .e-cell   { border-color: #3d4d6e !important; }
    .t-title, .t-strong { color: ${C.CREAM} !important; }
    .t-body   { color: #cbd3e1 !important; }
    .t-muted, .t-foot { color: #9aa6bd !important; }
    .t-gold, .t-link  { color: ${C.GOLD_PILL} !important; }
  }

  [data-ogsb] .e-page,    .e-page[data-ogsb]    { background-color: #0b1220 !important; }
  [data-ogsb] .e-card,    .e-card[data-ogsb]    { background-color: #16203a !important; }
  [data-ogsb] .e-item,    .e-item[data-ogsb]    { background-color: #22304c !important; border-color: #3d4d6e !important; }
  [data-ogsb] .e-callout, .e-callout[data-ogsb] { background-color: #22304c !important; }
  [data-ogsb] .e-th,      .e-th[data-ogsb]      { background-color: #2b3a5c !important; }
  [data-ogsb] .e-cell,    .e-cell[data-ogsb]    { border-color: #3d4d6e !important; }
  [data-ogsb] .e-cta,     .e-cta[data-ogsb]     { border: 1px solid #3d4d6e !important; }
  [data-ogsc] .t-title,   .t-title[data-ogsc],
  [data-ogsc] .t-strong,  .t-strong[data-ogsc]  { color: ${C.CREAM} !important; }
  [data-ogsc] .t-body,    .t-body[data-ogsc]    { color: #cbd3e1 !important; }
  [data-ogsc] .t-muted,   .t-muted[data-ogsc],
  [data-ogsc] .t-foot,    .t-foot[data-ogsc]    { color: #9aa6bd !important; }
  [data-ogsc] .t-gold,    .t-gold[data-ogsc],
  [data-ogsc] .t-link,    .t-link[data-ogsc]    { color: ${C.GOLD_PILL} !important; }
</style>
</head>
<body class="e-page" bgcolor="${C.CREAM}" style="margin:0;padding:0;background-color:${C.CREAM};">
<div style="display:none;font-size:0;line-height:0;max-height:0;opacity:0;overflow:hidden;mso-hide:all;"><span id="ledger-preheader">${esc(o.preheader)}</span>${'&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-page" bgcolor="${C.CREAM}" style="background-color:${C.CREAM};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;">

  <!-- Masthead: one full-width image, navy baked into the file. See header note. -->
  <tr><td bgcolor="${C.NAVY}" style="background-color:${C.NAVY};border-radius:14px 14px 0 0;padding:0;font-size:0;line-height:0;">
    <img src="${HEAD_IMG}" alt="J Park &amp; Associates &mdash; Certified Public Accountants" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />
  </td></tr>

  <tr><td bgcolor="${C.NAVY}" style="background-color:${C.NAVY};padding:6px 36px 34px;">
    <p style="margin:0 0 8px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${C.GOLD_PILL};">${esc(o.eyebrow)}</p>
    <h1 style="margin:0;font:700 30px/1.2 Georgia,'Times New Roman',serif;color:${C.CREAM};">${esc(o.headline)}</h1>
    <p style="margin:12px 0 0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.GOLD_PILL};">${esc(o.dateLine)}</p>
  </td></tr>

  <tr><td class="e-card" bgcolor="${C.WHITE}" style="background-color:${C.WHITE};padding:30px 36px 6px;">
    ${o.bodyHtml}
  </td></tr>

  ${o.asideHtml ? `
  <tr><td class="e-card" bgcolor="${C.WHITE}" style="background-color:${C.WHITE};padding:6px 36px 6px;">
    ${o.asideHtml}
  </td></tr>` : ''}

  <tr><td class="e-card" bgcolor="${C.WHITE}" style="background-color:${C.WHITE};border-radius:0 0 14px 14px;padding:28px 36px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="e-cta" bgcolor="${C.NAVY_900}" style="background-color:${C.NAVY_900};border-radius:12px;padding:26px 28px;" align="center">
        <p style="margin:0 0 14px;font:400 15px/1.5 Arial,Helvetica,sans-serif;color:${C.CREAM};">${esc(o.cta.lead)}</p>
        <a href="${esc(o.cta.href)}" style="display:inline-block;background-color:${C.GOLD_PILL};color:${C.NAVY};font:600 14px/1 Arial,Helvetica,sans-serif;text-decoration:none;border-radius:999px;padding:13px 28px;">${esc(o.cta.label)}</a>
        <p style="margin:14px 0 0;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:${C.GOLD_PILL};">${esc(o.cta.caption)}</p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:24px 36px 8px;" align="center">
    <p class="t-foot" style="margin:0 0 6px;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};">
      J Park &amp; Associates &middot; Certified Public Accountants<br />
      2529 Foothill Blvd. Ste 101, La Crescenta, CA 91214 &middot; (818) 248-1580
    </p>
    <!-- The firm bio, verbatim from blog/_template.html and emails/_template.html.
         The Ledger's own mail is the one place it was missing, so the weekly
         review and the publish notice were the only J Park & Associates pages
         whose footer did not say who the firm is. -->
    <p class="t-foot" style="margin:0 0 6px;font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};">
      A personalized CPA office on Foothill Blvd. in La Crescenta, keeping the books, taxes,
      and payroll of Crescenta Valley and Los Angeles businesses in order for over 15 years.
    </p>
    <p class="t-foot" style="margin:0;font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};">${o.footNote}</p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}

/* ============================================================================
   ARTICLE BODY -> EMAIL HTML
   ----------------------------------------------------------------------------
   The weekly review email carries a full copy of each drafted article, not a
   list of titles, so the article can be read and judged in the inbox without
   opening GitHub or the PDF.

   The article arrives as a normalized BLOCK LIST, not as site markup. The
   blocks are produced from a real DOM in the browser (ledger-draft-pdf.mjs) and
   carry only whitelisted inline HTML, so nothing from the article's stylesheet,
   scripts or layout can leak into a mail client. Rendering lives here, next to
   the rest of the chrome, so the email and the PDF share one palette.

   Block kinds — see extractArticle() in ledger-draft-pdf.mjs:
     {kind:'p', html}                     {kind:'h2'|'h3', text}
     {kind:'list', ordered, items:[html]} {kind:'callout', label, blocks}
     {kind:'action', heading, items}      {kind:'sources', label, items}
     {kind:'disclaimer', html}
   ========================================================================== */

const BODY_FONT = "400 15px/1.7 Arial,Helvetica,sans-serif";
const SERIF     = "Georgia,'Times New Roman',serif";

/* Gmail clips a message past ~102 KB behind a "View entire message" link, and
   it measures the message ON THE WIRE — quoted-printable encoding, headers,
   MIME boundaries and the text/plain alternative all included. Measuring the
   decoded HTML against 102 KB therefore passes messages that Gmail then clips:
   a body that decodes to 103 KB composed to 112 KB on the wire, ~8 KB over.
   QP inflation on this content measures ~7%; 1.15 leaves room for the headers
   and the plain-text part on top of that. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
const WIRE_OVERHEAD = 1.15;
export const htmlBudget = () => Math.floor(GMAIL_CLIP_BYTES / WIRE_OVERHEAD);

/* Items arrive flattened, each carrying its nesting depth. Nested <ul> inside
   <li> is the markup mail clients disagree about most, so depth becomes an
   indent on a flat list — same reading order, no client-specific collapse. */
const listHtml = (items, ordered, start, type, reversed) => {
  const norm = items.map(i => (typeof i === 'string' ? { html: i, depth: 0 } : i));
  const tag = ordered ? 'ol' : 'ul';
  // `start` carried through, or the packet prints 5,6,7 and the email 1,2,3.
  // `!== 1`, not `> 1`: start="0" and negatives are real values the packet
  // honours, and the two artifacts have to agree on what a step is called.
  // start / type / reversed all carried: the packet honours them, and the two
  // artifacts have to agree on what a step is called.
  const from = ordered && Number.isFinite(start) && start !== 1 ? ` start="${Number(start)}"` : '';
  const kind = ordered && /^[1aAiI]$/.test(String(type || '')) ? ` type="${type}"` : '';
  const rev = ordered && reversed ? ' reversed' : '';
  /* Sub-items are <li> here and nested <li> in the packet, so an <ol> holding
     one counted it and the packet did not: "1. file 2.(sub) 3. pay" against
     "1. file / sub / 2. pay". Every top-level step therefore states its own
     number. Not for `reversed` — its base is the item count, which a list
     split across blocks no longer knows; there the client's own count is
     closer than a guess. */
  let n = ordered && !reversed ? (Number.isFinite(start) ? Number(start) : 1) : null;
  /* `cont` is the REST of an item that a table or a figure interrupted. It is
     the same step, so it gets no marker and consumes no number — otherwise the
     PDF's "2." was the email's "3." from the first interrupted step onward. */
  const marker = i => (i.cont ? 'list-style:none;'
                             : i.depth ? `margin-left:${i.depth * 18}px;list-style-type:circle;` : '');
  return `
      <${tag}${from}${kind}${rev} class="t-body" style="margin:0 0 16px;padding-left:22px;font:${BODY_FONT};color:${C.SLATE};">
        ${norm.map(i => `<li${n !== null && !i.depth && !i.cont ? ` value="${n++}"` : ''} style="margin:0 0 7px;${marker(i)}">${i.html}</li>`).join('')}
      </${tag}>`;
};

/** A real table, because a rate table flattened into a paragraph is unreadable
    — "1120-SSep 15Sep 15" is not a deadline anyone can act on.
    Cells arrive as {html, colspan, rowspan}: a merged header cell that loses
    its span shifts every value in the row one column left, which is how a
    California date ends up printed under "Form". */
const tableHtml = rows => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse;">
      ${rows.map(r => `<tr>${r.cells.map(cell => {
        const c = typeof cell === 'string' ? { html: cell, colspan: 1, rowspan: 1 } : cell;
        // Three kinds of cell, not two: a column heading (cream, bold), a row
        // LABEL — a <th> in a row that also has data cells, which the browser
        // bolds but does not fill — and a data cell.
        const isTh = c.header ?? r.header;
        const tag = isTh ? 'th' : 'td';
        const span = `${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`;
        const style = r.header
          ? `background-color:${C.CREAM};font:700 13px/1.5 Arial,Helvetica,sans-serif;color:${C.NAVY_900};`
          : isTh
            ? `font:700 13px/1.5 Arial,Helvetica,sans-serif;color:${C.NAVY_900};`
            : `font:400 13px/1.5 Arial,Helvetica,sans-serif;color:${C.SLATE};`;
        // e-th / e-cell so the header's GROUND and the rule between cells move
        // with the text when a client flips to dark. Without the first of them
        // .t-strong turned the header text cream on a cream cell.
        return `<${tag} class="e-cell ${r.header ? 't-strong e-th' : isTh ? 't-strong' : 't-body'}" align="left" valign="top"${span}` +
               `${r.header ? ` bgcolor="${C.CREAM}"` : ''} style="${style}border:1px solid #e8e2d6;padding:8px 10px;">${c.html}</${tag}>`;
      }).join('')}</tr>`).join('')}
    </table>`;

// `html` when the block carried markup — a citation link inside a code sample
// is the whole reason a reviewer would look at one.
const preHtml = (text, html) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
      <td class="e-callout" bgcolor="${C.CREAM}" style="background-color:${C.CREAM};border-radius:8px;padding:14px 16px;">
        <pre class="t-body" style="margin:0;font:400 12px/1.55 Consolas,Menlo,monospace;color:${C.SLATE};white-space:pre-wrap;word-break:break-word;">${html || esc(text)}</pre>
      </td>
    </tr></table>`;

/** The navy "do this before <date>" block. Checkmarks are cells, not bullets:
    list-style images are stripped by Outlook and ::before never renders. */
const actionHtml = (heading, items, lead = [], ordered = false, start = 1) => {
  // An ORDERED checklist numbers its steps in the marker column instead of
  // repeating the checkmark: the packet renders the <ol> markers, and a panel
  // that dropped them left "fix step 4" pointing at nothing.
  let n = start;
  const marker = i => (i && i.cont ? '' : ordered ? `${n++}.` : '&#10003;');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
      <td class="e-cta" bgcolor="${C.NAVY_900}" style="background-color:${C.NAVY_900};border-radius:10px;padding:20px 24px;">
        ${heading ? `<p style="margin:0 0 12px;font:700 15px/1.35 ${SERIF};color:${C.GOLD_PILL};">${esc(heading)}</p>` : ''}
        ${lead.map(l => `<p style="margin:0 0 12px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.CREAM};">${l}</p>`).join('')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${items.map(i => `
          <tr>
            <td width="20" valign="top" style="font:700 14px/1.6 ${SERIF};color:${C.GOLD_PILL};">${marker(i)}</td>
            <td style="font:400 14px/1.6 Arial,Helvetica,sans-serif;color:${C.CREAM};padding-bottom:7px;">${indent(i)}</td>
          </tr>`).join('')}
        </table>
      </td>
    </tr></table>`;
};

/* Indent a nested item rather than flattening it. listHtml was fixed to honour
   depth and these two call sites were not, so a sub-step of an action item read
   as its own action and a sub-source read as a sibling citation. */
const indent = i => (typeof i === 'string' ? i : (i.depth
  ? `<span style="padding-left:${i.depth * 16}px;display:inline-block;">&#8250; ${i.html}</span>`
  : i.html));

const sourcesHtml = (label, items, ordered = false, start = 1) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;"><tr>
      <td style="border-top:1px solid #e8e2d6;padding-top:14px;">
        ${label ? `<p class="t-muted" style="margin:0 0 8px;font:600 10px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${C.GREY};">${esc(label)}</p>` : ''}
        <${ordered ? 'ol' : 'ul'}${ordered && start !== 1 ? ` start="${Number(start)}"` : ''} class="t-muted" style="margin:0;padding-left:20px;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};word-break:break-word;">
          ${items.map(i => `<li style="margin:0 0 5px;${i && i.cont ? 'list-style:none;' : ''}">${indent(i)}</li>`).join('')}
        </${ordered ? 'ol' : 'ul'}>
      </td>
    </tr></table>`;

/** Render one block list. Unknown kinds are dropped rather than guessed at. */
export function articleBlocksHtml(blocks) {
  return (blocks || []).map(b => {
    switch (b.kind) {
      case 'p':
        return `<p class="t-body" style="margin:0 0 15px;font:${BODY_FONT};color:${C.SLATE};">${b.html}</p>`;
      // `html` when the extractor captured one: a heading may hold a link or
      // inline code, and escaping its plain text threw both away.
      case 'h2':
        return `<h2 class="t-title" style="margin:26px 0 10px;font:700 19px/1.3 ${SERIF};color:${C.NAVY_900};">${b.html || esc(b.text)}</h2>`;
      case 'h3':
        return `<h3 class="t-title" style="margin:22px 0 8px;font:700 16px/1.35 ${SERIF};color:${C.NAVY_900};">${b.html || esc(b.text)}</h3>`;
      case 'list':
        return listHtml(b.items, b.ordered, b.start, b.type, b.reversed);
      case 'table':
        return tableHtml(b.rows);
      case 'pre':
        return preHtml(b.text, b.html);
      case 'callout':
        return `<div style="margin:0 0 18px;">${callout(b.label || '', articleBlocksHtml(b.blocks))}</div>`;
      case 'action':
        return actionHtml(b.heading, b.items, b.lead, b.ordered, b.start);
      case 'sources':
        return sourcesHtml(b.label, b.items, b.ordered, b.start);
      case 'disclaimer':
        return `<p class="t-muted" style="margin:0 0 4px;font:italic 400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};">${b.html}</p>`;
      default:
        return '';
    }
  }).join('');
}

/**
 * One drafted article, as a full-width card: navy hero band carrying the
 * category, headline and byline, then the article itself.
 * @param {object} a  {title, category, source, date, readTime, path, blocks}
 * @param {object} o  {index, total, prNumber}
 */
export function draftArticleHtml(a, o = {}) {
  const meta = [a.source, a.date, a.readTime].filter(Boolean).map(esc).join(' &middot; ');
  const seq  = o.total > 1 ? `Draft ${o.index} of ${o.total}` : 'Draft';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
      <tr><td bgcolor="${C.NAVY}" style="background-color:${C.NAVY};border-radius:10px 10px 0 0;padding:22px 24px 20px;">
        <p style="margin:0 0 8px;font:600 10px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:${C.GOLD_PILL};">
          ${esc(seq)}${a.category ? ` &middot; ${esc(a.category)}` : ''}
        </p>
        <p style="margin:0;font:700 22px/1.28 ${SERIF};color:${C.CREAM};">${esc(a.title)}</p>
        ${meta ? `<p style="margin:10px 0 0;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:${C.GOLD_PILL};">${meta}</p>` : ''}
        <p style="margin:8px 0 0;font:400 11px/1.5 Arial,Helvetica,sans-serif;color:${C.GOLD_PILL};">${esc(a.path || '')}</p>
      </td></tr>
      <tr><td class="e-item" bgcolor="${C.WHITE}" style="background-color:${C.WHITE};border:1px solid #e8e2d6;border-top:0;border-radius:0 0 10px 10px;padding:24px 24px 12px;">
        ${articleBlocksHtml(a.blocks)}
      </td></tr>
    </table>`;
}
