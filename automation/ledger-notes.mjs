/* ============================================================================
   THE LEDGER — PR-body notes parser (shared)
   ----------------------------------------------------------------------------
   One parse, three consumers: the PDF review packet, the Word review note, and
   the weekly review email. They must agree about which notes belong to which
   article, so the rule lives here rather than in each builder.

   PR-body contract (automation/PIPELINE.md, "The PR body is parsed"):

       ## 1. <article title>
       `blog/<slug>.html` · category `deadlines` · 5 min
       **Source** ...

   A section is per-article when its heading starts with a number and a period
   AND a `blog/<file>.html` path appears in backticks inside it. Everything else
   (Confidence notes, Also noticed, Upcoming) is a general run note.

   Nothing here is load-bearing for correctness: an unnumbered heading or a
   mismatched path simply demotes that section to a run note. The packet
   degrades, it never fails.
   ========================================================================== */

/**
 * @param {string} body  raw pull-request body (markdown)
 * @returns {{byFile: Map<string,string>, order: Map<string,number>,
 *            titles: Map<string,string>, general: Array<{title:string, md:string}>}}
 */
export function parseNotes(body) {
  const byFile  = new Map();
  const order   = new Map();
  const titles  = new Map();
  const general = [];
  // String(), not a truthiness check: `body` is string|null from the API, but a
  // malformed handoff carrying a number used to throw `body.trim is not a
  // function` and take the PDF, the Word note and the article copy with it.
  const src = String(body ?? '');
  if (!src.trim()) return { byFile, order, titles, general };

  /* Split on level-2 headings — but NOT on a `##` inside a fenced code block.
     A run note that quotes this very PR-body format in a ```md fence used to be
     torn into a fake article section and bound to a file that does not exist,
     inventing a draft that was never written. */
  const sections = [];
  let current = [];
  // The fence's CHARACTER and its LENGTH. Storing only the character meant any
  // ``` line closed a ```` block — and the real closing ```` then re-opened it,
  // so every heading after that point stopped splitting. CommonMark (and the
  // GitHub preview the author is looking at) requires the closer to be at least
  // as long as the opener.
  let fence = null;
  for (const line of src.split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = { char: f[1][0], len: f[1].length };
      else if (f[1][0] === fence.char && f[1].length >= fence.len) fence = null;
    }
    if (!fence && /^##\s/.test(line) && current.length) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) sections.push(current.join('\n'));
  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+?)\s*$/m);
    // Closing hashes are optional in ATX, so "## 1. Title ##" must not title
    // the article "Title ##". CommonMark requires whitespace before the closing
    // run, which is what keeps "## 1. Schedule K-1 box 17 code AC#" intact —
    // that trailing # is part of the title, and GitHub renders it.
    const heading = headingMatch ? headingMatch[1].replace(/\s+#+\s*$/, '').trim() : '';
    const rest    = headingMatch ? section.slice(headingMatch[0].length) : section;

    // A per-article section names its file in backticks near the top.
    const pathMatch = rest.match(/`(blog\/[A-Za-z0-9._-]+\.html)`/);
    // FIRST binding wins. A typo that points two sections at the same file used
    // to overwrite silently: the first article's notes vanished from every
    // artifact and the second article's notes were printed under the first
    // article's name. Losing notes is the one thing this parser must not do, so
    // a repeat path keeps the original binding and the later section is carried
    // into the run notes, where a reviewer will still see it.
    if (pathMatch && /^\d+\./.test(heading) && !byFile.has(pathMatch[1])) {
      byFile.set(pathMatch[1], rest.trim());
      order.set(pathMatch[1], order.size);
      // "## 1. Title" -> "Title". The scan agent writes the article's own
      // headline here, which is what the Word note prints when it has no
      // rendered article to draw from.
      titles.set(pathMatch[1], heading.replace(/^\d+\.\s*/, '').trim());
    } else if (rest.trim() || heading) {
      // Drop the horizontal rules the scan agent uses between article blocks.
      const md = rest.replace(/^\s*---\s*$/gm, '').trim();
      if (md) general.push({ title: heading || 'Run summary', md });
    }
  }
  return { byFile, order, titles, general };
}

/** "3h" / "5d" — how long a draft has been sitting. An unparseable or missing
    timestamp prints "just opened" rather than "NaNh"; a clock-skewed future
    date clamps to zero rather than printing a negative age. */
export const ageLabel = (iso) => {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'just opened';
  const hours = Math.max(0, Math.round((Date.now() - then) / 36e5));
  return hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
};

/** The one date line every Ledger artifact prints, in the firm's timezone. */
export const generatedOn = () => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'full', timeZone: 'America/Los_Angeles',
}).format(new Date());
