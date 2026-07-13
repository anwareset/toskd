(function () {
  // Threshold to decide whether the user has expressed an explicit
  // preference via the toggle. Once set, OS-level changes are ignored.
  function applyInitialTheme() {
    const saved = localStorage.getItem("theme");
    const osDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved || (osDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", initial);
    return saved;
  }

  // Apply synchronously before the body parses so first paint already
  // shows the right palette — avoids flash of wrong-theme content.
  const hadExplicitChoice = applyInitialTheme();

  document.addEventListener("DOMContentLoaded", () => {
    const path = window.location.pathname;
    // Brand title + theme toggle render on every page. Nav links render
    // on all pages EXCEPT exam.html and review.html (per admin-auth-spec
    // §7.3 comment in styles.css — gives exam.html a clean timer-focused
    // header and review.html a distraction-free pembahasan reading view).
    //
    // Rev. 0.8c (user feedback 2026-07-13, same day as Rev. 0.8b):
    // Home page is EXCLUDED from nav (in addition to exam/review per
    // spec). The home page is a landing page with 3 big buttons in the
    // main content (Mulai Ujian, Bank Soal, Scoreboard) — having the
    // same links in the header would be redundant and visually noisy.
    // User explicitly requested: "jangan tampilkan navlink saat
    // berada di index.html". So the condition is now `!isHome &&
    // !isExam && !isReview` — all three pages skip the nav.
    //
    // History:
    //   - Original: `!isHome` check (excluded home, but accidentally
    //     included exam/review — buggy vs spec)
    //   - Rev. 0.8b: `!isExam && !isReview` (matched spec, home got nav)
    //   - Rev. 0.8c: `!isHome && !isExam && !isReview` (final)

    const isHome = path === "/" || path.endsWith("/index.html");
    const isExam = path.endsWith("/exam.html");
    const isReview = path.endsWith("/review.html");

    const header = document.createElement("header");
    header.className = "global-header";

    const title = document.createElement("a");
    title.className = "global-header-title";
    title.textContent = "TOSKD CAT";
    title.href = "/";

    let nav = null;
    if (!isHome && !isExam && !isReview) {
      nav = document.createElement("nav");
      nav.className = "global-header-nav";
      const navLinks = [
        { href: "/select-pack.html", label: "Ujian" },
        { href: "/bank-soal.html", label: "Bank Soal" },
        { href: "/scoreboard.html", label: "Scoreboard" },
      ];
      navLinks.forEach((link) => {
        const a = document.createElement("a");
        a.className = "global-header-link";
        a.href = link.href;
        a.textContent = link.label;
        nav.appendChild(a);
      });
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "theme-toggle-btn";
    // ARIA: role="switch" + aria-checked is the standard accessible
    // pattern for a toggle switch (Material Design / iOS HIG). The
    // visual thumb position (driven by [data-theme] on documentElement)
    // is the state indicator; ARIA attributes communicate the state
    // to assistive tech. Rev. 0.8h: replaced text content with pure
    // visual switch design.
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Toggle dark/light theme");

    function updateToggleLabel() {
      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      const isDark = current === "dark";
      // No text content — the thumb position is the visual state indicator.
      toggle.setAttribute("aria-checked", isDark ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        isDark
          ? "Switch to light theme (currently dark)"
          : "Switch to dark theme (currently light)",
      );
    }
    updateToggleLabel();

    toggle.onclick = () => {
      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      // Mark the choice explicitly so future OS-preference changes
      // stop overriding.
      localStorage.setItem("theme", next);
      updateToggleLabel();
    };

    // Right-side group: theme toggle + (optional) auth/logout button.
    // Wrapping them in a SINGLE flex child keeps the parent .global-header
    // treating the right side as one slot — so space-between keeps the
    // nav consistently positioned regardless of whether the logout button
    // is showing. The internal `gap: 18px` matches .global-header-nav's
    // navlink gap (CSS variable in styles.css), so the auth cluster sits
    // flush with the toggle and the spacing is visually proportional to
    // the navlink cluster on the left.
    const rightGroup = document.createElement("div");
    rightGroup.className = "global-header-right";
    rightGroup.appendChild(toggle);

    // Auth indicator (visible only when logged in). Per admin-auth-
    // spec.md §7.3, fetch /api/admin/me with cookie; if 200, render a
    // Logout button directly inside the right-group. If 401 or network
    // error, silently skip — no element is appended, so the right side
    // collapses back to just the toggle with no phantom DOM.
    //
    // Rev. 0.8g (2026-07-13): removed the unused `<div class="global-
    // header-auth">` wrapper (the `authSlot`) that previously held the
    // button. The wrapper had no styling, no event handlers, no
    // purpose beyond a placeholder. Now the button is appended directly
    // to rightGroup, eliminating a layer of dead weight and letting the
    // mobile `align-items: stretch` (Rev. 0.8f) work on the button
    // itself instead of on a wrapper. This also lets the CSS
    // `width: 100%` workaround on the logout button (Rev. 0.8f Pass 2)
    // be removed — see styles.css for the matching change.
    //
    // Per the global-header design refresh:
    //   - NO username display (no .global-header-user span)
    //   - NO emoji in the auth cluster
    //   - Logout button mirrors .theme-toggle-btn's dimensions (see
    //     styles.css .global-header-logout-btn) but uses --danger bg.
    (async function wireAuth() {
      try {
        const res = await fetch("/api/admin/me", { credentials: "same-origin" });
        if (!res.ok) return; // logged out → no logout button
        const data = await res.json();
        if (!data?.username) return; // optional chaining: handles null/missing JSON safely

        // Logout button: dimensions mirror .theme-toggle-btn; color is
        // --danger per the global-header design refresh. textContent for
        // the label (not innerHTML) is automatic since we use createElement.
        const btn = document.createElement("button");
        btn.className = "global-header-logout-btn";
        btn.type = "button";
        btn.textContent = "Logout";
        btn.onclick = async () => {
          try {
            await fetch("/api/admin/logout", {
              method: "POST",
              credentials: "same-origin",
            });
          } catch (err) {
            console.error("Logout error:", err);
          }
          window.location.replace("/login.html");
        };
        rightGroup.appendChild(btn);
      } catch (err) {
        console.warn("[theme] Could not fetch /api/admin/me:", err);
      }
    })();

    header.appendChild(title);
    if (nav) header.appendChild(nav);
    header.appendChild(rightGroup);

    document.body.insertBefore(header, document.body.firstChild);

    // Live OS-preference tracking. We only honor it while the user has
    // never clicked the toggle; once they make an explicit choice via
    // UI, their decision wins over the OS signal.
    if (!hadExplicitChoice && window.matchMedia) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (e) => {
        if (localStorage.getItem("theme")) return; // user override
        document.documentElement.setAttribute(
          "data-theme",
          e.matches ? "dark" : "light",
        );
        updateToggleLabel();
      };
      if (mql.addEventListener) {
        mql.addEventListener("change", onChange);
      } else if (mql.addListener) {
        // Safari < 14 fallback.
        mql.addListener(onChange);
      }
    }
  });
})();
