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
    // Brand title + theme toggle now render on every page, including
    // exam.html (so the user can switch during a timed session) and
    // review.html (so pembahasan dapat dibaca di mode gelap).

    const isHome = path === "/" || path.endsWith("/index.html");

    const header = document.createElement("header");
    header.className = "global-header";

    const title = document.createElement("a");
    title.className = "global-header-title";
    title.textContent = "TOSKD CAT";
    title.href = "/";

    let nav = null;
    if (!isHome) {
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
    toggle.className = "theme-toggle-btn";
    toggle.setAttribute("aria-label", "Toggle dark/light theme");

    function updateToggleLabel() {
      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      toggle.innerHTML =
        current === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
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

    header.appendChild(title);
    if (nav) header.appendChild(nav);
    header.appendChild(toggle);

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
