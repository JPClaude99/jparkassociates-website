/* ============================================================
   THE LEDGER — share-card artwork generator

   Writes assets/ledger/<slug>.jpg, a 1200x630 Open Graph card, for
   every entry in blog/posts.js. Each article's <meta property="og:image">
   points at its own file, so a Ledger link shared on LinkedIn, iMessage
   or Slack unfurls with artwork about that article instead of the one
   generic /assets/og-image.jpg every post used to share.

   Run it:
     node automation/ledger-art.mjs              # only the missing cards
     node automation/ledger-art.mjs --force      # rebuild every card
     node automation/ledger-art.mjs --slug=<s>   # just one

   Needs puppeteer, which is NOT a repo dependency — the site has no
   build step and nothing here runs at page-serve time. Install it the
   same way ledger-draft-alert.yml does:

     npm install --no-save --no-audit --no-fund puppeteer@25

   .github/workflows/ledger-artwork.yml does exactly that whenever
   blog/posts.js lands on main, then commits whatever changed. Nobody
   has to remember to run this by hand.

   WHY A RASTER CARD AND NOT AN SVG. An SVG would diff far more nicely
   in review, but the card is set in Playfair Display and Inter — both
   webfonts. A standalone SVG cannot carry them without embedding the
   font binaries, and every crawler that renders it would silently fall
   back to Georgia and Arial, which is the opposite of the point. So the
   card is laid out in HTML with the real webfonts, screenshotted, and
   the PNG is what ships. The layout below is the only source of truth.

   The card deliberately mirrors the index tiles (blog.css .card-art):
   same navy ground, same gold rule, same figure-over-caption idea. A
   reader who clicks through from a share should recognise the tile they
   land next to.
   ============================================================ */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "ledger");

const CATEGORIES = {
  federal: "Federal Tax",
  california: "California & CDTFA",
  compliance: "Compliance & FinCEN",
  payroll: "Payroll & People",
  deadlines: "Deadlines",
  industry: "Industry Guides",
  guides: "Owner's Guides"
};

const MONTHS_SHORT = {
  january: "Jan", february: "Feb", march: "Mar", april: "Apr",
  may: "May", june: "Jun", july: "Jul", august: "Aug",
  september: "Sep", october: "Oct", november: "Nov", december: "Dec"
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/* ---------- Read the manifest ----------
   posts.js is a browser file: one assignment to window.BLOG_POSTS. Rather
   than parse it, hand it the global it expects and let it assign. */
async function readPosts() {
  const source = await fs.readFile(path.join(ROOT, "blog", "posts.js"), "utf8");
  const scope = { window: {} };
  new Function("window", source)(scope.window);
  const posts = scope.window.BLOG_POSTS;
  if (!Array.isArray(posts) || !posts.length) {
    throw new Error("blog/posts.js did not define a non-empty window.BLOG_POSTS");
  }
  return posts;
}

/* ---------- What goes in the big slot ----------
   Mirrors the layer order in blog.js artHTML(): an explicit figure wins,
   then whatever the article's motif is really about, then the source
   wordmark. A share card is read as a thumbnail, so a motif that works
   at card size (a four-box W-2 row) is reduced to the one string that
   still reads at 200px wide. */
function shareFigure(post) {
  if (post.figure) return { figure: post.figure, label: post.figureLabel || "" };

  const art = post.art;
  if (art) {
    if (art.motif === "calendar") {
      const month = String(art.cap || "").trim().split(/\s+/)[0].toLowerCase();
      const short = MONTHS_SHORT[month] || "";
      return { figure: (short + " " + (art.day || "")).trim(), label: art.cap || "" };
    }
    if (art.motif === "form-boxes") {
      return { figure: art.fill || "", label: art.label || "" };
    }
    if (art.motif === "lined-notice") {
      return { figure: art.stamp || post.srcShort || post.source, label: art.label || "" };
    }
    if (art.motif === "ledger-rows" && Array.isArray(art.total)) {
      return { figure: art.total[1] || "", label: art.total[0] || art.label || "" };
    }
  }
  return { figure: post.srcShort || post.source, label: "" };
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return MONTHS[Number(m) - 1] + " " + Number(d) + ", " + y;
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* Set a leading $ and a trailing % / ¢ small and raised, the way blog.js
   figureHTML() does for the index tiles. */
function figureMarkup(figure) {
  const m = /^([$])?(.+?)([%¢])?$/.exec(figure);
  if (!m) return esc(figure);
  return (m[1] ? `<span class="u">${esc(m[1])}</span>` : "") +
    esc(m[2]) +
    (m[3] ? `<span class="u">${esc(m[3])}</span>` : "");
}

function cardHTML(post) {
  const { figure, label } = shareFigure(post);
  /* One shared scale for the headline figure. "Repealed" and "$18.47" have
     to live in the same slot, so step the size down as it gets longer
     rather than letting it overflow the card. */
  const figureSize = figure.length > 9 ? 92 : figure.length > 6 ? 116 : 150;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=Inter:wght@500;600&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;overflow:hidden;
    font-family:Inter,"Liberation Sans",Arial,sans-serif;
    background:
      radial-gradient(120% 130% at 82% 4%,rgba(46,74,122,.6) 0%,transparent 56%),
      linear-gradient(150deg,#1B2A4A 0%,#111c33 100%);}
  .card{position:relative;width:100%;height:100%;padding:56px 64px;
    display:flex;flex-direction:column;justify-content:space-between}
  /* The same open gold ring the index tiles carry, pushed off the corner. */
  .ring{position:absolute;width:560px;height:560px;border:2px solid rgba(201,168,76,.2);
    border-radius:50%;right:-140px;top:-190px}
  .ring.two{width:760px;height:760px;border-width:1px;border-color:rgba(201,168,76,.1);
    right:-260px;top:-300px}
  .top{position:relative;display:flex;justify-content:space-between;align-items:center;gap:24px}
  .brand{font-size:17px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;
    color:rgba(245,240,232,.72)}
  .cat{font-size:16px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
    color:#e0c87e;border:1px solid rgba(201,168,76,.45);border-radius:999px;padding:9px 22px;
    white-space:nowrap}
  .body{position:relative}
  .fig{display:block;font-family:"Playfair Display",Georgia,serif;font-weight:700;
    font-size:${figureSize}px;line-height:1;color:#e0c87e;letter-spacing:-.012em;
    font-variant-numeric:tabular-nums}
  .fig .u{font-size:.5em;vertical-align:.5em;color:#C9A84C}
  .fig-label{display:block;margin-top:16px;font-size:15px;font-weight:600;
    letter-spacing:.16em;text-transform:uppercase;color:rgba(245,240,232,.62)}
  h1{font-family:"Playfair Display",Georgia,serif;font-weight:700;color:#F5F0E8;
    font-size:36px;line-height:1.26;margin-top:24px;max-width:32ch;text-wrap:balance;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .foot{position:relative;display:flex;justify-content:space-between;align-items:flex-end;
    gap:24px;border-top:1px solid rgba(201,168,76,.28);padding-top:20px}
  .meta{font-size:15px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
    color:rgba(245,240,232,.6)}
</style></head>
<body><div class="card">
  <span class="ring" aria-hidden="true"></span>
  <span class="ring two" aria-hidden="true"></span>
  <div class="top">
    <span class="brand">The Ledger &middot; J Park &amp; Associates</span>
    <span class="cat">${esc(CATEGORIES[post.category] || post.category)}</span>
  </div>
  <div class="body">
    <span class="fig">${figureMarkup(figure)}</span>
    ${label ? `<span class="fig-label">${esc(label)}</span>` : ""}
    <h1>${esc(post.title)}</h1>
  </div>
  <div class="foot">
    <span class="meta">${esc(post.source)} &middot; ${esc(fmtDate(post.date))}</span>
    <span class="meta">jparkassociates.com</span>
  </div>
</div></body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlySlug = (args.find((a) => a.startsWith("--slug=")) || "").slice(7);

  const posts = await readPosts();
  const wanted = onlySlug ? posts.filter((p) => p.slug === onlySlug) : posts;
  if (onlySlug && !wanted.length) {
    throw new Error(`No post in blog/posts.js has the slug "${onlySlug}"`);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const todo = [];
  for (const post of wanted) {
    const file = path.join(OUT_DIR, `${post.slug}.jpg`);
    if (!force && await fs.access(file).then(() => true, () => false)) continue;
    todo.push({ post, file });
  }

  if (!todo.length) {
    console.log(`Nothing to build — all ${wanted.length} share cards already exist.`);
    return;
  }

  /* Imported here, not at the top, so --help-style mistakes and a missing
     manifest fail with a clear message instead of a module-not-found. */
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {})
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

    for (const { post, file } of todo) {
      await page.setContent(cardHTML(post), { waitUntil: "load", timeout: 60000 });
      /* document.fonts.ready is the real gate, not network idle — a card
         screenshotted a tick early ships set in Georgia and Arial, which is
         the whole thing this generator exists to avoid. */
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: file, type: "jpeg", quality: 86 });
      console.log(`  wrote assets/ledger/${post.slug}.jpg`);
    }
  } finally {
    await browser.close();
  }

  console.log(`Built ${todo.length} share card${todo.length === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error("ledger-art failed:", err.message);
  process.exit(1);
});
