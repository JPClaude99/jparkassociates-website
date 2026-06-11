/* ============================================================
   J PARK & ASSOCIATES — scroll engine + interactions
   Canvas frame-sequence scrub, Lenis smooth scroll, reveals,
   pain-point navigator, stress test, nav theme swap.
   ============================================================ */

/* ---------- Frame-scrub sections ---------- */
function initScrub(cfg) {
  const section = document.querySelector(cfg.section);
  const canvas = section.querySelector("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const lines = [...section.querySelectorAll(".reveal-line")];
  const progressFill = section.querySelector(".gold-progress span");
  const bgFill = cfg.bg || "#111c33";
  const images = [];
  let firstDrawn = false;

  for (let i = 0; i < cfg.frameCount; i++) {
    const img = new Image();
    img.src = cfg.framePath(i + 1);
    img.onload = () => {
      if (!firstDrawn) { firstDrawn = true; draw(0); }
    };
    images[i] = img;
  }

  let current = -1;

  function draw(index) {
    const img = images[index];
    if (!img || !img.complete || !img.naturalWidth) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const ir = img.naturalWidth / img.naturalHeight, cr = cw / ch;
    let dw, dh, dx, dy;
    if (ir > cr) { dh = ch; dw = ch * ir; dx = (cw - dw) / 2; dy = 0; }
    else { dw = cw; dh = cw / ir; dx = 0; dy = (ch - dh) / 2; }
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, cw, ch);
    if (cfg.filter) ctx.filter = cfg.filter;
    ctx.drawImage(img, dx, dy, dw, dh);
    if (cfg.filter) ctx.filter = "none";
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(current < 0 ? 0 : current);
  }

  function update() {
    const rect = section.getBoundingClientRect();
    if (rect.bottom < -window.innerHeight || rect.top > window.innerHeight) return;
    const scrollable = rect.height - window.innerHeight;
    const p = Math.min(Math.max(-rect.top / scrollable, 0), 1);
    const idx = Math.min(cfg.frameCount - 1, Math.floor(p * (cfg.frameCount - 1)));
    if (idx !== current) { current = idx; draw(idx); }
    if (progressFill) progressFill.style.width = (p * 100).toFixed(2) + "%";
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

  window.addEventListener("resize", resize);
  resize();
  return { update, resize };
}

/* ---------- Stat counters ---------- */
function animateCount(el) {
  const target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || "";
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
     Register jasonpark@jparkassociates.com at web3forms.com, copy the
     access_key here and into #contact-form below. */
  const WEB3_KEY = "REPLACE_WITH_WEB3FORMS_ACCESS_KEY";
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
      emailInput.focus();
      return;
    }
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
        msg.textContent = "Got it — look for a message from jasonpark@jparkassociates.com, usually within one business day.";
        msg.className = "form-msg ok";
        form.reset();
      } else {
        throw new Error(data.message);
      }
    } catch {
      msg.textContent = "Something went wrong — please email jasonpark@jparkassociates.com directly.";
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
  const WEB3_KEY = "REPLACE_WITH_WEB3FORMS_ACCESS_KEY";
  const msg = document.getElementById("cf-msg");
  const submitBtn = form.querySelector("button[type='submit']");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailEl = form.querySelector("#cf-email");
    const emailVal = emailEl ? emailEl.value.trim() : "";
    if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      msg.textContent = "Please include a valid email so we can reach you.";
      msg.className = "form-msg err";
      if (emailEl) emailEl.focus();
      return;
    }
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
        msg.textContent = "Message sent — you’ll hear from jasonpark@jparkassociates.com within one business day.";
        msg.className = "form-msg ok";
        form.reset();
      } else {
        throw new Error(data.message);
      }
    } catch {
      msg.textContent = "Something went wrong — please email jasonpark@jparkassociates.com directly.";
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
  const scrubs = (window.SCRUB_SECTIONS || [])
    .filter((c) => document.querySelector(c.section))
    .map(initScrub);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const navUpdate = initNavTheme();

  const lenis = new Lenis({
    lerp: reducedMotion ? 1 : 0.085,
    smoothWheel: !reducedMotion
  });
  window.__lenis = lenis;

  function raf(t) {
    lenis.raf(t);
    scrubs.forEach((s) => s.update());
    navUpdate();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  /* Anchor links → smooth scroll via Lenis */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0, duration: reducedMotion ? 0 : 1.4 });
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

  lenis.on("scroll", ({ scroll }) => {
    document.querySelectorAll(".scroll-hint").forEach((h) => {
      h.style.opacity = scroll > 60 ? "0" : "1";
    });
  });

  initPainNavigator();
  initStressTest();
  initContactForm();
});
