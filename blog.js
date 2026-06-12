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
    industry:   "Industry Guides"
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

  function artHTML(post) {
    return '<div class="card-art" aria-hidden="true">' +
      '<span class="cat-chip">' + esc(CATEGORIES[post.category] || post.category) + "</span>" +
      '<span class="src">' + esc(post.srcShort || post.source) + "</span>" +
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

  /* ---------- Newsletter (stub — same contract as the contact form) ---------- */
  var form = document.getElementById("newsletter-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.querySelector("input[type=email]");
      var msg = document.getElementById("nl-msg");
      if (!email.value || email.value.indexOf("@") < 1) {
        msg.textContent = "Please enter a valid email address.";
        msg.className = "form-msg err";
        return;
      }
      /* TODO before launch: wire to Web3Forms / ESP, same as #contact-form */
      msg.textContent = "You're on the list. One email a month — that's the whole deal.";
      msg.className = "form-msg ok";
      form.reset();
    });
  }

  render("all");
  observeReveals(document);
})();
