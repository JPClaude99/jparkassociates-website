/* ============================================================================
   J PARK & ASSOCIATES — shared email chrome
   ----------------------------------------------------------------------------
   One shell for every automated Ledger email, so the draft alert and the
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
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="e-callout" bgcolor="${C.CREAM}" style="background-color:${C.CREAM};border-left:4px solid ${accent};border-radius:10px;padding:20px 24px;">
        ${label ? `<p class="t-gold" style="margin:0 0 8px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:${C.GOLD_TEXT};">${esc(label)}</p>` : ''}
        ${inner}
      </td>
    </tr></table>`;

/**
 * Full email document.
 * @param {object} o
 * @param {string} o.preheader  inbox preview text
 * @param {string} o.eyebrow    e.g. "The Ledger · draft alert"
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
    .t-title, .t-strong { color: ${C.CREAM} !important; }
    .t-body   { color: #cbd3e1 !important; }
    .t-muted, .t-foot { color: #9aa6bd !important; }
    .t-gold, .t-link  { color: ${C.GOLD_PILL} !important; }
  }

  [data-ogsb] .e-page,    .e-page[data-ogsb]    { background-color: #0b1220 !important; }
  [data-ogsb] .e-card,    .e-card[data-ogsb]    { background-color: #16203a !important; }
  [data-ogsb] .e-item,    .e-item[data-ogsb]    { background-color: #22304c !important; border-color: #3d4d6e !important; }
  [data-ogsb] .e-callout, .e-callout[data-ogsb] { background-color: #22304c !important; }
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
<div style="display:none;font-size:0;line-height:0;max-height:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(o.preheader)}${'&zwnj;&nbsp;'.repeat(40)}</div>
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
    <p class="t-foot" style="margin:0;font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${C.GREY};">${o.footNote}</p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}
