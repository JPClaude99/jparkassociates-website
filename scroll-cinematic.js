/* ============================================================
   J PARK & ASSOCIATES — scroll engine + interactions
   Canvas frame-sequence scrub, Lenis smooth scroll, reveals,
   pain-point navigator, stress test, nav theme swap.
   ============================================================ */

/* ---------- Frame-scrub sections ---------- */

/* Frames decode off the main thread only when createImageBitmap is fed
   a Blob — createImageBitmap(<img>) decodes synchronously on the main
   thread in Chrome (~12 ms per 1920x1080 frame, measured). So we keep
   compressed Blobs (~55 KB each, ~20 MB for all 362) and decode a
   sliding window of them into ImageBitmaps as the user scrolls. */
const USE_BITMAPS = typeof createImageBitmap === "function" && typeof fetch === "function";

/* Shared frame loader: priority queue with limited concurrency.
   Firing 362 requests at once lets HTTP/2 multiplex them all, so every
   frame trickles in together and none completes early; a small
   concurrent window makes frames complete progressively instead. */
const frameLoader = (() => {
  const queue = [];
  let active = 0;
  const MAX_CONCURRENT = 8;
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      active++;
      const settle = (result) => {
        active--;
        job.cb(result || null);
        pump();
      };
      if (USE_BITMAPS) {
        fetch(job.src)
          .then((r) => (r.ok ? r.blob() : null))
          .then(settle)
          .catch(() => settle(null));
      } else {
        /* Legacy path: plain images, drawn directly (pre-2021 browsers) */
        const img = new Image();
        img.decoding = "async";
        img.onload = () => { img.onload = img.onerror = null; settle(img); };
        img.onerror = () => { img.onload = img.onerror = null; settle(null); };
        img.src = job.src;
      }
    }
  }
  return {
    enqueue(src, cb, front) {
      const job = { src, cb };
      if (front) queue.unshift(job); else queue.push(job);
      pump();
    }
  };
})();

function initCinematic(cfg) {
  const section = document.querySelector(cfg.section);
  const canvas = section.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const lines = [...section.querySelectorAll(".reveal-line")];
  const progressFill = section.querySelector(".gold-progress span");
  const bgFill = cfg.bg || "#111c33";
  const frames = []; /* Blob per frame (or <img> on the legacy path) */
  let frameW = 0, frameH = 0; /* native frame size, known after first decode */
  let current = -1;
  let fallbackIdx = -1; /* index of the last-drawn frame; protected from eviction */

  /* The color grade lives on the element as a GPU-composited CSS filter.
     ctx.filter ran the same math on the CPU for every drawImage (~2x the
     draw cost here, far worse at dpr 2). Bonus: Safari historically
     ignored ctx.filter, so the grade now applies there too. */
  if (cfg.filter) canvas.style.filter = cfg.filter;

  /* --- Decoded-frame cache: a sliding window of ImageBitmaps. ---
     362 frames decode to ~3 GB of RGBA, so the browser's image-decode
     cache thrashes and drawImage(<img>) pays a ~15 ms synchronous
     main-thread decode on every cache miss — the main jank source.
     createImageBitmap(blob) decodes on a worker thread, so we keep a
     window of decoded bitmaps around the current frame and the hot path
     only ever draws already-decoded pixels. */
  const RANGE = navigator.deviceMemory && navigator.deviceMemory <= 4 ? 8 : 14;
  const bitmaps = new Map();
  const decoding = new Set();

  function decodeIdx(i) {
    if (i < 0 || i >= cfg.frameCount) return;
    if (bitmaps.has(i) || decoding.has(i) || !frames[i]) return;
    decoding.add(i);
    createImageBitmap(frames[i]).then((bm) => {
      decoding.delete(i);
      if (!frameW) {
        frameW = bm.width;
        frameH = bm.height;
        resize(); /* apply the source-capped dpr now that dims are known */
      }
      if (Math.abs(i - current) > RANGE + 2) { bm.close(); return; }
      bitmaps.set(i, bm);
      if (i === current) draw(current); /* upgrade a nearest-frame fallback draw */
    }).catch(() => decoding.delete(i));
  }

  function ensureDecoded(center) {
    if (!USE_BITMAPS) return;
    for (const [i, bm] of bitmaps) {
      /* Keep the fallback frame alive even if it drifts outside the window —
         it is the last resort when a fast-scroll empties the entire cache. */
      if (Math.abs(i - center) > RANGE + 2 && i !== fallbackIdx) {
        bm.close(); bitmaps.delete(i);
      }
    }
    for (let d = 0; d <= RANGE; d++) {
      decodeIdx(center + d);
      if (d) decodeIdx(center - d);
    }
  }

  function releaseBitmaps() {
    for (const bm of bitmaps.values()) bm.close();
    bitmaps.clear();
    fallbackIdx = -1;
  }

  /* Best available source for a frame. Returns [bitmap, frameIndex] or null.
     Search order: exact match → nearest decoded → protected fallback (last
     successfully drawn frame, kept alive through eviction so a fast-scroll
     decode catch-up never leaves the canvas blank). */
  function sourceFor(index) {
    if (USE_BITMAPS) {
      if (bitmaps.has(index)) return [bitmaps.get(index), index];
      for (let d = 1; d <= RANGE; d++) {
        const i1 = index + d;
        if (bitmaps.has(i1)) return [bitmaps.get(i1), i1];
        const i2 = index - d;
        if (bitmaps.has(i2)) return [bitmaps.get(i2), i2];
      }
      if (fallbackIdx >= 0 && bitmaps.has(fallbackIdx)) return [bitmaps.get(fallbackIdx), fallbackIdx];
      return null;
    }
    for (let d = 0; d < cfg.frameCount; d++) {
      const a = frames[index + d], b = frames[index - d];
      if (a && a.complete && a.naturalWidth) return [a, index + d];
      if (b && b.complete && b.naturalWidth) return [b, index - d];
    }
    return null;
  }

  function draw(index) {
    const hit = sourceFor(index);
    if (!hit) return;
    const [src, srcIdx] = hit;
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    if (!iw || !ih) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const ir = iw / ih, cr = cw / ch;
    let dw, dh, dx, dy;
    if (ir > cr) {
      dh = ch; dw = ch * ir; dx = (cw - dw) / 2; dy = 0;
    } else {
      dw = cw; dh = cw / ir; dx = 0; dy = (ch - dh) / 2;
    }
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, dx, dy, dw, dh);
    fallbackIdx = srcIdx; /* pin: survives the next ensureDecoded eviction pass */
  }

  function resize() {
    /* Cap the backing store at what the 1920x1080 source can actually
       feed: under cover-fit the source detail on screen is
       min(frameW/cssW, frameH/cssH) px per CSS px, so any dpr above
       that only multiplies GPU fill and memory (a dpr-2 laptop was
       pushing a 3840x2160 backing store for a 1920px source) without
       adding a single pixel of real detail. */
    const cssW = canvas.clientWidth || 1, cssH = canvas.clientHeight || 1;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (frameW && frameH) dpr = Math.min(dpr, Math.min(frameW / cssW, frameH / cssH));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* Paint the section's navy immediately — an alpha:false canvas is
       opaque black until first draw, which read as a dead-black flash
       before frame 1 decoded (and after any resize mid-catchup). */
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, cssW, cssH);
    draw(current < 0 ? 0 : current);
  }

  /* ---- Playback model ----
     The clip plays once when the panel engages, on its own clock. Frame
     index and the three text reveals are both driven by playback progress
     p (0→1) — NOT by how far the page is scrolled. The snap controller in
     boot() calls play()/reset()/showFinal() as the panel engages, leaves,
     and (under reduced motion) rests. */
  const duration = cfg.duration || 6000; /* ms for one full play-through */
  let playing = false;
  let playStart = 0;

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

  function renderAt(p) {
    const idx = Math.min(cfg.frameCount - 1, Math.floor(p * (cfg.frameCount - 1)));
    if (idx !== current) { current = idx; draw(idx); }
    ensureDecoded(idx); /* keep the decode window warm ahead of playback */
    applyReveals(p);
  }

  /* Driven from the single global rAF (see boot) so there's no per-section
     timer. Advances the clip while playing; when idle it only frees the
     decoded window once the panel is well off-screen. */
  function tick(t) {
    if (playing) {
      if (playStart === 0) playStart = t;
      const p = Math.min((t - playStart) / duration, 1);
      renderAt(p);
      if (p >= 1) playing = false; /* hold the final frame + final copy */
      return;
    }
    if (bitmaps.size) {
      const r = section.getBoundingClientRect(), vh = window.innerHeight;
      if (r.bottom < -vh * 0.5 || r.top > vh * 1.5) releaseBitmaps();
    }
  }

  function play() { playing = true; playStart = 0; ensureDecoded(0); }
  function reset() { playing = false; playStart = 0; current = -1; renderAt(0); }
  function showFinal() { playing = false; renderAt(1); } /* reduced-motion rest state */

  /* Stride order: cover the whole scrub range coarsely first, then fill
     in. A fast first scroll finds frames spread across the section (the
     nearest-frame fallback bridges the gaps) instead of a frozen canvas. */
  const seq = [];
  const seen = new Set();
  for (const stride of [16, 4, 1]) {
    for (let i = 0; i < cfg.frameCount; i += stride) {
      if (!seen.has(i)) { seen.add(i); seq.push(i); }
    }
  }
  for (const i of seq) {
    frameLoader.enqueue(cfg.framePath(i + 1), (result) => {
      if (!result) return;
      frames[i] = result;
      if (!USE_BITMAPS && !frameW && result.naturalWidth) {
        frameW = result.naturalWidth;
        frameH = result.naturalHeight;
        resize(); /* legacy path: apply the source-capped dpr, paint frame 0 */
      }
    }, i === 0);
  }

  window.addEventListener("resize", resize);
  resize();
  return { tick, play, reset, showFinal, resize, el: section, cfg };
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
  const snapEnabled = !reducedMotion && cinematics.length > 0;
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

  if (reducedMotion) cinematics.forEach((c) => c.showFinal());

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
