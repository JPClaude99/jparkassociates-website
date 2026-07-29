/* ============================================================
   J PARK & ASSOCIATES — site analytics (GA4)
   Loaded on every page. Inert until a Measurement ID is pasted
   below, so it's safe to ship ahead of the account setup.

   To activate:
   1. Create a GA4 property at https://analytics.google.com
      (Admin → Create property → Web stream for jparkassociates.com).
   2. Copy the Measurement ID from the web stream ("G-XXXXXXXXXX").
   3. Paste it into GA_ID below and deploy.

   The forms on the site fire conversion events when analytics is
   active: stress_test_complete, and generate_lead with a `form`
   param of stress_test_email / contact / newsletter / fit_inquiry.
   The /fit/ form also fires fit_path_selected and fit_step_view
   (path + step params) so per-step drop-off is visible.
   ============================================================ */
(function () {
  "use strict";
  var GA_ID = ""; /* <-- paste the GA4 Measurement ID here to enable */
  if (!GA_ID) return;

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_ID, { anonymize_ip: true });
})();
