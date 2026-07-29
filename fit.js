/* ============================================================
   J PARK & ASSOCIATES — "See if we're a fit" client-fit form
   Two paths (individual / business), 3 question steps each, a
   contact step, and an on-screen verdict. Answers autosave to
   localStorage; the submit posts to the same Web3Forms inbox as
   the other site forms. Analytics events follow analytics.js
   conventions: fit_path_selected, fit_step_view, generate_lead.
   ============================================================ */
(function () {
  "use strict";

  const app = document.getElementById("fit-app");
  if (!app) return;

  const WEB3_KEY = "f157657a-37a9-47ec-9b50-3b8960d41025";
  const STORE_KEY = "jpa-fit-inquiry-v1";
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PATHS = {
    individual: {
      title: "For myself or my family",
      desc: "Personal taxes, a notice from the IRS, or a preparer who stopped returning calls.",
      meta: "About 2 minutes",
      strongBody:
        "Individual returns and notice resolution are everyday work here. Justin will call to walk through your situation and quote a flat fee before any paperwork changes hands.",
      steps: [
        { title: "What brings you in?", intro: "Pick everything that applies — there are no wrong answers here.", fields: [
          { k: "needs", label: "What do you need help with?", type: "pills", multi: true, options: ["Tax return preparation", "Back or amended returns", "An IRS or FTB notice", "Tax planning", "Estimated payments", "Not sure yet"] },
          { k: "timing", label: "When do you need it?", type: "pills", req: true, options: ["This week", "This month", "Before the next deadline", "Just exploring"] }
        ] },
        { title: "A little about your situation", intro: "Rough answers are fine. Nothing here identifies you.", fields: [
          { k: "situation", label: "Which sounds most like you?", type: "pills", req: true, options: ["W-2 income only", "Self-employed or freelance", "Rental property owner", "Investments or retirement", "A mix of the above"] },
          { k: "complexity", label: "Anything that makes this year unusual?", type: "pills", multi: true, hint: "Optional — helps us judge scope.", options: ["Moved or multi-state", "Marriage or divorce", "New dependent", "Sold a home or business", "Foreign accounts", "Nothing unusual"] },
          { k: "current", label: "Who handles it today?", type: "pills", req: true, options: ["I do it myself", "Another CPA or preparer", "Software", "Nobody — I am behind"] }
        ] },
        { title: "Anything else we should know about you?", intro: "Two sentences is plenty. Skip it if nothing comes to mind.", fields: [
          { k: "about", label: "In your own words", type: "textarea", ph: "What prompted you to look for a CPA right now?" }
        ] }
      ]
    },
    business: {
      title: "For my business",
      desc: "LLCs, S-corps, partnerships — books, payroll, and the entity return.",
      meta: "About 2 minutes",
      strongBody:
        "Books, payroll, and the entity return for owner-run businesses in the Crescenta Valley is the core of this practice. Justin will call to confirm scope and quote a flat monthly fee — no obligation, and no documents needed for that conversation.",
      steps: [
        { title: "What do you need handled?", intro: "Pick everything that applies. We will tell you honestly if something is outside our lane.", fields: [
          { k: "needs", label: "Services you are looking for", type: "pills", multi: true, options: ["Business tax return", "Bookkeeping", "Payroll", "Sales & use tax", "Financial statements", "Advisory / planning", "Not sure yet"] },
          { k: "timing", label: "When do you need it?", type: "pills", req: true, options: ["This week", "This month", "Before the next deadline", "Just exploring"] }
        ] },
        { title: "The shape of the business", intro: "Ranges are fine — this is just to size the work.", fields: [
          { k: "entity", label: "Entity type", type: "pills", req: true, options: ["LLC", "S corporation", "C corporation", "Partnership", "Sole proprietor", "Not formed yet"] },
          { k: "industry", label: "Industry", type: "pills", req: true, options: ["Restaurant / food", "Optometry / medical", "Wholesale / distribution", "Service station", "Legal services", "Grocery / retail", "Construction", "Other"] },
          { k: "size", label: "People on payroll", type: "pills", req: true, options: ["Just the owners", "1–5", "6–20", "21–50", "51 or more"] },
          { k: "revenue", label: "Annual revenue", type: "pills", hint: "A ballpark range is all we need.", options: ["Under $250K", "$250K – $1M", "$1M – $5M", "$5M – $20M", "Over $20M", "Pre-revenue"] }
        ] },
        { title: "How are the books kept today?", intro: "Honest answers make the first call far more useful.", fields: [
          { k: "books", label: "Current setup", type: "pills", req: true, options: ["QuickBooks Online", "QuickBooks Desktop", "Xero", "Spreadsheets", "A bookkeeper handles it", "Nothing yet"] },
          { k: "state", label: "How current are they?", type: "pills", req: true, options: ["Closed through last month", "A few months behind", "Over a year behind", "No idea"] },
          { k: "about", label: "Anything else we should know about the business?", type: "textarea", ph: "An open notice, a loan application, a partner buyout, a busy season coming…" }
        ] }
      ]
    }
  };

  function contactDefs(view) {
    return [
      { k: "name", label: "Your name", req: true, span: 1, ph: "First and last", type: "text", input: "text", ac: "name" },
      { k: "company", label: view === "business" ? "Business name" : "Preferred name", span: 1, ph: view === "business" ? "As customers know it" : "Optional", type: "text", input: "text", ac: "organization" },
      { k: "email", label: "Email", req: true, span: 1, ph: "name@example.com", type: "text", input: "email", ac: "email" },
      /* Phone is only required when the prospect asks for a call back —
         a required phone field is the single biggest drop-off point on
         lead forms, and "Best way to reach you" already tells us
         whether we actually need it. */
      { k: "phone", label: "Phone", span: 1, ph: "(818) 555-0100", type: "text", input: "tel", ac: "tel" },
      { k: "prefer", label: "Best way to reach you", type: "pills", span: 2, options: ["Phone call", "Email", "Text"] },
      { k: "referral", label: "How you heard about us", type: "pills", span: 2, options: ["Referral", "Search", "Local / drive-by", "Existing client", "Other"] }
    ];
  }

  /* ---------- state ---------- */
  let view = "start"; // 'start' | 'individual' | 'business'
  let step = 0;       // 0..2 questions, 3 contact, 4 result
  let touched = false;
  let sending = false;
  let refNumber = "";
  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw).data || {};
    } catch (e) { /* private mode etc. */ }
    return {};
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ data: data })); } catch (e) {}
  }
  function val(k) { return (data[view] || {})[k] || ""; }
  function set(k, v) {
    data[view] = data[view] || {};
    data[view][k] = v;
    save();
    if (touched) updateValidationUI();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function track(event, params) {
    if (window.gtag) window.gtag("event", event, params);
  }

  /* ---------- derived ---------- */
  function qSteps() { return PATHS[view].steps; }
  function contactIndex() { return qSteps().length; }
  function isContact() { return step === contactIndex(); }
  function isResult() { return step === contactIndex() + 1; }

  function missingFields() {
    if (isContact()) {
      const wantsCall = val("prefer") === "Phone call";
      return contactDefs(view).filter((f) => {
        if (f.k === "phone") return wantsCall && !val("phone").trim();
        if (f.k === "email") return !val("email").trim();
        return f.req && !String(val(f.k)).trim();
      });
    }
    const st = qSteps()[step];
    return (st.fields || []).filter((f) => f.req && !val(f.k));
  }

  /* ---------- navigation ---------- */
  function go(nextStep) {
    step = nextStep;
    touched = false;
    render();
    window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
    const h = app.querySelector("h1");
    if (h) h.focus({ preventScroll: true });
    if (!isResult()) {
      track("fit_step_view", { path: view, step: step + 1, step_name: isContact() ? "contact" : qSteps()[step].title });
    }
  }

  function openPath(k) {
    view = k;
    step = 0;
    touched = false;
    track("fit_path_selected", { path: k });
    render();
    window.scrollTo({ top: 0 });
    const h = app.querySelector("h1");
    if (h) h.focus({ preventScroll: true });
    track("fit_step_view", { path: view, step: 1, step_name: qSteps()[0].title });
  }

  function goStart() {
    view = "start";
    step = 0;
    touched = false;
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- render: start / path chooser ---------- */
  function renderStart() {
    const cards = Object.keys(PATHS).map((k, i) => {
      const p = PATHS[k];
      const hasDraft = !!data[k] && Object.keys(data[k]).some((kk) => {
        const v = data[k][kk];
        return Array.isArray(v) ? v.length > 0 : String(v).trim() !== "";
      });
      return (
        '<button type="button" class="fit-path-card" data-path="' + k + '">' +
          '<span class="num">' + String(i + 1).padStart(2, "0") + "</span>" +
          "<h2>" + p.title + "</h2>" +
          "<p>" + p.desc + "</p>" +
          '<span class="meta">' + p.meta + " &rarr;</span>" +
          (hasDraft ? '<span class="fit-resume">Pick up where you left off</span>' : "") +
        "</button>"
      );
    }).join("");

    app.innerHTML =
      '<div class="fit-start">' +
        '<span class="fit-eyebrow">No account, no documents</span>' +
        '<h1 tabindex="-1">A few quick questions. Then we&rsquo;ll tell you if we&rsquo;re a fit.</h1>' +
        '<p class="fit-lede">No Social Security numbers, no uploads, no obligation. Just enough for a CPA to know whether we&rsquo;re the right office for you &mdash; and to come to the call prepared.</p>' +
      "</div>" +
      '<div class="fit-paths">' + cards + "</div>" +
      '<p class="fit-trustline">A CPA office on Foothill Blvd. &mdash; keeping Crescenta Valley books in order for 15+ years.</p>' +
      '<p class="fit-callline">Would rather just talk? Call <a href="tel:+18182481580">(818)&nbsp;248-1580</a> &mdash; Mon&ndash;Fri, 9 to 5:30.</p>';

    app.querySelectorAll(".fit-path-card").forEach((btn) => {
      btn.addEventListener("click", () => openPath(btn.dataset.path));
    });
  }

  /* ---------- render: shared step chrome ---------- */
  /* One leading pip for the path choice the visitor already made —
     arriving on step 1 with visible progress beats starting from zero
     (goal-gradient: people finish what looks already begun). */
  function chromeTop() {
    const totalInput = contactIndex() + 1; // question steps + contact
    const counter = isResult()
      ? "Sent"
      : isContact()
        ? "Last step"
        : "Step " + (step + 2) + " of " + (totalInput + 1);
    let pips = "";
    for (let n = 0; n < totalInput + 1; n++) {
      pips += '<span class="' + (n <= step + 1 ? "on" : "") + '"></span>';
    }
    return (
      '<div class="fit-head" data-noprint>' +
        '<button type="button" class="fit-plain-btn" id="fit-restart">&larr; Start over</button>' +
        '<span class="fit-counter">' + counter + "</span>" +
      "</div>" +
      '<div class="fit-pips" data-noprint>' + pips + "</div>"
    );
  }

  function pillsHTML(f) {
    const cur = f.multi ? (val(f.k) || []) : val(f.k);
    const role = f.multi ? "group" : "radiogroup";
    return (
      '<div class="fit-opts" role="' + role + '" aria-label="' + esc(f.label) + '">' +
      f.options.map((o) => {
        const on = f.multi ? cur.indexOf(o) > -1 : cur === o;
        return '<button type="button" data-k="' + f.k + '" data-opt="' + esc(o) + '" aria-pressed="' + on + '">' + esc(o) + "</button>";
      }).join("") +
      "</div>"
    );
  }

  function bindPills(scope) {
    scope.querySelectorAll(".fit-opts button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = findField(btn.dataset.k);
        const o = btn.dataset.opt;
        if (f.multi) {
          const arr = (val(f.k) || []).slice();
          const ix = arr.indexOf(o);
          if (ix > -1) arr.splice(ix, 1); else arr.push(o);
          set(f.k, arr);
          btn.setAttribute("aria-pressed", String(ix === -1));
        } else {
          const on = val(f.k) === o;
          set(f.k, on ? "" : o);
          btn.parentElement.querySelectorAll("button").forEach((b) =>
            b.setAttribute("aria-pressed", String(b === btn && !on))
          );
          if (f.k === "prefer") updatePhoneRequired();
        }
      });
    });
  }

  function findField(k) {
    if (isContact()) return contactDefs(view).find((f) => f.k === k);
    for (const st of qSteps()) {
      const f = (st.fields || []).find((x) => x.k === k);
      if (f) return f;
    }
    return null;
  }

  /* ---------- render: question steps ---------- */
  function renderQuestions() {
    const st = qSteps()[step];
    const fields = st.fields.map((f) => {
      let control = "";
      if (f.type === "pills") control = pillsHTML(f);
      if (f.type === "textarea") {
        control = '<textarea data-k="' + f.k + '" placeholder="' + esc(f.ph || "") + '">' + esc(val(f.k)) + "</textarea>";
      }
      return (
        '<div class="fit-q" data-q="' + f.k + '">' +
          '<label class="fit-q-label">' + esc(f.label) + "</label>" +
          (f.hint ? '<span class="fit-hint">' + esc(f.hint) + "</span>" : "") +
          control +
        "</div>"
      );
    }).join("");

    app.innerHTML =
      chromeTop() +
      '<h1 class="fit-step-title" tabindex="-1">' + esc(st.title) + "</h1>" +
      '<p class="fit-step-intro">' + esc(st.intro) + "</p>" +
      '<div class="fit-qs">' + fields + "</div>" +
      controlsHTML("Continue");

    bindPills(app);
    bindTextInputs(app);
    bindControls();
  }

  /* ---------- render: contact step ---------- */
  function renderContact() {
    const defs = contactDefs(view);
    const fields = defs.map((f) => {
      let control = "";
      let labelExtra = "";
      if (f.type === "pills") {
        control = pillsHTML(f);
      } else {
        control =
          '<input type="' + f.input + '" data-k="' + f.k + '" value="' + esc(val(f.k)) + '" placeholder="' + esc(f.ph) + '"' +
          ' autocomplete="' + f.ac + '"' +
          (f.input === "tel" ? ' inputmode="tel"' : "") +
          (f.input === "email" ? ' inputmode="email"' : "") +
          " />";
      }
      if (f.req) labelExtra = '<span class="fit-req" aria-hidden="true"> *</span>';
      if (f.k === "phone") labelExtra = '<span class="fit-req" id="fit-phone-req" aria-hidden="true" hidden> *</span><span class="fit-opt-note" id="fit-phone-opt">(optional)</span>';
      return (
        '<div class="fit-cfield" data-q="' + f.k + '" style="grid-column: span ' + (f.span || 1) + ';">' +
          '<label class="fit-clabel">' + esc(f.label) + labelExtra + "</label>" +
          control +
        "</div>"
      );
    }).join("");

    app.innerHTML =
      chromeTop() +
      '<h1 class="fit-step-title" tabindex="-1">Where should we send the answer?</h1>' +
      '<p class="fit-step-intro">Name and email &mdash; that&rsquo;s all we need. Justin reads every one of these and replies within one business day.</p>' +
      '<div class="fit-cgrid">' + fields + "</div>" +
      '<p class="fit-privacy">We use this only to reply. No mailing list, no sharing &mdash; and nothing sensitive is asked for until you&rsquo;ve decided to work with us.</p>' +
      controlsHTML("Send it");

    bindPills(app);
    bindTextInputs(app);
    bindControls();
    updatePhoneRequired();
  }

  function updatePhoneRequired() {
    const star = document.getElementById("fit-phone-req");
    const opt = document.getElementById("fit-phone-opt");
    if (!star || !opt) return;
    const wantsCall = val("prefer") === "Phone call";
    star.hidden = !wantsCall;
    opt.hidden = wantsCall;
    if (touched) updateValidationUI();
  }

  function bindTextInputs(scope) {
    scope.querySelectorAll("input[data-k], textarea[data-k]").forEach((el) => {
      el.addEventListener("input", () => set(el.dataset.k, el.value));
      if (el.tagName === "INPUT") {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); next(); }
        });
      }
    });
  }

  /* ---------- controls + validation ---------- */
  function controlsHTML(nextLabel) {
    return (
      '<div class="fit-controls" data-noprint>' +
        (step > 0 ? '<button type="button" class="fit-back" id="fit-back">Back</button>' : "<span></span>") +
        '<div class="fit-controls-right">' +
          '<span class="fit-note" id="fit-note" role="status" aria-live="polite"></span>' +
          '<button type="button" class="btn btn-gold" id="fit-next">' + nextLabel + "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function bindControls() {
    const restart = document.getElementById("fit-restart");
    if (restart) restart.addEventListener("click", goStart);
    const back = document.getElementById("fit-back");
    if (back) back.addEventListener("click", () => go(step - 1));
    const nextBtn = document.getElementById("fit-next");
    if (nextBtn) nextBtn.addEventListener("click", next);
  }

  function updateValidationUI() {
    const missing = missingFields();
    const note = document.getElementById("fit-note");
    app.querySelectorAll(".fit-missing").forEach((el) => el.classList.remove("fit-missing"));
    let text = "";
    if (touched && missing.length) {
      missing.forEach((f) => {
        const block = app.querySelector('[data-q="' + f.k + '"]');
        if (block) block.classList.add("fit-missing");
      });
      text = "Still needed: " + missing.map((f) => f.label).join(", ");
    } else if (touched && isContact() && val("email").trim() && !EMAIL_RE.test(val("email").trim())) {
      const block = app.querySelector('[data-q="email"]');
      if (block) block.classList.add("fit-missing");
      text = "That email doesn’t look right — mind checking it?";
    }
    if (note && !sending) {
      note.textContent = text;
      note.className = "fit-note" + (text ? " err" : "");
    }
    return missing;
  }

  function next() {
    if (sending) return;
    const missing = missingFields();
    const badEmail = isContact() && val("email").trim() && !EMAIL_RE.test(val("email").trim());
    if (missing.length || badEmail) {
      touched = true;
      updateValidationUI();
      const first = app.querySelector(".fit-missing");
      if (first) {
        first.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
        const focusable = first.querySelector("input, textarea, button");
        if (focusable) focusable.focus({ preventScroll: true });
      }
      return;
    }
    if (isContact()) { submit(); return; }
    go(step + 1);
  }

  /* ---------- submit ---------- */
  function buildMessage() {
    const lines = [];
    const answered = (k) => {
      const v = (data[view] || {})[k];
      return Array.isArray(v) ? v.join(", ") : (v || "");
    };
    qSteps().forEach((st) => {
      (st.fields || []).forEach((f) => {
        lines.push(f.label + ": " + (answered(f.k) || "—"));
      });
    });
    contactDefs(view).forEach((f) => {
      lines.push(f.label + ": " + (answered(f.k) || "—"));
    });
    return (
      "Fit inquiry (" + view + ") — " + refNumber + "\n\n" +
      lines.join("\n") +
      "\n\nSubmitted from https://jparkassociates.com/fit/"
    );
  }

  function makeRef() {
    const d = new Date();
    const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return "JPA-" + (view === "business" ? "BIZ" : "IND") + "-" + ymd + "-" + rand;
  }

  async function submit() {
    const note = document.getElementById("fit-note");
    const nextBtn = document.getElementById("fit-next");
    sending = true;
    nextBtn.disabled = true;
    note.textContent = "Sending…";
    note.className = "fit-note";
    refNumber = refNumber || makeRef();
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3_KEY,
          subject: "Fit inquiry — " + (val("name").trim() || "Website visitor") + " (" + view + ") — " + refNumber,
          from_name: "Fit Form",
          email: val("email").trim(),
          cc: "justinparkcpa@gmail.com",
          phone: val("phone").trim(),
          message: buildMessage()
        })
      });
      const resData = await res.json();
      if (!resData.success) throw new Error(resData.message);
      track("generate_lead", { form: "fit_inquiry", path: view });
      sending = false;
      go(step + 1);
    } catch (err) {
      sending = false;
      nextBtn.disabled = false;
      note.textContent = "Something went wrong — your answers are saved. Try again, or email justinpark@jparkassociates.com directly.";
      note.className = "fit-note err";
    }
  }

  /* ---------- render: result ---------- */
  function renderResult() {
    const needs = val("needs") || [];
    const concrete = (Array.isArray(needs) ? needs : []).filter((n) => n !== "Not sure yet");
    /* "Not sure yet" alongside real services shouldn't demote the
       verdict — only an empty or nothing-but-unsure selection does. */
    const strong = concrete.length > 0;
    const timing = val("timing");
    const urgent = timing === "This week";
    const exploring = timing === "Just exploring";

    const kicker = strong ? "Good news" : "Received";
    const title = strong
      ? "This is squarely the work we do."
      : "Thanks — we have what we need to point you somewhere.";
    const body = strong
      ? PATHS[view].strongBody
      : "A CPA will read this and reply with a straight answer — including if another office is a better fit for what you need. No pressure either way.";

    const callBtn = '<a class="btn btn-gold" href="tel:+18182481580">Call (818) 248-1580</a>';
    const emailBtn = '<a class="btn btn-ghost-light" href="mailto:justinpark@jparkassociates.com">Email Justin</a>';
    const ctas = exploring ? emailBtn + callBtn : callBtn + emailBtn;
    const urgencyLine = urgent
      ? '<p class="fit-urgency">Need it this week? Calling is fastest — the office picks up Mon–Fri, 9 to 5:30.</p>'
      : "";

    const answered = (k) => {
      const v = (data[view] || {})[k];
      return Array.isArray(v) ? v.join(", ") : (v || "");
    };
    const defs = qSteps().reduce((acc, s) => acc.concat(s.fields), []).concat(contactDefs(view));
    const rows = defs.map((f) => {
      const v = answered(f.k);
      return (
        '<div class="fit-sumrow">' +
          "<dt>" + esc(f.label) + "</dt>" +
          '<dd class="' + (v ? "" : "skip") + '">' + (v ? esc(v) : "Skipped") + "</dd>" +
        "</div>"
      );
    }).join("");

    app.innerHTML =
      chromeTop() +
      '<div class="fit-verdict">' +
        '<span class="kicker">' + kicker + "</span>" +
        '<h1 tabindex="-1">' + title + "</h1>" +
        "<p>" + body + "</p>" +
        urgencyLine +
        '<div class="fit-verdict-ctas" data-noprint>' + ctas + "</div>" +
        '<p class="fit-hours" data-noprint>Mon–Fri, 9 AM–5:30 PM &middot; 2529 Foothill Blvd. Ste 101, La Crescenta</p>' +
      "</div>" +
      '<div class="fit-summary">' +
        "<h2>What we heard</h2>" +
        '<p class="fit-sumline">Sent to the office as <strong>' + esc(refNumber) + "</strong>. A CPA replies within one business day.</p>" +
        "<dl>" + rows + "</dl>" +
        '<div class="fit-sumlinks" data-noprint>' +
          '<button type="button" class="fit-plain-link" id="fit-print">Print a copy</button>' +
          '<button type="button" class="fit-plain-link" id="fit-again">Fill this out for someone else</button>' +
        "</div>" +
      "</div>";

    document.getElementById("fit-print").addEventListener("click", () => window.print());
    document.getElementById("fit-again").addEventListener("click", () => {
      data = {};
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      refNumber = "";
      goStart();
    });
    const restart = document.getElementById("fit-restart");
    if (restart) restart.addEventListener("click", goStart);
  }

  /* ---------- root render ---------- */
  function render() {
    if (view === "start") { renderStart(); return; }
    if (isResult()) { renderResult(); return; }
    if (isContact()) { renderContact(); return; }
    renderQuestions();
  }

  render();
})();
