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

    // Detect mobile viewport early so we can decide whether to render
    // the navlinks on the home page (mobile shows them, desktop
    // doesn’t, per user’s 4th visual test feedback). The matchMedia
    // listener set up later still fires on viewport changes for relayout().
    const mqMobile = window.matchMedia("(max-width: 767px)");
    function isMobile() {
      return mqMobile.matches;
    }

    const header = document.createElement("header");
    header.className = "global-header";

    const title = document.createElement("a");
    title.className = "global-header-title";
    title.textContent = "TOSKD";
    title.href = "/";

    let nav = null;
    // Create navlinks when:
    //   - NOT on exam/review (those pages hide the nav entirely), AND
    //   - EITHER not on home page, OR viewport is mobile.
    // Per Rev. 0.8c the home page is a landing page with 3 big action
    // buttons in the main content; having navlinks in the header
    // would be redundant on desktop. But on mobile, the navlinks live
    // inside the drawer per Phase 2 relayout(), accessed via the
    // hamburger — useful when the home page’s main content is
    // scrollable and a header nav is less obvious. (User’s 4th
    // visual test request.)
    if (!isExam && !isReview && (!isHome || isMobile())) {
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

    // (Phase 2 prep) admin Logout button (created by wireAuth below when
    // /api/admin/me resolves). Declared here so the Phase 2 relayout()
    // function — defined later in this same block — can place it into
    // the right container (rightGroup on desktop, drawer on mobile) and
    // re-place it on viewport changes.
    let logoutBtn = null;

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
        // Phase 2: register the Logout button globally and let relayout()
        // place it (rightGroup on desktop, drawer widgets on mobile).
        // relayout is a function declaration later in this same block;
        // function declarations are hoisted, so this call is safe even
        // though source-order places relayout after this code.
        logoutBtn = btn;
        relayout();
      } catch (err) {
        console.warn("[theme] Could not fetch /api/admin/me:", err);
      }
    })();

    header.appendChild(title);
    if (nav) header.appendChild(nav);
    header.appendChild(rightGroup);

    document.body.insertBefore(header, document.body.firstChild);

    // ============ Phase 2: hamburger + drawer + sticky-on-scroll + responsive ============
    // Spec: specs/global-header-redesign-spec.md
    // All additions only; no existing Rev. 0.8 functionality is changed.

    // (a) Hamburger button — last child of .global-header-right. On
    // mobile the matchMedia handler below leaves only the hamburger in
    // the right group (toggle + logout get moved into the drawer).
    // CSS hides it at desktop ≥768px via @media (min-width: 768px)
    // { .global-header-hamburger { display: none } } in styles.css.
    const hamburgerBtn = document.createElement("button");
    hamburgerBtn.type = "button";
    hamburgerBtn.className = "global-header-hamburger";
    hamburgerBtn.setAttribute("aria-expanded", "false");
    hamburgerBtn.setAttribute("aria-controls", "global-nav-drawer");
    hamburgerBtn.setAttribute("aria-label", "Toggle navigation menu");
    // Classic three-bar ☰ icon — three empty <span>s styled by CSS
    // (.global-header-hamburger > span { display: block; width: 18px;
    // height: 2px; ... gap: 5px from parent's flex-column layout).
    for (let i = 0; i < 3; i++) {
      const bar = document.createElement("span");
      hamburgerBtn.appendChild(bar);
    }
    rightGroup.appendChild(hamburgerBtn);

    // (b) Drawer container — appended to <body> AFTER the header. Its
    // inner .drawer-widgets flex column gets populated by relayout()
    // depending on the current viewport (empty on desktop; nav cluster
    // + theme toggle + admin logout on mobile, all horizontally centered
    // with gap:48px between them per CSS rules in styles.css).
    const drawer = document.createElement("aside");
    drawer.id = "global-nav-drawer";
    drawer.className = "global-nav-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Navigation menu");
    const drawerWidgets = document.createElement("div");
    drawerWidgets.className = "drawer-widgets";
    drawer.appendChild(drawerWidgets);
    document.body.appendChild(drawer);

    // Round 6: invisible backdrop element that intercepts pointer
    // events on the page content (z:25 sits below the drawer z:40
    // and above page-content z:auto). When active, random clicks on
    // the page content hit the backdrop INSTEAD of the underlying
    // buttons, so the underlying onclick handlers don't fire.
    const backdrop = document.createElement("div");
    backdrop.className = "global-nav-drawer-backdrop";
    document.body.appendChild(backdrop);

    function lockBodyScroll() {
      // Save current scroll position. Use position:fixed to lock
      // body in place — the standard iOS Safari workaround since
      // overflow:hidden on body is unreliable there.
      const scrollY = window.scrollY;
      document.body.dataset.scrollLock = String(scrollY);
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      backdrop.classList.add("is-active");
    }

    function unlockBodyScroll() {
      // Restore body styles + scroll back to captured position.
      const scrollY = parseInt(document.body.dataset.scrollLock || "0", 10);
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      delete document.body.dataset.scrollLock;
      window.scrollTo(0, scrollY);
      backdrop.classList.remove("is-active");
    }

    // (c) Scroll-compact trigger — drives the CSS
    // .global-header.is-scrolled class when the user has scrolled past
    // 40px (per spec §4.3's 40px threshold). Uses a scroll listener
    // with rAF throttling instead of IntersectionObserver on a sentinel
    // element. The previous IO + sentinel approach left a useless 40px
    // transparent div above the header (visible to the user as empty
    // vertical space on initial page load). The scroll listener has
    // zero DOM footprint — it polls `window.scrollY` against the
    // threshold on each rAF.
    //
    // - { passive: true }: browser doesn't need to wait for our
    //   handler before continuing the scroll; better scroll perf
    // - rAF ticker: caps updates to one per animation frame, even
    //   if scroll fires hundreds of times per second
    let scrollTicking = false;
    function updateScrollCompact() {
      header.classList.toggle("is-scrolled", window.scrollY > 40);
      scrollTicking = false;
    }
    window.addEventListener(
      "scroll",
      () => {
        if (!scrollTicking) {
          requestAnimationFrame(updateScrollCompact);
          scrollTicking = true;
        }
      },
      { passive: true },
    );
    updateScrollCompact(); // set correct initial state on first paint

    // (d) Drawer open/close + focus management
    function closeDrawer() {
      if (!drawer.classList.contains("is-open")) return;
      drawer.classList.remove("is-open");
      hamburgerBtn.setAttribute("aria-expanded", "false");
      // Round 5: drop the body class so page scroll + blur return to normal
      document.body.classList.remove("is-drawer-open");
      // Round 6: iOS-safe scroll unlock + deactivate backdrop
      unlockBodyScroll();
      hamburgerBtn.focus();
    }
    hamburgerBtn.addEventListener("click", () => {
      if (drawer.classList.contains("is-open")) {
        closeDrawer();
        return;
      }
      drawer.classList.add("is-open");
      // Round 5: page-scroll-lock + page-blur class toggle on
      document.body.classList.add("is-drawer-open");
      // Round 6: iOS-safe scroll lock + activate backdrop
      lockBodyScroll();
      hamburgerBtn.setAttribute("aria-expanded", "true");
      // Focus first focusable child of the drawer (per spec: "when
      // opening, focus the first navlink"). On mobile-Keyboard
      // activation, the :focus-visible outline shows; on mobile-tap
      // activation, the user-agent heuristic suppresses it. Both are
      // spec-aligned behavior.
      const firstFocusable = drawer.querySelector("a, button");
      if (firstFocusable) firstFocusable.focus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drawer.classList.contains("is-open")) {
        closeDrawer();
      }
    });
    // Backdrop click closes only when the click target IS the drawer
    // container itself (not children like the in-drawer theme toggle).
    // This implements "tap outside the link list closes" per spec §4.6.
    drawer.addEventListener("click", (e) => {
      if (e.target === drawer) closeDrawer();
    });
    // Round 5: outside-drawer close — clicking on the blurred page content
    // (any region inside <body> but outside both the drawer AND the header)
    // also closes the drawer. UX convenience per user's 5th visual test:
    // "ketika user menekan random area di site-wrapper/container maka
    // nav drawer akan collapsed". Filter out clicks on the drawer itself
    // and on the header (the existing handlers cover those).
    document.addEventListener("click", (e) => {
      if (!drawer.classList.contains("is-open")) return;
      if (drawer.contains(e.target)) return;
      if (header.contains(e.target)) return;
      closeDrawer();
    });
    // Navlink click closes the drawer BEFORE navigation (so the user
    // lands on the target page in the natural way — no extra close
    // step). The theme toggle does NOT close the drawer (per spec):
    // tapping the toggle only changes theme; the backdrop check above
    // already excludes toggle clicks since the toggle is the bubble
    // target, not the drawer container.
    if (nav) {
      // Round 5: delegate to closeDrawer() so the body class is consistently
      // managed. Inlining the 2-line cleanup left the body class in place
      // after a navlink click, causing the page to remain locked + blurred.
      nav.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => {
          closeDrawer();
        });
      });
    }

    // (e) Responsive viewport placement — moves the nav cluster, the
    // theme toggle, and the admin Logout button between the desktop
    // header zone and the mobile drawer widgets. Initial placement
    // runs immediately; subsequent placements fire on every viewport
    // breakpoint change. (mqMobile and isMobile() were declared
    // earlier in this block, before `let nav = null`, so they are
    // available for the home-page-on-mobile nav-creation decision.
    // Function declarations are hoisted, so wireAuth's async callback
    // can safely call relayout() too.)
    function relayout() {
      if (nav && isMobile()) {
        drawerWidgets.appendChild(nav);
      } else if (nav) {
        header.insertBefore(nav, rightGroup);
      }
      if (isMobile()) {
        drawerWidgets.appendChild(toggle);
      } else {
        rightGroup.insertBefore(toggle, hamburgerBtn);
      }
      if (logoutBtn) {
        if (isMobile()) {
          drawerWidgets.appendChild(logoutBtn);
        } else {
          rightGroup.appendChild(logoutBtn);
        }
      }
    }
    relayout(); // initial placement per current viewport
    if (mqMobile.addEventListener) {
      mqMobile.addEventListener("change", relayout);
    } else if (mqMobile.addListener) {
      // Safari < 14 fallback.
      mqMobile.addListener(relayout);
    }

    // ============ end Phase 2 ============

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
