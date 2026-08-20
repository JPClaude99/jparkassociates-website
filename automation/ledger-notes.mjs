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
  if (!body || !body.trim()) return { byFile, order, titles, general };

  // Split on level-2 headings, keeping each heading with its section.
  const sections = body.split(/\n(?=##\s)/g);
  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+?)\s*$/m);
    // Closing hashes are optional in ATX, so "## 1. Title ##" must not title
    // the article "Title ##".
    const heading = headingMatch ? headingMatch[1].replace(/\s*#+\s*$/, '').trim() : '';
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
