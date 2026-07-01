/* ============================================================
   J PARK & ASSOCIATES — scroll engine + interactions
   Cinematic video panels, Lenis smooth scroll, reveals,
   pain-point navigator, stress test, nav theme swap.
   ============================================================ */

/* ---------- Cinematic video sections ---------- */

/* Each cinematic panel is a <video> (WebM + MP4, encoded from the frame
   masters — see README "Regenerating the videos"). Video replaced the old
   canvas frame-sequence engine: the same clips cost ~1–3 MB as a stream
   instead of ~12–25 MB as 193 individual frames, and the browser owns
   buffering, decode, and memory. The text reveals are still driven by
   playback progress p (0→1), now read from video.currentTime. */
function initCinematic(cfg) {
  const section = document.querySelector(cfg.section);
  /* Phones (≤760px, matching the CSS breakpoint where the mobile layout
     engages) play the portrait reframe when the section provides one;
     anything wider uses the landscape encode. Decided once at init. */
  const src = (cfg.videoMobile && window.matchMedia("(max-width: 760px)").matches)
    ? cfg.videoMobile
    : cfg.video;
  const video = section.querySelector("video");
  const lines = [...section.querySelectorAll(".reveal-line")];
  const progressFill = section.querySelector(".gold-progress span");

  /* The color grade is a GPU-composited CSS filter, same as the canvas era. */
  if (cfg.filter) video.style.filter = cfg.filter;

  /* Nothing downloads until attach(): boot() calls load()/loadFinal() when
     the section comes within a viewport (or play() forces it). The poster —
     frame 1 of the sequence, already preloaded for the hero — paints the
     panel while the stream buffers. */
  let attached = false;
  function attach(preload) {
    if (attached) return;
    attached = true;
    if (src.poster) video.poster = src.poster;
    video.preload = preload || "auto";
    const webm = document.createElement("source");
    webm.src = src.webm;
    webm.type = "video/webm";
    const mp4 = document.createElement("source");
    mp4.src = src.mp4;
    mp4.type = "video/mp4";
    video.append(webm, mp4);
    video.load();
  }

  /* ---- Playback model ----
     The clip plays once when the panel engages, on the video's own clock.
     The snap controller in boot() calls play()/reset()/showFinal() as the
     panel engages, leaves, and (under reduced motion) rests. */
  let playing = false;

  /* Text reveals: the same triangular-plateau fade the scrub used, now
     timed off p so the three lines hand off in sequence as the clip plays. */
  function applyReveals(p) {
    if (progressFill) progressFill.style.transform = `scaleX(${p.toFixed(4)})`;
    for (const el of lines) {
      const a = parseFloat(el.dataset.in), b = parseFloat(el.dataset.out);
      const mid = (a + b) / 2, half = (b - a) / 2;
      /* 1.8x gain clips the triangle into a plateau: the line holds full
         opacity through the middle ~45% of its window, so copy stays
         readable instead of lingering at half-fade over bright frames. */
      let o = (1 - Math.abs(p - mid) / half) * 1.8;
      o = Math.max(0, Math.min(1, o));
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translate(-50%, -50%) translateY(${(1 - o) * 26}px)`;
      el.style.pointerEvents = o > 0.5 ? "auto" : "none";
    }
  }

  /* Driven from the single global rAF (see boot) so there's no per-section
     timer. Reads playback progress off the video clock; when the clip ends
     the browser holds the final frame and we hold the final copy. */
  function tick() {
    if (!playing) return;
    const d = video.duration;
    if (!d) { applyReveals(0); return; } /* metadata still loading: hold the opening state */
    applyReveals(Math.min(video.currentTime / d, 1));
    if (video.ended) { playing = false; applyReveals(1); }
  }

  function seekStart() {
    try { if (video.readyState >= 1) video.currentTime = 0; } catch (e) { /* not seekable yet */ }
  }

  function play() {
    attach("auto");
    seekStart();
    playing = true;
    applyReveals(0);
    const p = video.play();
    /* Muted inline video is autoplay-safe everywhere, but iOS Low Power
       Mode can still reject — rest on the final frame + final copy so the
       headline and CTAs are never hidden behind a clip that won't run. */
    if (p && p.catch) p.catch(() => { if (playing) { playing = false; showFinal(); } });
  }

  function reset() {
    playing = false;
    video.pause();
    seekStart();
    applyReveals(0);
  }

  function showFinal() { /* reduced-motion / no-autoplay rest state */
    playing = false;
    attach("metadata");
    video.pause();
    applyReveals(1);

    /* Rest on the clip's final frame. On a range-capable server (GitHub
       Pages) the end is seekable as soon as metadata arrives, so this
       costs one small range fetch. If the server can't serve byte ranges,
       Chromium pins seekable at [0,0] forever and every seek clamps back
       to 0 — the escape hatch is to fetch the clip ourselves and swap in
       a blob URL, which is always fully seekable. */
    const seekTarget = () => Math.max(0, video.duration - 0.05);
    function trySeek() {
      if (!video.duration) return false;
      const s = video.seekable, t = seekTarget();
      for (let i = 0; i < s.length; i++) {
        if (s.start(i) <= t && s.end(i) >= t) {
          try { video.currentTime = t; } catch (e) { return false; }
          return true;
        }
      }
      return false;
    }
    if (trySeek()) return;

    let escalated = false;
    function escalate() {
      if (escalated || typeof fetch !== "function") return;
      escalated = true;
      detach();
      const url = video.currentSrc || src.webm;
      fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (!b) return;
          /* One object URL per section, alive for the page's lifetime. */
          video.src = URL.createObjectURL(b);
          video.load();
          video.addEventListener("loadedmetadata", () => { trySeek(); }, { once: true });
        })
        .catch(() => { /* poster + final copy remain — acceptable rest state */ });
    }
    function retry() {
      if (trySeek()) { detach(); return; }
      /* Metadata is in but the end is not seekable: the no-range signature. */
      if (video.duration && video.seekable.length && video.seekable.end(0) < 1) escalate();
    }
    function detach() {
      for (const ev of ["loadedmetadata", "progress", "canplaythrough", "suspend"]) {
        video.removeEventListener(ev, retry);
      }
    }
    for (const ev of ["loadedmetadata", "progress", "canplaythrough", "suspend"]) {
      video.addEventListener(ev, retry);
    }
    if (video.duration) retry(); /* metadata already in: evaluate now */
  }

  applyReveals(0); /* opening line visible before the stream arrives */
  return {
    tick,
    play,
    reset,
    showFinal,
    load: () => attach("auto"),
    /* Reduced-motion visitors only ever see the resting final frame — ask
       for metadata and let showFinal()'s seek range-fetch just that. */
    loadFinal: () => attach("metadata"),
    el: section,
    cfg
  };
}

/* ---------- Stat counters ---------- */
function animateCount(el) {
  const target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || "";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = target + suffix;
    return;
  }
  const dur = 1500, t0 = performance.now();
  function step(t) {
    const k = Math.min((t - t0) / dur, 1), eased = 1 - Math.pow(1 - k, 3);
    el.textContent = (target % 1 === 0 ? Math.round(target * eased) : (target * eased).toFixed(1)) + suffix;
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- Pain-point navigator (accessible tabs) ---------- */
function initPainNavigator() {
  const tabs = [...document.querySelectorAll(".pain-card")];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
  if (!tabs.length) return;

  function select(i, focus) {
    tabs.forEach((t, j) => {
      const on = i === j;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[j].hidden = !on;
      if (on) {
        panels[j].classList.remove("panel-fade");
        void panels[j].offsetWidth; /* restart the entrance animation */
        panels[j].classList.add("panel-fade");
      }
    });
    if (focus) tabs[i].focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i, false));
    tab.addEventListener("keydown", (e) => {
      let to = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (i - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") to = 0;
      if (e.key === "End") to = tabs.length - 1;
      if (to !== null) { e.preventDefault(); select(to, true); }
    });
  });
  select(0, false);
}

/* ---------- Tax-season stress test ---------- */
function initStressTest() {
  const box = document.querySelector(".stress-box");
  if (!box) return;
  const questions = [...box.querySelectorAll(".stress-q")];
  const result = document.getElementById("stress-result");
  const heading = document.getElementById("sr-heading");
  const body = document.getElementById("sr-body");
  const meter = document.getElementById("sr-meter");
  const answers = new Array(questions.length).fill(null);

  const BANDS = [
    {
      max: 1,
      title: "You're in good shape.",
      body: "Your numbers are current and your deadlines run without you — that puts you ahead of most owners. If you ever want a second set of eyes on tax planning for the year ahead, the 15-minute call is there."
    },
    {
      max: 3,
      title: "A few gaps are costing you sleep — and probably money.",
      body: "Some of your cycle runs itself; the rest still depends on your evenings. The gaps you marked “no” are usually the fastest to fix — most owners are surprised how quickly a weekly books cycle and a filing calendar remove them."
    },
    {
      max: 5,
      title: "You're carrying too much of this yourself.",
      body: "Right now the back office runs on your personal attention, and tax season arrives as a surprise. That's exactly the situation we take over: books on a weekly cycle, filings on a calendar, and a quarterly conversation so April becomes a formality."
    }
  ];

  function maybeShowResult() {
    if (answers.some((a) => a === null)) return;
    const score = answers.filter((a) => a === "no").length;
    const band = BANDS.find((b) => score <= b.max);
    heading.textContent = band.title;
    body.textContent = band.body;
    /* First completion only — later answer changes just update the copy */
    if (result.hidden && window.gtag) window.gtag("event", "stress_test_complete", { score: score });
    result.hidden = false;
    requestAnimationFrame(() => {
      meter.style.width = Math.max(8, (score / questions.length) * 100) + "%";
    });
    /* If the last answer was clicked mid-list, the result renders below
       the fold — bring its heading into view so it isn't missed. */
    const rect = result.getBoundingClientRect();
    if (rect.top > window.innerHeight - 160) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (window.__lenis && !reduced) {
        window.__lenis.scrollTo(result, { offset: -window.innerHeight * 0.3, duration: 0.9 });
      } else {
        result.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      }
    }
  }

  questions.forEach((q, i) => {
    q.querySelectorAll(".opts button").forEach((btn) => {
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        answers[i] = btn.dataset.val;
        q.querySelectorAll(".opts button").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === btn))
        );
        maybeShowResult();
      });
    });
  });

  /* Stress-test email capture — submits to Web3Forms.
     Register justinpark@jparkassociates.com at web3forms.com, copy the
     access_key here and into #contact-form below. */
  const WEB3_KEY = "f157657a-37a9-47ec-9b50-3b8960d41025";
  const form = document.getElementById("stress-email-form");
  const emailInput = document.getElementById("sr-email");
  const msg = document.getElementById("sr-msg");
  const submitBtn = form.querySelector("button[type='submit']");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = emailInput.value.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      msg.textContent = "That email doesn't look right — mind checking it?";
      msg.className = "form-msg err";
      emailInput.setAttribute("aria-invalid", "true");
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute("aria-invalid");
    const score = answers.filter((a) => a === "no").length;
    const band = BANDS.find((b) => score <= b.max);
    submitBtn.disabled = true;
    msg.textContent = "Sending…";
    msg.className = "form-msg";
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3_KEY,
          subject: "Stress test result — jparkassociates.com",
          from_name: "Stress Test Form",
          email: value,
          cc: "justinparkcpa@gmail.com",
          message: `Result: ${band.title}\nScore: ${score}/5 “no” answers\n\nSend breakdown to: ${value}`
        })
      });
      const data = await res.json();
      if (data.success) {
        msg.textContent = "Got it — look for a message from justinpark@jparkassociates.com, usually within one business day.";
        msg.className = "form-msg ok";
        form.reset();
        if (window.gtag) window.gtag("event", "generate_lead", { form: "stress_test_email" });
      } else {
        throw new Error(data.message);
      }
    } catch {
      msg.textContent = "Something went wrong — please email justinpark@jparkassociates.com directly.";
      msg.className = "form-msg err";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Contact form ---------- */
function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;
  const WEB3_KEY = "f157657a-37a9-47ec-9b50-3b8960d41025";
  const msg = document.getElementById("cf-msg");
  const submitBtn = form.querySelector("button[type='submit']");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailEl = form.querySelector("#cf-email");
    const emailVal = emailEl ? emailEl.value.trim() : "";
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      msg.textContent = "Please include a valid email so we can reach you.";
      msg.className = "form-msg err";
      if (emailEl) {
        emailEl.setAttribute("aria-invalid", "true");
        emailEl.focus();
      }
      return;
    }
    if (emailEl) emailEl.removeAttribute("aria-invalid");
    submitBtn.disabled = true;
    msg.textContent = "Sending…";
    msg.className = "form-msg";
    const nameEl = form.querySelector("#cf-name");
    const phoneEl = form.querySelector("#cf-phone");
    const messageEl = form.querySelector("#cf-message");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3_KEY,
          subject: "New inquiry — jparkassociates.com",
          from_name: nameEl ? nameEl.value.trim() || "Website visitor" : "Website visitor",
          email: emailVal,
          cc: "justinparkcpa@gmail.com",
          phone: phoneEl ? phoneEl.value.trim() : "",
          message: messageEl ? messageEl.value.trim() : ""
        })
      });
      const data = await res.json();
      if (data.success) {
        msg.textContent = "Message sent — you’ll hear from justinpark@jparkassociates.com within one business day.";
        msg.className = "form-msg ok";
        form.reset();
        if (window.gtag) window.gtag("event", "generate_lead", { form: "contact" });
      } else {
        throw new Error(data.message);
      }
    } catch {
      msg.textContent = "Something went wrong — please email justinpark@jparkassociates.com directly.";
      msg.className = "form-msg err";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Nav theme: white logo over dark, navy over light ---------- */
function initNavTheme() {
  const nav = document.getElementById("nav");
  const darkZones = [...document.querySelectorAll(".cinematic, .dark-zone, .footer")];
  return function update() {
    const probe = 40; /* vertical center of the nav bar */
    const overDark = darkZones.some((z) => {
      const r = z.getBoundingClientRect();
      return r.top <= probe && r.bottom >= probe;
    });
    nav.classList.toggle("on-light", !overDark);
  };
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const cinematics = (window.SCRUB_SECTIONS || [])
    .filter((c) => document.querySelector(c.section))
    .map(initCinematic);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* The snap/scroll-lock is a wheel-pointer interaction. On touch it fights the
     browser's native scrolling and can trap the page, so touch devices keep plain
     native scrolling and instead auto-play each clip as its panel enters view. */
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const navUpdate = initNavTheme();

  /* Lenis is self-hosted, but if it ever fails to load the site must
     degrade to native scrolling — not lose every interaction below. */
  const lenis = typeof Lenis === "function"
    ? new Lenis({ lerp: reducedMotion ? 1 : 0.085, smoothWheel: !reducedMotion })
    : null;
  window.__lenis = lenis;

  /* ---------- Cinematic snap controller ----------
     Each cinematic panel is one full-screen "slide". When it covers the
     viewport it ENGAGES: the clip plays once on its own clock and scroll is
     locked so the animation can never be scrubbed by the wheel. One
     deliberate gesture — a wheel notch, a swipe, or an arrow/space/page key
     — JUMPS one viewport past it to the next section. Everything outside the
     cinematic panels scrolls normally. (Disabled under reduced motion, where
     each panel just shows its final frame and the page scrolls freely.) */
  const snapEnabled = !reducedMotion && cinematics.length > 0 && !isTouch;
  let engaged = null;        /* the cinematic that currently owns the screen */
  let jumping = false;       /* a programmatic snap/jump is animating */
  let cooldownUntil = 0;     /* brief guard so a jump can't instantly re-engage */
  let wheelLatched = false;  /* collapses one wheel/inertia burst into one jump */
  let wheelQuiet = 0;
  let touchY = null;
  let sidebarOpen = false;   /* the slide-in menu owns input while open (see initSidebar) */

  const VH = () => window.innerHeight;
  const scrollPos = () => (lenis ? lenis.scroll : window.scrollY);

  function smoothTo(target, cb) {
    if (lenis) {
      lenis.start();
      lenis.scrollTo(target, { duration: 0.9, lock: true, onComplete: () => cb && cb() });
    } else {
      window.scrollTo({ top: target, behavior: "smooth" });
      setTimeout(() => cb && cb(), 700);
    }
  }

  function engage(c) {
    engaged = c;
    jumping = true;
    const top = c.el.getBoundingClientRect().top;
    const settle = () => { jumping = false; if (lenis) lenis.stop(); c.reset(); c.play(); };
    if (Math.abs(top) < 2) settle();           /* already filling the screen (e.g. load) */
    else smoothTo(top + scrollPos(), settle);  /* magnetically snap it into place */
  }

  function jump(dir) {
    if (!engaged || jumping) return;
    jumping = true;
    const base = engaged.el.getBoundingClientRect().top + scrollPos();
    const target = dir > 0 ? base + VH() : Math.max(0, base - VH());
    smoothTo(target, () => {
      jumping = false;
      engaged = null;
      cooldownUntil = performance.now() + 260;
      evaluate(); /* the section we land on may itself be cinematic */
    });
  }

  function evaluate() {
    if (!snapEnabled || jumping || performance.now() < cooldownUntil) return;
    const center = VH() * 0.5;
    let cover = null;
    for (const c of cinematics) {
      const r = c.el.getBoundingClientRect();
      if (r.top <= center && r.bottom >= center) { cover = c; break; }
    }
    if (cover && cover !== engaged) engage(cover);
    else if (!cover && engaged) { engaged = null; if (lenis) lenis.start(); }
  }

  if (snapEnabled) {
    /* While engaged, every scroll input is captured: wheel/touch are
       preventDefault-ed (Lenis is also stopped) so the clip can't be
       scrubbed, and one latched gesture becomes one jump. */
    window.addEventListener("wheel", (e) => {
      if (sidebarOpen || !engaged) return; /* menu open, or free scroll elsewhere */
      e.preventDefault();
      clearTimeout(wheelQuiet);
      wheelQuiet = setTimeout(() => { wheelLatched = false; }, 140);
      if (wheelLatched || jumping || Math.abs(e.deltaY) < 4) return;
      wheelLatched = true;
      jump(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    window.addEventListener("touchstart", (e) => {
      if (engaged && !sidebarOpen) touchY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (sidebarOpen || !engaged) return;
      e.preventDefault();
      if (jumping || touchY === null) return;
      const dy = touchY - e.touches[0].clientY;
      if (Math.abs(dy) > 44) { touchY = null; jump(dy > 0 ? 1 : -1); }
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (sidebarOpen || !engaged || jumping) return;
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault(); jump(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault(); jump(-1);
      }
    });
  }

  /* Kick off frame loading per section as it approaches the viewport.
     The hero is on screen at load, so it starts immediately; the second
     cinematic waits until the visitor is within a viewport of it instead
     of competing with the hero for bandwidth on page load. Reduced motion
     shows only each clip's resting final frame, so fetch just that. */
  if (reducedMotion) {
    cinematics.forEach((c) => { c.loadFinal(); c.showFinal(); });
  } else if ("IntersectionObserver" in window) {
    cinematics.forEach((c) => {
      const loadIO = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { c.load(); loadIO.disconnect(); }
      }, { rootMargin: "100% 0px" });
      loadIO.observe(c.el);
    });
  } else {
    cinematics.forEach((c) => c.load());
  }

  /* Touch / no-snap path: native scrolling is left completely alone; each
     cinematic clip simply plays once whenever its panel scrolls into view. */
  if (!reducedMotion && !snapEnabled && cinematics.length) {
    cinematics.forEach((c) => {
      let visible = false;
      new IntersectionObserver((entries) => {
        const nowVisible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.45;
        if (nowVisible && !visible) c.play();
        visible = nowVisible;
      }, { threshold: [0, 0.45, 0.9] }).observe(c.el);
    });
  }

  function raf(t) {
    if (lenis) lenis.raf(t);
    cinematics.forEach((c) => c.tick(t));
    evaluate();
    navUpdate();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  /* Anchor links → smooth scroll via Lenis (native smooth as fallback).
     Releases any engaged panel first so a locked cinematic never swallows
     the jump, and re-evaluates on arrival in case the target is cinematic. */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      engaged = null;
      jumping = true;
      const done = () => { jumping = false; cooldownUntil = performance.now() + 260; evaluate(); };
      if (lenis) {
        lenis.start();
        lenis.scrollTo(target, { offset: 0, duration: reducedMotion ? 0 : 1.4, lock: true, onComplete: done });
      } else {
        target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
        setTimeout(done, 700);
      }
    });
  });

  /* Scroll reveals + counters */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        if (e.target.classList.contains("stat-num")) animateCount(e.target);
        io.unobserve(e.target);
      });
    },
    { threshold: 0.2 }
  );
  document.querySelectorAll(".reveal, .stat-num").forEach((el) => io.observe(el));

  /* Scroll hint — this fires on every Lenis scroll tick, so cache the
     nodes and only write when the visibility state actually flips. */
  const hints = [...document.querySelectorAll(".scroll-hint")];
  let hintsHidden = null;
  const updateHints = (scroll) => {
    const hide = scroll > 60;
    if (hide === hintsHidden) return;
    hintsHidden = hide;
    hints.forEach((h) => { h.style.opacity = hide ? "0" : "1"; });
  };
  if (lenis) {
    lenis.on("scroll", ({ scroll }) => updateHints(scroll));
  } else {
    window.addEventListener("scroll", () => updateHints(window.scrollY), { passive: true });
  }

  initPainNavigator();
  initStressTest();
  initContactForm();

  /* ---------- Slide-in menu sidebar ----------
     Lives in boot() scope so it can coordinate with Lenis and the snap
     controller: opening locks page scroll; closing only resumes free scroll
     when no cinematic panel is engaged; and `sidebarOpen` tells the snap input
     handlers above to keep their hands off the wheel/touch while the menu is up. */
  (function initSidebar() {
    const toggle = document.getElementById("nav-toggle");
    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("sidebar-scrim");
    const closeBtn = document.getElementById("sidebar-close");
    if (!toggle || !sidebar || !scrim) return;
    const focusable = () => [...sidebar.querySelectorAll("a[href], button")];
    let lastFocus = null;

    function open() {
      if (sidebarOpen) return;
      sidebarOpen = true;
      lastFocus = document.activeElement;
      sidebar.classList.add("is-open");
      scrim.classList.add("is-open");
      toggle.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      sidebar.setAttribute("aria-hidden", "false");
      document.documentElement.style.overflow = "hidden"; /* lock background, incl. native touch scroll */
      if (lenis) lenis.stop();
      const f = closeBtn || focusable()[0];
      if (f) f.focus();
    }
    function close(restoreFocus) {
      if (!sidebarOpen) return;
      sidebarOpen = false;
      sidebar.classList.remove("is-open");
      scrim.classList.remove("is-open");
      toggle.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      sidebar.setAttribute("aria-hidden", "true");
      document.documentElement.style.overflow = "";
      if (lenis && !engaged) lenis.start(); /* don't break a cinematic lock */
      if (restoreFocus !== false && lastFocus) lastFocus.focus();
    }

    toggle.addEventListener("click", () => (sidebarOpen ? close() : open()));
    scrim.addEventListener("click", () => close());
    if (closeBtn) closeBtn.addEventListener("click", () => close());

    /* A link closes the menu; for in-page (#) links the anchor handler above
       also fires and manages the smooth scroll, so don't yank focus back. */
    sidebar.querySelectorAll("a[href]").forEach((a) => {
      a.addEventListener("click", () => close(false));
    });

    document.addEventListener("keydown", (e) => {
      if (!sidebarOpen) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") {
        const f = focusable();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  })();
});
