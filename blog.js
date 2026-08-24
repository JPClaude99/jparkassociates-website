/* ============================================================
   THE LEDGER — blog index renderer
   Renders the featured post + card grid from window.BLOG_POSTS
   (blog/posts.js), drives the category filter, the nav
   light/dark toggle, and the scroll reveals.
   ============================================================ */
(function () {
  "use strict";

  var CATEGORIES = {
    federal:    "Federal Tax",
    california: "California & CDTFA",
    compliance: "Compliance & FinCEN",
    payroll:    "Payroll & People",
    deadlines:  "Deadlines",
    industry:   "Industry Guides",
    guides:     "Owner's Guides"
  };

  var posts = (window.BLOG_POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  var MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  function fmtDate(iso) {
    var p = iso.split("-");
    return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- Card art ----------
     Three layers, all resolved here and handed to blog.css as
     data-attributes: the category picks the palette, the slug picks the
     composition, and the article's own fields pick what sits in the middle.
     Anything missing degrades to the layer below it, so a post that carries
     only the fields the manifest has always had still renders correctly. */

  var SEED_COUNT = 8;

  /* FNV-1a over the slug. Any stable string hash would do; what matters is
     that it never changes for a given slug, so an article keeps its
     composition for as long as it exists. */
  function hashSeed(slug) {
    var h = 0x811c9dc5;
    for (var i = 0; i < slug.length; i++) {
      h ^= slug.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h % SEED_COUNT;
  }

  /* A leading $ or a trailing % / ¢ is set smaller and raised, the way a
     financial table sets them. Everything else is left alone. */
  function figureHTML(figure) {
    var m = /^([$])?(.+?)([%¢])?$/.exec(figure);
    if (!m) return esc(figure);
    return (m[1] ? '<span class="u">' + esc(m[1]) + "</span>" : "") +
      esc(m[2]) +
      (m[3] ? '<span class="u">' + esc(m[3]) + "</span>" : "");
  }

  function statHTML(post) {
    var longFigure = post.figure.length > 6 ? " is-long" : "";
    return '<span class="stat">' +
      '<span class="fig' + longFigure + '">' + figureHTML(post.figure) + "</span>" +
      (post.figureLabel ? '<span class="fig-label">' + esc(post.figureLabel) + "</span>" : "") +
      "</span>";
  }

  function rowsHTML(rows, className) {
    return (rows || []).map(function (row) {
      return '<span class="doc-row' + className + '"><span>' + esc(row[0]) +
        "</span><b>" + esc(row[1]) + "</b></span>";
    }).join("");
  }

  /* Each motif reads only the fields it needs. An unknown motif name falls
     through to null, which sends the tile back to the stat or wordmark
     layer rather than rendering an empty box. */
  function motifHTML(art) {
    if (art.motif === "calendar") {
      return '<span class="doc is-calendar">' +
        '<span class="doc-cap">' + esc(art.cap || "") + "</span>" +
        '<span class="doc-day">' + esc(art.day || "") + "</span></span>";
    }
    if (art.motif === "form-boxes") {
      var count = art.boxes || 4;
      var fillAt = typeof art.fillIndex === "number" ? art.fillIndex : 1;
      var boxes = "";
      for (var i = 0; i < count; i++) {
        boxes += i === fillAt
          ? '<span class="on">' + esc(art.fill || "") + "</span>"
          : "<span></span>";
      }
      return '<span class="doc">' +
        '<span class="doc-label">' + esc(art.label || "") + "</span>" +
        '<span class="doc-boxes">' + boxes + "</span>" +
        '<span class="doc-lines"><i></i><i class="g"></i></span></span>';
    }
    if (art.motif === "lined-notice") {
      return '<span class="doc">' +
        '<span class="doc-label">' + esc(art.label || "") + "</span>" +
        '<span class="doc-lines"><i></i><i></i><i></i><i></i></span>' +
        (art.stamp ? '<span class="doc-strike"></span>' : "") +
        "</span>" +
        (art.stamp ? '<span class="doc-stamp">' + esc(art.stamp) + "</span>" : "");
    }
    if (art.motif === "ledger-rows") {
      return '<span class="doc is-rows">' +
        (art.label ? '<span class="doc-label">' + esc(art.label) + "</span>" : "") +
        rowsHTML(art.rows, "") +
        (art.total ? rowsHTML([art.total], " total") : "") +
        "</span>";
    }
    return null;
  }

  function artHTML(post) {
    var inner = post.art ? motifHTML(post.art) : null;
    var kind = inner ? "motif" : null;

    if (!inner && post.figure) {
      inner = statHTML(post);
      kind = "stat";
    }
    if (!inner) {
      var word = post.srcShort || post.source;
      inner = '<span class="src' + (word.length > 6 ? " is-long" : "") + '">' +
        esc(word) + "</span>";
      kind = "word";
    }

    /* The wordmark IS the source, so repeating it in the corner would be
       redundant; a stat or motif tile needs the attribution back. */
    var mark = kind === "word"
      ? ""
      : '<span class="src-mark">' + esc(post.srcShort || post.source) + "</span>";

    return '<div class="card-art" data-cat="' + esc(post.category) +
      '" data-seed="' + hashSeed(post.slug) +
      '" data-art="' + kind + '" aria-hidden="true">' +
      '<span class="cat-chip">' + esc(CATEGORIES[post.category] || post.category) + "</span>" +
      inner + mark +
      "</div>";
  }

  function metaHTML(post) {
    return '<div class="post-meta">' +
      '<span class="src-tag">' + esc(post.source) + "</span>" +
      '<span class="dot">&middot;</span>' +
      "<time datetime=\"" + esc(post.date) + '">' + fmtDate(post.date) + "</time>" +
      '<span class="dot">&middot;</span>' +
      "<span>" + post.readMins + " min read</span>" +
      "</div>";
  }

  function featuredHTML(post) {
    return '<a class="featured-card reveal" href="blog/' + esc(post.slug) + '.html">' +
      artHTML(post) +
      '<div class="body">' +
      metaHTML(post) +
      "<h2>" + esc(post.title) + "</h2>" +
      '<p class="excerpt">' + esc(post.excerpt) + "</p>" +
      '<span class="read-on">Read the article</span>' +
      "</div></a>";
  }

  function cardHTML(post, i) {
    var delay = (i % 3) + 1;
    return '<a class="post-card reveal" data-delay="' + delay + '" href="blog/' + esc(post.slug) + '.html">' +
      artHTML(post) +
      '<div class="body">' +
      metaHTML(post) +
      "<h3>" + esc(post.title) + "</h3>" +
      '<p class="excerpt">' + esc(post.excerpt) + "</p>" +
      "</div></a>";
  }

  /* ---------- Render ---------- */
  var featuredWrap = document.getElementById("featured");
  var grid = document.getElementById("post-grid");
  var observer;

  function observeReveals(root) {
    var els = root.querySelectorAll(".reveal:not(.in)");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); observer.unobserve(e.target); }
        });
      }, { threshold: 0.12 });
    }
    els.forEach(function (el) { observer.observe(el); });
  }

  function render(filter) {
    var list = filter === "all" ? posts : posts.filter(function (p) { return p.category === filter; });

    if (filter === "all" && list.length) {
      featuredWrap.innerHTML = '<span class="featured-label reveal">Latest</span>' + featuredHTML(list[0]);
      featuredWrap.hidden = false;
      list = list.slice(1);
    } else {
      featuredWrap.hidden = true;
      featuredWrap.innerHTML = "";
    }

    grid.innerHTML = list.length
      ? list.map(cardHTML).join("")
      : '<p class="post-empty">Nothing in this category yet &mdash; new articles land as the agencies make announcements.</p>';

    observeReveals(document.getElementById("articles"));
  }

  /* ---------- Filter chips ---------- */
  var chips = document.querySelectorAll(".filter-chip");
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      render(chip.dataset.filter);
    });
  });

  /* ---------- Nav: light once past the masthead ---------- */
  var nav = document.getElementById("nav");
  var masthead = document.querySelector(".blog-masthead");
  function navTone() {
    var past = masthead.getBoundingClientRect().bottom <= 70;
    nav.classList.toggle("on-light", past);
  }
  window.addEventListener("scroll", navTone, { passive: true });
  navTone();

  /* ---------- Newsletter — submits to Web3Forms (key for the blog,
     separate from the forms in scroll-cinematic.js) ---------- */
  var WEB3_KEY = "f157657a-37a9-47ec-9b50-3b8960d41025";
  var form = document.getElementById("newsletter-form");
  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var emailInput = form.querySelector("input[type=email]");
      var msg = document.getElementById("nl-msg");
      var submitBtn = form.querySelector("button[type='submit']");
      var value = emailInput.value.trim();
      if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        msg.textContent = "That email doesn't look right — mind checking it?";
        msg.className = "form-msg err";
        emailInput.setAttribute("aria-invalid", "true");
        emailInput.focus();
        return;
      }
      emailInput.removeAttribute("aria-invalid");
      submitBtn.disabled = true;
      msg.textContent = "Subscribing…";
      msg.className = "form-msg";
      try {
        var res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            access_key: WEB3_KEY,
            subject: "New Monthly Close subscriber — jparkassociates.com",
            from_name: "The Ledger Newsletter Form",
            email: value,
            cc: "justinparkcpa@gmail.com",
            message: "Add to The Monthly Close list: " + value
          })
        });
        var data = await res.json();
        if (data.success) {
          msg.textContent = "You're on the list. One email a month — that's the whole deal.";
          msg.className = "form-msg ok";
          form.reset();
          if (window.gtag) window.gtag("event", "generate_lead", { form: "newsletter" });
        } else {
          throw new Error(data.message);
        }
      } catch (err) {
        msg.textContent = "Something went wrong — email justinpark@jparkassociates.com and we'll add you.";
        msg.className = "form-msg err";
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  render("all");
  observeReveals(document);
})();
